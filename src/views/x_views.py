import asyncio
import hashlib
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import desc, select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import (
    AgentDBSettings,
    ConversationLog,
    ExternalModel,
    ExternalProvider,
    LocalProvider,
    SsoSettings,
    SystemModelSettings,
    SystemModelUserMapping,
    UsageLog,
    User,
    UserMarkdownPrompt,
    UserModelProperty,
    UserModelSettings,
    UserToken,
    get_session,
    set_llm_provider_config,
    set_oauth_config,
)
from x_models.id_x_010.src.schemas.x_schemas import AuthResponseType, UserInfoType
from x_models.id_x_010.src.utils import x_oauth
from x_models.id_x_010.src.utils.x_pricing import compute_cost

# Q&A 上下文保留的最大对话轮数：1 轮 = 1 条对话记录（1 user + 1 assistant = 2 messages）。
# 该常量同时约束 DB 历史拉取条数（get_conversation_history）与合并后消息截断
# （merge_context 中 max_messages = max_rounds * 2），保持两处窗口一致。
DEFAULT_MAX_ROUNDS = 3


async def save_conversation_log(
    conversation_id: str,
    user_query: str,
    model_response: str,
    thinking_process: str,
    model_type: str,
    model_name: str,
    intent: str,
):
    try:
        async with get_session()() as session:
            log = ConversationLog(
                conversation_id=conversation_id,
                user_query=user_query,
                model_response=model_response,
                thinking_process=thinking_process,
                model_type=model_type,
                model_name=model_name,
                intent=intent,
            )
            session.add(log)
            await session.commit()
            logger.info(
                f"{get_request_id()}对话日志已保存: conversation_id={conversation_id}"
            )
    except Exception as e:
        logger.error(f"{get_request_id()}保存对话日志失败: {e}", exc_info=True)


async def save_usage_log(
    user_id: Optional[int],
    conversation_id: str,
    model_type: str,
    model_name: str,
    intent: str,
    usage: Optional[dict],
    is_system_model: bool = False,
) -> None:
    """落库一行用量记录（token 消耗 + 估算花费）。best-effort，绝不抛错。

    Args:
        user_id: 用户ID（未登录时为 None）
        conversation_id: 会话 ID
        model_type: ``local`` / ``external``
        model_name: 模型名称
        intent: 意图（general / sql / code）
        usage: LangChain ``usage_metadata`` 字典，含 input_tokens / output_tokens /
            total_tokens；为 None 或缺字段时按 0 处理
        is_system_model: 是否为系统预置模型调用。True 时计入配额与统计；
            False（用户自定义模型）不计入配额与统计。
    """
    try:
        input_tokens = int((usage or {}).get("input_tokens", 0) or 0)
        output_tokens = int((usage or {}).get("output_tokens", 0) or 0)
        total_tokens = int((usage or {}).get("total_tokens", 0) or 0)

        # 本地模型运行在用户自有硬件上，不计费
        if model_type == "local":
            cost = 0.0
        else:
            cost = compute_cost(model_name, input_tokens, output_tokens)

        # 用户自定义模型不计费，不统计
        if not is_system_model:
            cost = 0.0

        async with get_session()() as session:
            log = UsageLog(
                user_id=user_id,
                conversation_id=conversation_id or None,
                model_name=model_name or None,
                model_type=model_type or None,
                is_system_model=is_system_model,
                intent=intent or None,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=total_tokens,
                cost_usd=cost,
            )
            session.add(log)
            await session.commit()
            logger.info(
                f"{get_request_id()}用量日志已保存: user_id={user_id}, "
                f"model={model_name}, system={is_system_model}, "
                f"in={input_tokens}, out={output_tokens}, cost=${cost:.6f}"
            )
    except Exception as e:
        logger.error(f"{get_request_id()}保存用量日志失败: {e}", exc_info=True)


# ==========================================
# 用户资料（display_name / avatar）
# ==========================================

# 头像字节读取端点的路由前缀，与 register_routers() 中的 route_prefix 一致；
# views 层用它组装返回给前端的 avatar_url
_AVATAR_ROUTE_PREFIX = "/b/id_x_010"


def build_user_info(user: User) -> "UserInfoType":
    """由 User 行构造 UserInfoType，统一填充 avatar_url（带版本号防缓存）。

    所有 AuthResponseType.user 与 UpdateProfileResponseType.user 都应通过本函数构造，
    避免三个调用点各自维护字段一致性。
    """
    from x_models.id_x_010.src.schemas.x_schemas import UserInfoType

    avatar_url: Optional[str] = None
    if user.avatar:
        # 版本号用 updated_at 时间戳；头像更新后 updated_at 自动刷新（数据库触发器）
        version = int(user.updated_at.timestamp()) if user.updated_at else 0
        avatar_url = f"{_AVATAR_ROUTE_PREFIX}/avatar/{user.id}?v={version}"

    return UserInfoType(
        id=user.id,
        email=user.email,
        phone=user.phone,
        display_name=user.display_name,
        avatar_url=avatar_url,
        role=getattr(user, "role", None) or (
            "admin" if getattr(user, "is_admin", False) else "user"
        ),
        created_at=user.created_at.isoformat() if user.created_at else None,
    )


async def update_user_profile(
    user_id: int,
    display_name: Optional[str] = None,
) -> Optional[User]:
    """更新用户资料。display_name 传 None 表示不改；传空串表示清空回退到 email 本地名。

    返回更新后的 User 行；用户不存在或 DB 异常时返回 None。
    """
    try:
        async with get_session()() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user is None:
                return None

            if display_name is not None:
                # 规范化：去首尾空白；超长截断；空串视为清空（写 None）
                trimmed = display_name.strip()
                if len(trimmed) > 64:
                    trimmed = trimmed[:64]
                user.display_name = trimmed if trimmed else None

            await session.commit()
            await session.refresh(user)
            return user
    except Exception as e:
        logger.error(f"{get_request_id()}更新用户资料失败: {e}", exc_info=True)
        return None


async def set_user_avatar(user_id: int, avatar_bytes: bytes) -> Optional[User]:
    """写入/覆盖用户头像二进制。传空 bytes 表示清空头像。返回更新后的 User 行。"""
    try:
        async with get_session()() as session:
            result = await session.execute(select(User).where(User.id == user_id))
            user = result.scalar_one_or_none()
            if user is None:
                return None

            user.avatar = avatar_bytes if avatar_bytes else None
            await session.commit()
            await session.refresh(user)
            return user
    except Exception as e:
        logger.error(f"{get_request_id()}设置用户头像失败: {e}", exc_info=True)
        return None


async def get_user_avatar(user_id: int) -> Optional[bytes]:
    """读取用户头像二进制；用户不存在或未设头像时返回 None。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(User.avatar).where(User.id == user_id)
            )
            row = result.one_or_none()
            if row is None:
                return None
            return row[0]
    except Exception as e:
        logger.error(f"{get_request_id()}读取用户头像失败: {e}", exc_info=True)
        return None


async def get_conversation_history(
    conversation_id: str,
    max_rounds: int = DEFAULT_MAX_ROUNDS,
) -> List[Dict[str, str]]:
    if not conversation_id:
        return []

    try:
        async with get_session()() as session:
            result = await session.execute(
                ConversationLog.__table__.select()
                .where(ConversationLog.conversation_id == conversation_id)
                .order_by(desc(ConversationLog.created_at))
                .limit(max_rounds)
            )
            rows = result.fetchall()

            if not rows:
                return []

            history = []
            for row in reversed(rows):
                if row.user_query:
                    history.append({"role": "user", "content": row.user_query})
                if row.model_response:
                    history.append({"role": "assistant", "content": row.model_response})

            logger.info(
                f"{get_request_id()}已加载对话历史: conversation_id={conversation_id}, "
                f"rounds={len(rows)}/{max_rounds}, messages={len(history)}"
            )
            return history

    except Exception as e:
        logger.error(f"{get_request_id()}加载对话历史失败: {e}", exc_info=True)
        return []


# ==========================================
# 用户模型设置（/user-home 设置弹窗）
# ==========================================


async def get_user_model_settings(user_id: int) -> Optional[UserModelSettings]:
    """读取用户的模型设置，未配置时返回 None。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserModelSettings).where(UserModelSettings.user_id == user_id)
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}读取用户模型设置失败: {e}", exc_info=True)
        return None


async def upsert_user_model_settings(
    user_id: int,
    provider: str,
    base_url: str,
    api_key: str,
    model_name: str,
    model_name_list: List[str],
    quota_limit_monthly_usd: Optional[float] = None,
) -> Optional[UserModelSettings]:
    """新建或更新用户的默认模型设置（每用户一行）。

    .. deprecated::
        多 Provider 架构下，provider/base_url/api_key/model_name_list 由
        ``user_model_providers`` 表管理。本函数仅用于兼容旧版 save_model_settings
        mutation 与 save_default_model 的首次创建场景。

    对于仅更新默认模型名与配额的场景，请使用 ``update_user_default_model``。
    """
    # 规范化模型列表：去空白、去空串、去重保序
    cleaned_list: List[str] = []
    seen = set()
    for name in model_name_list or []:
        n = (name or "").strip()
        if n and n not in seen:
            seen.add(n)
            cleaned_list.append(n)

    # 默认模型必须在列表内
    default_name = (model_name or "").strip()
    if default_name and default_name not in seen:
        cleaned_list.insert(0, default_name)
        seen.add(default_name)
    if not cleaned_list:
        cleaned_list = [default_name] if default_name else []

    # 多 Provider 架构下允许空 provider/base_url/api_key（仅默认模型名 + 配额）
    _provider = provider or "default"
    _base_url = base_url or "none"
    _api_key = api_key or "none"

    async with get_session()() as session:
        result = await session.execute(
            select(UserModelSettings).where(UserModelSettings.user_id == user_id)
        )
        settings = result.scalar_one_or_none()

        if settings is None:
            settings = UserModelSettings(
                user_id=user_id,
                provider=_provider,
                base_url=_base_url,
                api_key=_api_key,
                model_name=default_name,
                model_name_list=cleaned_list,
                quota_limit_monthly_usd=quota_limit_monthly_usd,
            )
            session.add(settings)
        else:
            # 多 Provider 架构：仅更新默认模型名与配额，不覆盖 provider/base_url/api_key
            settings.model_name = default_name
            settings.quota_limit_monthly_usd = quota_limit_monthly_usd
            # 仅当调用方传入了有意义的 provider/base_url/api_key 时才更新
            if provider:
                settings.provider = provider
            if base_url:
                settings.base_url = base_url
            if api_key:
                settings.api_key = api_key
            if model_name_list:
                settings.model_name_list = cleaned_list

        await session.commit()
        await session.refresh(settings)
        logger.info(
            f"{get_request_id()}用户模型设置已保存: user_id={user_id}, "
            f"provider={provider}, default={default_name}, "
            f"list={cleaned_list}, quota_usd={quota_limit_monthly_usd}"
        )
        return settings


# ==========================================
# 用户自定义模型 Provider（user_model_providers 表）
# 每用户可配置多个 Provider，每个 Provider 有独立的 endpoint + model_name_list
# ==========================================


async def list_user_model_providers(user_id: int) -> List[UserModelProperty]:
    """列出指定用户的全部自定义 Provider，按 sort_order / id 升序。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserModelProperty)
                .where(UserModelProperty.user_id == user_id)
                .order_by(
                    UserModelProperty.sort_order.asc(),
                    UserModelProperty.id.asc(),
                )
            )
            return list(result.scalars().all())
    except Exception as e:
        logger.error(f"{get_request_id()}列出用户 Provider 失败: {e}", exc_info=True)
        return []


async def get_user_model_provider(
    user_id: int, provider_id: int
) -> Optional[UserModelProperty]:
    """按 id 读取单个 Provider 行（属主校验）。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserModelProperty).where(
                    UserModelProperty.id == provider_id,
                    UserModelProperty.user_id == user_id,
                )
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}读取用户 Provider 失败: {e}", exc_info=True)
        return None


async def upsert_user_model_provider(
    user_id: int,
    provider: str,
    base_url: str,
    api_key: str,
    model_name_list: Optional[List[str]] = None,
    sort_order: int = 0,
    provider_id: Optional[int] = None,
) -> Optional[UserModelProperty]:
    """新建或更新用户自定义 Provider。

    - ``provider_id`` 为 None 时按 provider 名新建（已存在则更新）。
    - ``provider_id`` 非 None 时更新指定行。
    - ``model_name_list`` 去重保序后落库。
    """
    cleaned_list: List[str] = []
    seen = set()
    for name in model_name_list or []:
        n = (name or "").strip()
        if n and n not in seen:
            seen.add(n)
            cleaned_list.append(n)

    provider_name = (provider or "").strip()
    base_url = (base_url or "").strip().rstrip("/")
    api_key = (api_key or "").strip()

    try:
        async with get_session()() as session:
            if provider_id is not None:
                result = await session.execute(
                    select(UserModelProperty).where(
                        UserModelProperty.id == provider_id,
                        UserModelProperty.user_id == user_id,
                    )
                )
                model = result.scalar_one_or_none()
                if model is None:
                    return None
            else:
                result = await session.execute(
                    select(UserModelProperty).where(
                        UserModelProperty.user_id == user_id,
                        UserModelProperty.provider == provider_name,
                    )
                )
                model = result.scalar_one_or_none()
                if model is None:
                    model = UserModelProperty(
                        user_id=user_id,
                        provider=provider_name,
                        base_url=base_url,
                        api_key=api_key,
                        model_name_list=cleaned_list,
                        sort_order=sort_order,
                    )
                    session.add(model)

            model.provider = provider_name
            model.base_url = base_url
            model.api_key = api_key
            model.model_name_list = cleaned_list
            model.sort_order = sort_order

            await session.commit()
            await session.refresh(model)
            logger.info(
                f"{get_request_id()}用户 Provider 已保存: user_id={user_id}, "
                f"provider={provider_name}, models={cleaned_list}, id={model.id}"
            )
            return model
    except Exception as e:
        logger.error(f"{get_request_id()}保存用户 Provider 失败: {e}", exc_info=True)
        return None


async def delete_user_model_provider(user_id: int, provider_id: int) -> bool:
    """删除用户自定义 Provider 行。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserModelProperty).where(
                    UserModelProperty.id == provider_id,
                    UserModelProperty.user_id == user_id,
                )
            )
            model = result.scalar_one_or_none()
            if model is None:
                return False
            await session.delete(model)
            await session.commit()
            logger.info(
                f"{get_request_id()}用户 Provider 已删除: "
                f"user_id={user_id}, provider_id={provider_id}"
            )
            return True
    except Exception as e:
        logger.error(f"{get_request_id()}删除用户 Provider 失败: {e}", exc_info=True)
        return False


async def find_provider_for_model(
    user_id: int, model_name: str
) -> Optional[UserModelProperty]:
    """在用户的所有 Provider 中查找包含 model_name 的 Provider 行。

    供 resolve_model_endpoint 在模型选择器选中自定义模型时解析端点。
    """
    if not model_name:
        return None
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserModelProperty).where(
                    UserModelProperty.user_id == user_id,
                )
            )
            providers = result.scalars().all()
            for p in providers:
                if model_name in (p.model_name_list or []):
                    return p
            return None
    except Exception as e:
        logger.error(
            f"{get_request_id()}查找 Provider for model 失败: {e}", exc_info=True
        )
        return None


def _normalize_base_url(url: str) -> str:
    """归一化 base_url 用于唯一性比对：去首尾空白 + 去尾部斜杠 + 转小写。

    确保 ``https://API.x.com/v1/`` 与 ``https://api.x.com/v1`` 被判定为同一端点。
    注意：返回值仅用于查询比对，落库时仍保留调用方传入的原始大小写形式。
    """
    return (url or "").strip().rstrip("/").lower()


async def upsert_external_model(
    name: str,
    provider: str,
    base_url: str,
    api_key: str,
) -> Optional[ExternalModel]:
    """以 base_url 为唯一键新建或更新 external_models 表中的行。

    供 Model Settings 弹窗保存时同步登记：用户配置的模型会出现在
    get_models() 返回的模型列表里，便于在消息输入框选择切换。

    匹配策略：归一化后的 base_url（去尾部斜杠 + 小写）命中现有行则更新
    name / provider / api_key（base_url 保持原值不变）；否则插入新行。
    表层有 unique index 兜底，应用层与 DB 双重保证不重复。
    """
    normalized = _normalize_base_url(base_url)
    if not normalized:
        return None

    try:
        async with get_session()() as session:
            # 查询时对存储值做同样的归一化比对（DB 端无法对表达式建函数索引，
            # 故先全表读取候选行再做应用层归一化匹配——external_models 行数极少，无性能问题）
            result = await session.execute(
                select(ExternalModel).where(
                    ExternalModel.base_url.ilike(f"{normalized}%")
                )
            )
            candidates = result.scalars().all()
            model = next(
                (m for m in candidates if _normalize_base_url(m.base_url) == normalized),
                None,
            )

            if model is None:
                model = ExternalModel(
                    name=name,
                    provider=provider,
                    base_url=base_url,
                    api_key=api_key,
                )
                session.add(model)
                action = "新增"
            else:
                # base_url 是唯一键，保持原值；其余字段按用户最新输入更新
                model.name = name
                model.provider = provider
                model.api_key = api_key
                action = "更新"

            await session.commit()
            await session.refresh(model)
            logger.info(
                f"{get_request_id()}external_models 已{action}: "
                f"provider={provider}, name={name}, id={model.id}, base_url={base_url}"
            )
            return model
    except Exception as e:
        logger.error(
            f"{get_request_id()}登记 external_models 失败: {e}", exc_info=True
        )
        return None


# ---------------------------------------------------------------------------
# Markdown 提示词库
# ---------------------------------------------------------------------------


async def list_external_models() -> List[ExternalModel]:
    """列出 external_models 表全部行（按 id 升序）。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(ExternalModel).order_by(ExternalModel.id)
            )
            return list(result.scalars().all())
    except Exception as e:
        logger.error(f"{get_request_id()}列出外部模型失败: {e}", exc_info=True)
        return []


async def get_external_model_by_id(model_id: int) -> Optional[ExternalModel]:
    """按 id 读取单行 external_models。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(ExternalModel).where(ExternalModel.id == model_id)
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}读取外部模型失败: {e}", exc_info=True)
        return None


async def get_external_model_by_name(name: str) -> Optional[ExternalModel]:
    """按模型名称读取单行 external_models。供 stream_chat 据前端选中的
    model_name 解析对应的 base_url / api_key，无需 user_model_settings 中转。
    """
    if not name:
        return None
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(ExternalModel).where(ExternalModel.name == name)
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}按名称读取外部模型失败: {e}", exc_info=True)
        return None


async def delete_external_model(model_id: int) -> bool:
    """按 id 删除 external_models 行。返回是否删除成功（行不存在时返回 False）。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(ExternalModel).where(ExternalModel.id == model_id)
            )
            model = result.scalar_one_or_none()
            if model is None:
                return False
            await session.delete(model)
            await session.commit()
            logger.info(f"{get_request_id()}外部模型已删除: id={model_id}")
            return True
    except Exception as e:
        logger.error(f"{get_request_id()}删除外部模型失败: {e}", exc_info=True)
        return False


# ==========================================
# 系统预置模型（system_model_settings 表）
# 管理员维护，用户只读；enabled 行对所有用户在选择器中可见
# ==========================================


async def list_system_models(enabled_only: bool = False) -> List[SystemModelSettings]:
    """列出系统预置模型，按 sort_order / id 升序。

    Args:
        enabled_only: True 时仅返回 enabled=True 的行（供 get_models 合并）。
    """
    try:
        async with get_session()() as session:
            stmt = select(SystemModelSettings)
            if enabled_only:
                stmt = stmt.where(SystemModelSettings.enabled.is_(True))
            stmt = stmt.order_by(
                SystemModelSettings.sort_order.asc(),
                SystemModelSettings.id.asc(),
            )
            result = await session.execute(stmt)
            return list(result.scalars().all())
    except Exception as e:
        logger.error(f"{get_request_id()}列出系统模型失败: {e}", exc_info=True)
        return []


async def get_system_model_by_name(name: str) -> Optional[SystemModelSettings]:
    """按模型名称查询单行系统预置模型。

    供 chat / sql_approval 等流程判断前端选中的 model_name 是否为系统模型：
    命中则用该行的 base_url / api_key 发起 LLM 调用，覆盖用户级设置。
    """
    if not name:
        return None
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SystemModelSettings).where(SystemModelSettings.name == name)
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}按名称查询系统模型失败: {e}", exc_info=True)
        return None


async def upsert_system_model(
    name: str,
    provider: str,
    base_url: str,
    api_key: str,
    model_type: str = "external",
    is_default: bool = False,
    enabled: bool = True,
    sort_order: int = 0,
    model_id: Optional[int] = None,
) -> Optional[SystemModelSettings]:
    """新建或更新系统预置模型。

    - ``model_id`` 为 None 时按 name 唯一性新增（name 已存在则更新）。
    - ``model_id`` 非 None 时更新指定行。
    - ``is_default=True`` 时自动把其余行的 is_default 置 False（同一时刻仅一个系统默认）。
    """
    try:
        async with get_session()() as session:
            if model_id is not None:
                result = await session.execute(
                    select(SystemModelSettings).where(SystemModelSettings.id == model_id)
                )
                model = result.scalar_one_or_none()
                if model is None:
                    return None
            else:
                result = await session.execute(
                    select(SystemModelSettings).where(SystemModelSettings.name == name)
                )
                model = result.scalar_one_or_none()
                if model is None:
                    model = SystemModelSettings(
                        name=name,
                        provider=provider,
                        base_url=base_url,
                        api_key=api_key,
                        model_type=model_type or "external",
                        is_default=is_default,
                        enabled=enabled,
                        sort_order=sort_order,
                    )
                    session.add(model)

            model.name = name
            model.provider = provider
            model.base_url = base_url
            model.api_key = api_key
            model.model_type = model_type or "external"
            model.enabled = enabled
            model.sort_order = sort_order

            if is_default:
                model.is_default = True
                # 把其余行 is_default 置 False
                others = await session.execute(
                    select(SystemModelSettings).where(
                        SystemModelSettings.id != model.id,
                        SystemModelSettings.is_default.is_(True),
                    )
                )
                for other in others.scalars().all():
                    other.is_default = False
            else:
                model.is_default = is_default

            await session.commit()
            await session.refresh(model)
            logger.info(
                f"{get_request_id()}系统模型已保存: id={model.id}, name={name}, "
                f"provider={provider}, default={is_default}, enabled={enabled}"
            )
            return model
    except Exception as e:
        logger.error(f"{get_request_id()}保存系统模型失败: {e}", exc_info=True)
        return None


async def delete_system_model(model_id: int) -> bool:
    """按 id 删除系统预置模型行。返回是否删除成功。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SystemModelSettings).where(SystemModelSettings.id == model_id)
            )
            model = result.scalar_one_or_none()
            if model is None:
                return False
            await session.delete(model)
            await session.commit()
            logger.info(f"{get_request_id()}系统模型已删除: id={model_id}")
            return True
    except Exception as e:
        logger.error(f"{get_request_id()}删除系统模型失败: {e}", exc_info=True)
        return False


# ==========================================
# 用户对系统预置模型的 API Key 映射
# (system_model_user_mappings 表)
# ==========================================


async def get_user_system_model_mapping(
    user_id: int, system_model_id: int
) -> Optional[SystemModelUserMapping]:
    """查询单个用户对单个系统模型的 API Key 覆盖记录。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SystemModelUserMapping).where(
                    SystemModelUserMapping.user_id == user_id,
                    SystemModelUserMapping.system_model_id == system_model_id,
                )
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}查询用户系统模型映射失败: {e}", exc_info=True)
        return None


async def list_user_system_model_mappings(
    user_id: int,
) -> List[SystemModelUserMapping]:
    """列出指定用户对全部系统模型的 API Key 映射。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SystemModelUserMapping)
                .where(SystemModelUserMapping.user_id == user_id)
                .order_by(SystemModelUserMapping.id.asc())
            )
            return list(result.scalars().all())
    except Exception as e:
        logger.error(
            f"{get_request_id()}列出用户系统模型映射失败: {e}", exc_info=True
        )
        return []


async def upsert_user_system_model_mapping(
    user_id: int,
    system_model_id: int,
    api_key: str,
) -> Optional[SystemModelUserMapping]:
    """新建或更新用户对系统模型的 API Key 映射。

    (user_id, system_model_id) 唯一——已存在则更新 api_key，不存在则插入。
    """
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SystemModelUserMapping).where(
                    SystemModelUserMapping.user_id == user_id,
                    SystemModelUserMapping.system_model_id == system_model_id,
                )
            )
            mapping = result.scalar_one_or_none()

            if mapping is None:
                mapping = SystemModelUserMapping(
                    user_id=user_id,
                    system_model_id=system_model_id,
                    api_key=api_key,
                )
                session.add(mapping)
            else:
                mapping.api_key = api_key

            await session.commit()
            await session.refresh(mapping)
            logger.info(
                f"{get_request_id()}用户系统模型映射已保存: "
                f"user_id={user_id}, system_model_id={system_model_id}"
            )
            return mapping
    except Exception as e:
        logger.error(
            f"{get_request_id()}保存用户系统模型映射失败: {e}", exc_info=True
        )
        return None


async def delete_user_system_model_mapping(
    user_id: int, system_model_id: int
) -> bool:
    """删除用户对系统模型的 API Key 映射（回退到全局 key）。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SystemModelUserMapping).where(
                    SystemModelUserMapping.user_id == user_id,
                    SystemModelUserMapping.system_model_id == system_model_id,
                )
            )
            mapping = result.scalar_one_or_none()
            if mapping is None:
                return False
            await session.delete(mapping)
            await session.commit()
            logger.info(
                f"{get_request_id()}用户系统模型映射已删除: "
                f"user_id={user_id}, system_model_id={system_model_id}"
            )
            return True
    except Exception as e:
        logger.error(
            f"{get_request_id()}删除用户系统模型映射失败: {e}", exc_info=True
        )
        return False


async def resolve_model_endpoint(
    model_name: Optional[str],
    user_settings: Optional[UserModelSettings],
    user_id: Optional[int] = None,
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """解析实际调用的模型端点（api_key, base_url, model_name）。

    优先级：
    1. ``model_name`` 命中 ``system_model_settings`` 且该用户有 per-user mapping →
       使用用户的 api_key + 系统模型的 base_url
    2. ``model_name`` 命中 ``system_model_settings`` 但无 per-user mapping →
       使用系统模型的全局 api_key
    3. ``user_id`` 非空且 ``model_name`` 在用户的某个 UserModelProperty.model_name_list 中 →
       使用该 Provider 的 base_url / api_key
    4. ``user_settings`` 非空 → 使用旧版单 endpoint（兼容）
    5. ``model_name`` 为空时回退到系统默认模型（``system_model_settings.is_default=True``）
    6. 均无 → 返回全 None（由调用方回退到全局 orchestrator）

    Args:
        user_id: 当前用户 ID；传入时查 per-user mapping 和多 Provider。
        model_name: 旧版用户设置（兼容回退）；model_name 用于取默认模型名。

    Returns:
        (api_key, base_url, effective_model_name)
    """
    if model_name:
        # 1) 系统预置模型
        sys_model = await get_system_model_by_name(model_name)
        if sys_model is not None and sys_model.enabled:
            api_key = sys_model.api_key
            if user_id is not None:
                user_mapping = await get_user_system_model_mapping(
                    user_id, sys_model.id
                )
                if user_mapping is not None:
                    api_key = user_mapping.api_key
                    logger.info(
                        f"{get_request_id()}使用 per-user 系统模型 key: "
                        f"user_id={user_id}, model={model_name}"
                    )
            return api_key, sys_model.base_url, model_name

        # 2) 用户自定义 Provider（多 Provider 模式）
        if user_id is not None:
            provider = await find_provider_for_model(user_id, model_name)
            if provider is not None:
                return provider.api_key, provider.base_url, model_name

    # 3) 旧版单 endpoint 回退（兼容）
    if user_settings is not None:
        effective = model_name or user_settings.model_name
        return user_settings.api_key, user_settings.base_url, effective

    # 4) model_name 为空时回退到系统默认模型（is_default=True 行）
    #    未传 model_name 的请求（如前端未选择模型）应使用系统默认，
    #    供后续 _is_system_model 判定与 usage_logs 计费统计。
    if not model_name:
        sys_models = await list_system_models(enabled_only=True)
        default_model = next((m for m in sys_models if m.is_default), None)
        if default_model is not None:
            logger.info(
                f"{get_request_id()}model_name 为空，回退到系统默认模型: {default_model.name}"
            )
            return default_model.api_key, default_model.base_url, default_model.name

    return None, None, model_name


async def list_user_markdown_prompts(user_id: int) -> List[UserMarkdownPrompt]:
    """列出指定用户的全部 Markdown 提示词，按创建时间倒序。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserMarkdownPrompt)
                .where(UserMarkdownPrompt.user_id == user_id)
                .order_by(desc(UserMarkdownPrompt.created_at))
            )
            return list(result.scalars().all())
    except Exception as e:
        logger.error(f"{get_request_id()}列出用户提示词失败: {e}", exc_info=True)
        return []


async def get_active_markdown_prompt(user_id: int) -> Optional[UserMarkdownPrompt]:
    """读取用户当前选中的提示词（is_active=True），无则返回 None。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.user_id == user_id,
                    UserMarkdownPrompt.is_active.is_(True),
                )
            )
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(f"{get_request_id()}读取活跃提示词失败: {e}", exc_info=True)
        return None


async def create_user_markdown_prompt(
    user_id: int,
    filename: str,
    content: str,
) -> Optional[UserMarkdownPrompt]:
    """新建或覆盖同名提示词。同名时更新内容并保持原 is_active 状态。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.user_id == user_id,
                    UserMarkdownPrompt.filename == filename,
                )
            )
            prompt = result.scalar_one_or_none()

            if prompt is None:
                # 用户首条提示词自动设为活跃
                count_result = await session.execute(
                    select(UserMarkdownPrompt).where(
                        UserMarkdownPrompt.user_id == user_id
                    )
                )
                is_first = count_result.scalars().first() is None
                prompt = UserMarkdownPrompt(
                    user_id=user_id,
                    filename=filename,
                    content=content,
                    is_active=is_first,
                )
                session.add(prompt)
            else:
                prompt.content = content

            await session.commit()
            await session.refresh(prompt)
            logger.info(
                f"{get_request_id()}提示词已保存: user_id={user_id}, "
                f"filename={filename}, chars={len(content)}"
            )
            return prompt
    except Exception as e:
        logger.error(f"{get_request_id()}保存提示词失败: {e}", exc_info=True)
        return None


async def select_markdown_prompt(
    user_id: int, prompt_id: int
) -> Optional[UserMarkdownPrompt]:
    """将指定提示词设为当前选中（互斥：同用户其余项取消选中）。"""
    try:
        async with get_session()() as session:
            # 先取消该用户全部已选中项
            result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.user_id == user_id,
                    UserMarkdownPrompt.is_active.is_(True),
                )
            )
            for p in result.scalars().all():
                p.is_active = False

            # 再设目标为选中
            target_result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.id == prompt_id,
                    UserMarkdownPrompt.user_id == user_id,
                )
            )
            target = target_result.scalar_one_or_none()
            if target is None:
                return None
            target.is_active = True

            await session.commit()
            await session.refresh(target)
            logger.info(
                f"{get_request_id()}提示词已选中: user_id={user_id}, "
                f"prompt_id={prompt_id}, filename={target.filename}"
            )
            return target
    except Exception as e:
        logger.error(f"{get_request_id()}选中提示词失败: {e}", exc_info=True)
        return None


async def delete_markdown_prompt(user_id: int, prompt_id: int) -> bool:
    """删除指定提示词。若删除的恰为活跃项，自动将最新一条设为活跃。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.id == prompt_id,
                    UserMarkdownPrompt.user_id == user_id,
                )
            )
            prompt = result.scalar_one_or_none()
            if prompt is None:
                return False

            was_active = prompt.is_active
            await session.delete(prompt)
            await session.flush()

            # 删除的是活跃项时，自动选最近一条续用
            if was_active:
                latest_result = await session.execute(
                    select(UserMarkdownPrompt)
                    .where(UserMarkdownPrompt.user_id == user_id)
                    .order_by(desc(UserMarkdownPrompt.created_at))
                    .limit(1)
                )
                latest = latest_result.scalars().first()
                if latest is not None:
                    latest.is_active = True

            await session.commit()
            logger.info(
                f"{get_request_id()}提示词已删除: user_id={user_id}, prompt_id={prompt_id}"
            )
            return True
    except Exception as e:
        logger.error(f"{get_request_id()}删除提示词失败: {e}", exc_info=True)
        return False


async def rename_markdown_prompt(
    user_id: int, prompt_id: int, note_name: Optional[str]
) -> Optional[UserMarkdownPrompt]:
    """更新提示词的备注名称。

    note_name 传入空字符串或 None 时清空备注，前端展示回退到 filename。
    去除首尾空白后入库；超长（>256）截断。
    """
    # 统一规整：去首尾空白，空串视为 None（清空）
    if note_name is not None:
        note_name = note_name.strip()
        if note_name == "":
            note_name = None
        elif len(note_name) > 256:
            note_name = note_name[:256]

    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.id == prompt_id,
                    UserMarkdownPrompt.user_id == user_id,
                )
            )
            prompt = result.scalar_one_or_none()
            if prompt is None:
                return None

            prompt.note_name = note_name
            await session.commit()
            await session.refresh(prompt)
            logger.info(
                f"{get_request_id()}提示词已重命名: user_id={user_id}, "
                f"prompt_id={prompt_id}, note_name={note_name!r}"
            )
            return prompt
    except Exception as e:
        logger.error(f"{get_request_id()}重命名提示词失败: {e}", exc_info=True)
        return None


async def update_markdown_content(
    user_id: int, prompt_id: int, content: str
) -> Optional[UserMarkdownPrompt]:
    """更新提示词的 Markdown 正文内容。

    用于「编辑」功能：用户在前端 textarea 中修改后写回 DB，
    下轮对话即注入新内容。空内容拒绝；超 2MB 截断（与上传上限一致）。
    """
    if content is None:
        return None
    # 规整：去除首尾空白；空内容拒绝
    content = content.strip()
    if not content:
        return None
    max_len = 2 * 1024 * 1024  # 与上传上限一致
    if len(content) > max_len:
        content = content[:max_len]

    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserMarkdownPrompt).where(
                    UserMarkdownPrompt.id == prompt_id,
                    UserMarkdownPrompt.user_id == user_id,
                )
            )
            prompt = result.scalar_one_or_none()
            if prompt is None:
                return None

            prompt.content = content
            await session.commit()
            await session.refresh(prompt)
            logger.info(
                f"{get_request_id()}提示词内容已更新: user_id={user_id}, "
                f"prompt_id={prompt_id}, chars={len(content)}"
            )
            return prompt
    except Exception as e:
        logger.error(f"{get_request_id()}更新提示词内容失败: {e}", exc_info=True)
        return None


async def test_model_connectivity(
    base_url: str,
    api_key: str,
    model_name: str,
    timeout: int = 20,
) -> Tuple[bool, str]:
    """以最小开销调用一次模型，验证 (base_url, api_key, model_name) 可用性。

    面向 OpenAI 兼容接口（ChatOpenAI 约定），返回 (是否成功, 人类可读消息)。

    采用自适应温度策略：先用 ``temperature=0`` 探测；若返回
    ``invalid temperature`` 类错误（reasoning 模型如 DeepSeek-R1 / o1 系列只
    允许 temperature=1），自动回退到 ``temperature=1`` 重试一次。
    """
    from langchain_core.messages import HumanMessage
    from langchain_openai import ChatOpenAI
    from pydantic import SecretStr

    def _build_llm(temp: float) -> ChatOpenAI:
        return ChatOpenAI(
            model=model_name,
            api_key=SecretStr(api_key),
            base_url=base_url,
            temperature=temp,
            max_retries=1,
            timeout=15,
            streaming=False,
        )

    async def _try_once(temp: float) -> Tuple[bool, str, bool]:
        """单次探测。返回 (是否成功, 错误原文, 是否超时)。"""
        llm = _build_llm(temp)
        try:
            await asyncio.wait_for(
                llm.ainvoke([HumanMessage(content="ping")]), timeout=timeout
            )
            return True, "", False
        except asyncio.TimeoutError:
            return False, "", True
        except Exception as e:
            return False, str(e), False

    # 第一轮：temperature=0（绝大多数模型适用）
    ok, err, is_timeout = await _try_once(0.0)
    if ok:
        logger.info(
            f"{get_request_id()}模型连通性检测通过: model={model_name}, base_url={base_url}"
        )
        return True, "连通性检测通过，模型响应正常"

    # 超时单独处理，不重试（重试也是超时）
    if is_timeout:
        logger.warning(
            f"{get_request_id()}模型连通性检测超时: model={model_name}, base_url={base_url}"
        )
        return False, f"连接超时（>{timeout} 秒无响应），请检查访问地址是否可达"

    # 若是 temperature 限制错误，回退到 temperature=1 重试
    err_lower = (err or "").lower()
    if "temperature" in err_lower and (
        "only 1 is allowed" in err_lower or "invalid" in err_lower
    ):
        logger.info(
            f"{get_request_id()}模型限制 temperature=1，自动回退重试: model={model_name}"
        )
        ok2, err2, is_timeout2 = await _try_once(1.0)
        if ok2:
            logger.info(
                f"{get_request_id()}模型连通性检测通过(temperature=1): "
                f"model={model_name}, base_url={base_url}"
            )
            return True, "连通性检测通过，模型响应正常"
        if is_timeout2:
            return False, f"连接超时（>{timeout} 秒无响应），请检查访问地址是否可达"
        err = err2

    # 真正失败
    detail = (err or "").replace("\n", " ")[:200]
    logger.warning(
        f"{get_request_id()}模型连通性检测失败: model={model_name}, "
        f"base_url={base_url} | 原因: {detail}"
    )
    return False, f"连接失败: {detail}"


# ==========================================
# LLM 提供商配置（external_provider / local_provider）
# ==========================================


async def load_llm_provider_config() -> Optional[dict]:
    """按 LLM_PROVIDER 值从对应提供商表读取首行配置并注入全局缓存。

    LLM_PROVIDER=external → external_provider 表；
    LLM_PROVIDER=local    → local_provider 表。
    表无数据或读取失败时缓存保持原状，各 Agent 配置为空值。

    注意：get_orchestrator() 缓存的默认 supervisor 在首次构建时固化
    配置，此后表数据变更对已缓存实例不生效。
    """
    provider = (os.getenv("LLM_PROVIDER", "external") or "external").strip().lower()
    if provider != "local":
        provider = "external"
    model_cls = LocalProvider if provider == "local" else ExternalProvider

    try:
        async with get_session()() as session:
            result = await session.execute(
                select(model_cls).order_by(model_cls.id).limit(1)
            )
            row = result.scalar_one_or_none()
    except Exception as e:
        logger.error(
            f"{get_request_id()}读取 LLM 提供商配置失败: "
            f"provider={provider}, table={model_cls.__tablename__}, {e}",
            exc_info=True,
        )
        return None

    if row is None:
        logger.warning(
            f"{get_request_id()}{model_cls.__tablename__} 表无数据，"
            f"LLM 提供商配置为空"
        )
        return None

    config = {
        "provider": provider,
        "api_key": row.api_key,
        "llm_base_url": row.llm_base_url,
        "embd_base_url": row.embd_base_url,
        "vl_base_url": row.vl_base_url,
    }
    set_llm_provider_config(config)
    logger.info(
        f"{get_request_id()}LLM 提供商配置已加载: 来源={model_cls.__tablename__} 表, "
        f"llm_base_url={row.llm_base_url}"
    )
    return config


# ==========================================
# SSO 配置（sso_settings）
# ==========================================


async def load_oauth_config() -> Optional[dict]:
    """从 sso_settings 表读取首行 SSO 配置并注入全局缓存。

    取 id 最小行作为生效配置（与 external_provider / local_provider 语义一致）。
    表无数据或读取失败时缓存保持原状，view_sso_login 拒绝 SSO 登录。
    """
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(SsoSettings).order_by(SsoSettings.id).limit(1)
            )
            row = result.scalar_one_or_none()
    except Exception as e:
        logger.error(
            f"{get_request_id()}读取 SSO 配置失败: table=sso_settings, {e}",
            exc_info=True,
        )
        return None

    if row is None:
        logger.warning(
            f"{get_request_id()}sso_settings 表无数据，SSO 登录不可用"
        )
        return None

    config = {
        "client_id": row.client_id,
        "client_secret": row.client_secret,
        "redirect_uri": row.redirect_uri,
    }
    set_oauth_config(config)
    logger.info(
        f"{get_request_id()}SSO 配置已加载: 来源=sso_settings 表, "
        f"client_id={row.client_id}"
    )
    return config


# ==========================================
# SQL Agent 目标库配置（agent_db_settings）
# ==========================================


async def list_agent_db_settings() -> List[AgentDBSettings]:
    """读取全部 SQL Agent 目标库配置，按 id 升序；失败时返回空列表。"""
    try:
        async with get_session()() as session:
            result = await session.execute(
                select(AgentDBSettings).order_by(AgentDBSettings.id)
            )
            return list(result.scalars().all())
    except Exception as e:
        logger.error(f"{get_request_id()}读取 SQL Agent 数据库配置失败: {e}", exc_info=True)
        return []


async def get_agent_db_settings(
    db_name: Optional[str] = None,
) -> Optional[AgentDBSettings]:
    """按库名读取 SQL Agent 目标库配置；db_name 为空时取首行作为默认配置。"""
    try:
        async with get_session()() as session:
            stmt = select(AgentDBSettings).order_by(AgentDBSettings.id)
            if db_name:
                stmt = stmt.where(AgentDBSettings.db_name == db_name)
            result = await session.execute(stmt.limit(1))
            return result.scalar_one_or_none()
    except Exception as e:
        logger.error(
            f"{get_request_id()}读取 SQL Agent 数据库配置失败: db_name={db_name}, {e}",
            exc_info=True,
        )
        return None


def merge_context(
    db_history: Optional[List[Dict[str, str]]] = None,
    frontend_context: Optional[List[Dict[str, str]]] = None,
    max_rounds: int = DEFAULT_MAX_ROUNDS,
) -> List[Dict[str, str]]:
    context = frontend_context if frontend_context else db_history or []

    if not context:
        return []

    max_messages = max_rounds * 2

    if len(context) > max_messages:
        context = context[-max_messages:]
        logger.info(
            f"{get_request_id()}上下文已截断: 保留最近 {max_rounds} 轮 ({max_messages} 条消息)"
        )

    return context


# ==========================================
# SSO 单点登录（ADFS OAuth2 授权码授予流）
# ==========================================

# client_secret 仅服务端持有，从 sso_settings 表读取，绝不进入前端代码。

# SSO 用户无密码：写入一个不会被任何 sha256 摘要命中的占位符，
# 既满足 users.password_hash NOT NULL 约束，又保证密码登录路径拒登。
_SSO_PASSWORD_PLACEHOLDER = "SSO_USER_NO_PASSWORD"

# 旧用户因邮箱大小写差异导致重复建档：SSO 入口统一以小写 email 建档与查询。
def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _sanitize_header(value: object) -> str:
    """剔除 CR/LF，防邮件头/用户名注入。"""
    return re.sub(r"[\r\n]+", " ", str(value or "")).strip()


async def view_sso_login(code: str, state: str) -> AuthResponseType:
    """SSO 登录：ADFS 授权码授予流。

    流程：
    1. 前端经 ADFS /authorize 重定向回业务站点，携带 code + state；
    2. 本接口用 code + client_secret（仅服务端持有）到 /token 换 id_token；
    3. 验签 / 校验 id_token，提取 upn/email/name 建档或更新会话；
    4. 写入 user_tokens 行（与密码登录一致，Bearer 鉴权链路复用），
       不再向 IdP 暴露会话 token。

    返回结构与 login/register 一致（AuthResponseType），前端可复用登录态写入逻辑。
    """
    from x_models.id_x_010.src.models.x_models import get_oauth_config

    oauth_cfg = get_oauth_config() or await load_oauth_config()
    if not oauth_cfg or not (
        oauth_cfg.get("client_id")
        and oauth_cfg.get("client_secret")
        and oauth_cfg.get("redirect_uri")
    ):
        logger.error(
            f"{get_request_id()}SSO 服务端配置缺失（sso_settings 表无数据）"
        )
        return AuthResponseType(success=False, message="SSO 服务未配置")

    client_id = oauth_cfg["client_id"]
    client_secret = oauth_cfg["client_secret"]
    redirect_uri = oauth_cfg["redirect_uri"]

    rid = get_request_id()
    logger.info(
        f"{rid}SSO 登录请求: has_code={bool(code)} has_state={bool(state)}"
    )
    if not code:
        return AuthResponseType(success=False, message="缺少授权码")

    # 防重放 nonce：与本次授权码绑定，ADFS 回显后由 exchange_code_for_token 校验
    expected_nonce = hashlib.sha256(code.encode("utf-8")).hexdigest()
    token_resp = x_oauth.exchange_code_for_token(
        code=code,
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        expected_nonce=expected_nonce,
    )
    if token_resp is None:
        logger.warning(
            f"{rid}SSO /token 换取失败（code 无效/过期/已用/重放或网络问题）"
        )
        return AuthResponseType(success=False, message="授权码无效或已过期")

    id_token = x_oauth.extract_id_token(token_resp)
    if not id_token:
        logger.warning(
            f"{rid}SSO /token 响应缺少 id_token: keys={list(token_resp.keys())}"
        )
        return AuthResponseType(success=False, message="授权服务未返回令牌")

    logger.info(f"{rid}SSO 换取 id_token 成功，开始验签")
    payload_data, reason = x_oauth.verify_id_token(
        id_token, expected_aud=client_id
    )
    if payload_data is None:
        # 失败诊断直接进 warn.log：payload keys 是定位 ADFS 配置问题的关键证据
        _payload = x_oauth.decode_payload_unverified(id_token) or {}
        logger.warning(
            f"{rid}SSO id_token 验签/校验失败: reason={reason} "
            f"keys={sorted(_payload.keys())} aud={_payload.get('aud')!r} "
            f"iss={_payload.get('iss')!r} exp={_payload.get('exp')!r} now={int(time.time())}"
        )
        return AuthResponseType(success=False, message="令牌校验失败")

    identity = x_oauth.resolve_identity_claims(payload_data)
    if identity is None:
        logger.warning(
            f"{rid}SSO 身份声明解析失败: keys={sorted(payload_data.keys())}"
        )
        return AuthResponseType(success=False, message="身份声明不足，无法登录")

    logger.info(
        f"{rid}SSO 身份解析成功: upn_claim={identity['upn_claim']} "
        f"email_claim={identity['email_claim']}"
    )

    email = _normalize_email(_sanitize_header(identity.get("email")))
    upn = _sanitize_header(identity.get("upn")) or email
    # 010 的 users 表无独立 username/number 字段，display_name 仅用于日志；
    # 登录账号以 email 为唯一标识，与 register/login 路径一致。
    if not email:
        logger.warning(f"{rid}SSO email 缺失，拒绝登录: upn={upn}")
        return AuthResponseType(success=False, message="身份声明缺少邮箱")

    try:
        async with get_session()() as session:
            result = await session.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()

            if user is None:
                # 首次 SSO 登录：自动建档（与 register 不同的是直接置 is_active=True，
                # 因为 SSO 断言本身就是身份认证，无需管理员激活）
                user = User(
                    email=email,
                    password_hash=_SSO_PASSWORD_PLACEHOLDER,
                    is_active=True,
                    role="user",
                    is_admin=False,
                )
                session.add(user)
                await session.flush()
                logger.warning(
                    f"{rid}SSO 新用户建档: email={email} upn={upn} "
                    f"name={identity.get('display_name')}"
                )
            elif user.is_active is False:
                # 老用户但已被停用：与 login 一致拒绝（防已注销账号经 SSO 绕过）
                logger.warning(
                    f"{rid}SSO 拒绝已停用账号: user_id={user.id} email={email}"
                )
                return AuthResponseType(success=False, message="账号已被停用")
            elif user.is_active is not True:
                # 老用户且 is_active 未显式置 True（如密码注册待激活），
                # SSO 断言即身份认证，直接激活并补齐会话
                logger.info(
                    f"{rid}SSO 激活待启用账号: user_id={user.id} email={email}"
                )
                user.is_active = True

            # 统一签发 24 小时会话令牌（与 login 一致），复用 UserToken 表与
            # Bearer 鉴权链路。登出场景下旧令牌自然失效，无需主动清理。
            token = secrets.token_urlsafe(32)
            expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
            session.add(UserToken(user_id=user.id, token=token, expires_at=expires_at))
            await session.commit()
            await session.refresh(user)

            logger.info(f"{rid}SSO 登录成功: user_id={user.id} email={email}")
            return AuthResponseType(
                success=True,
                message="SSO 登录成功",
                token=token,
                expires_at=expires_at.isoformat(),
                user=build_user_info(user),
            )
    except Exception as e:
        logger.error(f"{rid}SSO 登录落库失败: {e}", exc_info=True)
        return AuthResponseType(success=False, message=f"登录失败: {str(e)}")
