import hashlib
import imghdr
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, List, Optional

import strawberry
from litestar import MediaType, Request, Response, Router, get, post
from litestar.response import Stream
from sqlalchemy import func, select

from utils.log_util import get_request_id, logger, request_id_var
from x_models.id_x_010.src.agents.x_langgraph_supervisor import (
    LangGraphSupervisor,
    get_orchestrator,
)
from x_models.id_x_010.src.agents.x_sql_agent import SQLAgent
from x_models.id_x_010.src.models.x_models import (
    ExternalModel,
    LocalModel,
    PasswordResetToken,
    UsageLog,
    User,
    UserMarkdownPrompt,
    UserModelSettings,
    UserToken,
    get_session,
)
from x_models.id_x_010.src.schemas.x_schemas import (
    AuthResponseType,
    ChatInput,
    ChatResponseType,
    DatabaseInfoType,
    DatabaseListResponseType,
    ForgotPasswordInput,
    ForgotPasswordResponseType,
    HealthType,
    LoginInput,
    MarkdownPromptListResponseType,
    MarkdownPromptResponseType,
    MarkdownPromptType,
    ModelListResponseType,
    ModelSettingsInput,
    ModelSettingsResponseType,
    ModelSettingsType,
    ModelType,
    OauthInput,
    RegisterInput,
    StreamChunkType,
    TestConnectionInput,
    TestConnectionResponseType,
    UsageDailyType,
    UsageModelBreakdownType,
    UsageStatsResponseType,
    UserInfoType,
    UpdateProfileInput,
    UpdateProfileResponseType,
    ExternalModelInput,
    ExternalModelType,
    ExternalModelListResponseType,
    ExternalModelMutationResponseType,
    DeleteExternalModelResponseType,
    SetActiveModelResponseType,
)
from x_models.id_x_010.src.views.x_views import (
    build_user_info,
    create_user_markdown_prompt,
    delete_external_model,
    delete_markdown_prompt,
    get_active_markdown_prompt,
    get_conversation_history,
    get_external_model_by_id,
    get_external_model_by_name,
    get_user_avatar,
    get_user_model_settings,
    list_agent_db_settings,
    list_external_models,
    list_user_markdown_prompts,
    load_llm_provider_config,
    merge_context,
    rename_markdown_prompt,
    save_conversation_log,
    save_usage_log,
    select_markdown_prompt,
    set_user_avatar,
    test_model_connectivity,
    update_markdown_content,
    update_user_profile,
    upsert_external_model,
    upsert_user_model_settings,
    view_sso_login,
)


@strawberry.type
class Query:
    @strawberry.field(description="健康检查")
    async def health(self) -> HealthType:
        return HealthType(status="ok", service="id_x_010")

    @strawberry.field(description="获取模型列表")
    async def get_models(self) -> ModelListResponseType:
        try:
            models = []

            async with get_session()() as session:
                external_result = await session.execute(select(ExternalModel))
                external_models = external_result.scalars().all()

                for model in external_models:
                    models.append(
                        ModelType(
                            id=model.id,
                            name=model.name,
                            provider=model.provider,
                            base_url=model.base_url,
                            model_type="external",
                        )
                    )

                local_result = await session.execute(select(LocalModel))
                local_models = local_result.scalars().all()

                for model in local_models:
                    models.append(
                        ModelType(
                            id=model.id,
                            name=model.name,
                            provider=model.provider,
                            base_url=model.base_url,
                            model_type="local",
                        )
                    )

            if not models:
                logger.warning(
                    f"{get_request_id()}数据库模型表为空，尝试从环境变量回退获取模型列表"
                )
                return Query._fallback_models()

            logger.info(
                f"{get_request_id()}成功获取模型列表: {len(external_models)} 个外部模型, "
                f"{len(local_models)} 个本地模型"
            )

            return ModelListResponseType(
                success=True,
                message=f"成功获取 {len(models)} 个模型",
                models=models,
            )

        except Exception as e:
            logger.error(f"{get_request_id()}获取模型列表失败: {e}", exc_info=True)
            # 数据库查询失败时，尝试环境变量回退
            return Query._fallback_models(str(e))

    @staticmethod
    def _fallback_models(error_msg: str = "") -> ModelListResponseType:
        """当数据库不可用时，从环境变量回退获取模型列表。"""
        import os as _os

        models = []
        base_url = _os.getenv("EXTERNAL_BASE_URL", "")
        if base_url:
            models.append(
                ModelType(
                    id=-1,
                    name="external-default",
                    provider="external",
                    base_url=base_url,
                    model_type="external",
                )
            )

        local_base_url = _os.getenv("LOCAL_MODEL_BASE_URL", "")
        if local_base_url:
            models.append(
                ModelType(
                    id=-2,
                    name="local-default",
                    provider="local",
                    base_url=local_base_url,
                    model_type="local",
                )
            )

        source = (
            f"（回退模式{f': {error_msg}' if error_msg else ''}）"
            if error_msg or not any([_os.getenv("EXTERNAL_BASE_URL")])
            else ""
        )
        message = f"回退获取 {len(models)} 个模型" if models else "无可用模型"
        if source:
            message += source

        return ModelListResponseType(
            success=len(models) > 0,
            message=message,
            models=models,
        )

    @strawberry.field(description="获取数据库列表")
    async def get_databases(self) -> "DatabaseListResponseType":
        try:
            db_items = []

            # 优先从 agent_db_settings 表读取可用数据库
            agent_db_rows = await list_agent_db_settings()
            if agent_db_rows:
                db_items = [
                    DatabaseInfoType(
                        key=row.db_name, label=row.db_label or row.db_name
                    )
                    for row in agent_db_rows
                ]
            else:
                # 表无数据时回退环境变量 AGENT_DB_LIST（JSON 映射或逗号分隔）
                # JSON 格式：{"显示名": "真实库名"}，前端渲染显示名（label），
                # 后端按真实库名（key）匹配 agent_db_settings 并建连
                db_list_str = os.getenv("AGENT_DB_LIST", "")
                if db_list_str:
                    try:
                        db_dict = json.loads(db_list_str)
                        db_items = [
                            DatabaseInfoType(key=v, label=k) for k, v in db_dict.items()
                        ]
                    except (json.JSONDecodeError, AttributeError):
                        # 兼容旧格式：逗号分隔的纯名称列表
                        db_items = [
                            DatabaseInfoType(key=name.strip(), label=name.strip())
                            for name in db_list_str.split(",")
                            if name.strip()
                        ]

            logger.info(
                f"{get_request_id()}获取数据库列表: {[(d.key, d.label) for d in db_items]}"
            )

            return DatabaseListResponseType(
                success=True,
                message=f"成功获取 {len(db_items)} 个数据库",
                databases=db_items,
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取数据库列表失败: {e}", exc_info=True)
            return DatabaseListResponseType(
                success=False,
                message=f"获取数据库列表失败: {str(e)}",
                databases=[],
            )

    @strawberry.field(description="获取当前用户的模型设置")
    async def get_model_settings(
        self, info: strawberry.Info
    ) -> ModelSettingsResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ModelSettingsResponseType(
                    success=False, message="未登录或登录已过期", settings=None
                )

            settings = await get_user_model_settings(user.id)
            if settings is None:
                return ModelSettingsResponseType(
                    success=True, message="尚未配置模型设置", settings=None
                )

            return ModelSettingsResponseType(
                success=True,
                message="获取成功",
                settings=_settings_type(settings),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取模型设置失败: {e}", exc_info=True)
            return ModelSettingsResponseType(
                success=False, message=f"获取模型设置失败: {str(e)}", settings=None
            )

    @strawberry.field(description="列出当前用户的全部 Markdown 提示词")
    async def list_markdown_prompts(
        self, info: strawberry.Info
    ) -> MarkdownPromptListResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptListResponseType(
                    success=False, message="未登录或登录已过期", prompts=[]
                )

            prompts = await list_user_markdown_prompts(user.id)
            return MarkdownPromptListResponseType(
                success=True,
                message=f"成功获取 {len(prompts)} 条提示词",
                prompts=[_prompt_type(p) for p in prompts],
            )
        except Exception as e:
            logger.error(f"{get_request_id()}列出提示词失败: {e}", exc_info=True)
            return MarkdownPromptListResponseType(
                success=False, message=f"列出提示词失败: {str(e)}", prompts=[]
            )

    @strawberry.field(description="获取当前用户选中的提示词（每轮对话自动注入）")
    async def get_active_markdown_prompt(
        self, info: strawberry.Info
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            prompt = await get_active_markdown_prompt(user.id)
            if prompt is None:
                return MarkdownPromptResponseType(
                    success=True, message="未选中任何提示词", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True, message="获取成功", prompt=_prompt_type(prompt)
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取活跃提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"获取活跃提示词失败: {str(e)}", prompt=None
            )

    @strawberry.field(description="获取当前用户的用量统计（按日聚合，用于流量统计面板）")
    async def usage_stats(
        self, info: strawberry.Info, days: int = 30
    ) -> UsageStatsResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UsageStatsResponseType(
                    success=False,
                    message="未登录或登录已过期",
                    days=days,
                    daily=[],
                    by_model=[],
                    total_requests=0,
                    total_tokens=0,
                    total_cost_usd=0.0,
                )

            days = max(1, min(days, 365))
            start = datetime.now(timezone.utc) - timedelta(days=days)

            async with get_session()() as session:
                # —— 按日聚合（func.date 将 timestamptz 截断为 UTC 日期文本）——
                date_col = func.date(UsageLog.created_at).label("d")
                in_col = func.coalesce(func.sum(UsageLog.input_tokens), 0).label(
                    "in_tok"
                )
                out_col = func.coalesce(func.sum(UsageLog.output_tokens), 0).label(
                    "out_tok"
                )
                tot_col = func.coalesce(func.sum(UsageLog.total_tokens), 0).label(
                    "tot_tok"
                )
                cost_col = func.coalesce(func.sum(UsageLog.cost_usd), 0.0).label(
                    "cost"
                )
                daily_stmt = (
                    select(date_col, func.count().label("cnt"), in_col, out_col, tot_col, cost_col)
                    .where(
                        UsageLog.user_id == user.id,
                        UsageLog.created_at >= start,
                    )
                    .group_by(date_col)
                    .order_by(date_col)
                )
                daily_rows = (await session.execute(daily_stmt)).all()

                daily: List[UsageDailyType] = []
                for row in daily_rows:
                    daily.append(
                        UsageDailyType(
                            date=str(row.d),
                            request_count=int(row.cnt),
                            input_tokens=int(row.in_tok),
                            output_tokens=int(row.out_tok),
                            total_tokens=int(row.tot_tok),
                            cost_usd=float(row.cost),
                        )
                    )

                # —— 按模型聚合 ——
                model_cost_col = func.coalesce(
                    func.sum(UsageLog.cost_usd), 0.0
                ).label("cost")
                model_tot_col = func.coalesce(
                    func.sum(UsageLog.total_tokens), 0
                ).label("tot_tok")
                model_stmt = (
                    select(
                        UsageLog.model_name,
                        func.count().label("cnt"),
                        model_tot_col,
                        model_cost_col,
                    )
                    .where(
                        UsageLog.user_id == user.id,
                        UsageLog.created_at >= start,
                    )
                    .group_by(UsageLog.model_name)
                    .order_by(model_cost_col.desc())
                )
                model_rows = (await session.execute(model_stmt)).all()

                by_model: List[UsageModelBreakdownType] = []
                for row in model_rows:
                    by_model.append(
                        UsageModelBreakdownType(
                            model_name=row.model_name or "未知模型",
                            request_count=int(row.cnt),
                            total_tokens=int(row.tot_tok),
                            cost_usd=float(row.cost),
                        )
                    )

                total_requests = sum(d.request_count for d in daily)
                total_tokens = sum(d.total_tokens for d in daily)
                total_cost = sum(d.cost_usd for d in daily)

                return UsageStatsResponseType(
                    success=True,
                    message=f"近 {days} 天用量统计",
                    days=days,
                    daily=daily,
                    by_model=by_model,
                    total_requests=total_requests,
                    total_tokens=total_tokens,
                    total_cost_usd=round(total_cost, 6),
                )
        except Exception as e:
            logger.error(f"{get_request_id()}获取用量统计失败: {e}", exc_info=True)
            return UsageStatsResponseType(
                success=False,
                message=f"获取用量统计失败: {str(e)}",
                days=days,
                daily=[],
                by_model=[],
                total_requests=0,
                total_tokens=0,
                total_cost_usd=0.0,
            )

    @strawberry.field(description="获取 external_models 表全部记录（含 api_key，供弹窗编辑）")
    async def external_models(self) -> ExternalModelListResponseType:
        try:
            rows = await list_external_models()
            models = [
                ExternalModelType(
                    id=r.id,
                    name=r.name,
                    provider=r.provider,
                    base_url=r.base_url,
                    api_key=r.api_key,
                )
                for r in rows
            ]
            return ExternalModelListResponseType(
                success=True,
                message=f"成功获取 {len(models)} 个外部模型",
                models=models,
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取外部模型列表失败: {e}", exc_info=True)
            return ExternalModelListResponseType(
                success=False, message=f"获取失败: {str(e)}", models=[]
            )


async def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


async def generate_token() -> str:
    return secrets.token_urlsafe(32)


async def verify_token(token: str) -> Optional[User]:
    if not token:
        return None

    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserToken).where(UserToken.token == token)
            )
            user_token = result.scalar_one_or_none()

            if user_token is None:
                logger.warning(f"{get_request_id()}令牌不存在: {token[:8]}...")
                return None

            if not user_token.is_valid():
                logger.warning(f"{get_request_id()}令牌已过期: {token[:8]}...")
                return None

            user_result = await session.execute(
                select(User).where(User.id == user_token.user_id)
            )
            user = user_result.scalar_one_or_none()

            return user

    except Exception as e:
        logger.error(f"{get_request_id()}验证令牌失败: {e}", exc_info=True)
        return None


def _get_info_request(info: strawberry.Info):
    """从 strawberry context 中取 Litestar Request（默认 context 为 dict）。"""
    ctx = info.context
    if isinstance(ctx, dict):
        return ctx.get("request")
    return getattr(ctx, "request", None)


async def _get_bearer_user(request) -> Optional[User]:
    """从请求头 Authorization: Bearer <token> 解析并校验用户。"""
    if request is None:
        return None
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    return await verify_token(auth_header[7:].strip())


async def _get_bearer_settings(request) -> Optional[UserModelSettings]:
    """解析请求属主用户并返回其模型设置；未登录或未配置时返回 None。"""
    user = await _get_bearer_user(request)
    if user is None:
        return None
    return await get_user_model_settings(user.id)


def _settings_type(settings: UserModelSettings) -> ModelSettingsType:
    return ModelSettingsType(
        provider=settings.provider,
        base_url=settings.base_url,
        api_key=settings.api_key,
        model_name=settings.model_name,
        updated_at=settings.updated_at.isoformat() if settings.updated_at else None,
    )


@strawberry.type
class Mutation:
    @strawberry.mutation(description="发送聊天请求（非流式）")
    async def chat(
        self, info: strawberry.Info, input: ChatInput
    ) -> ChatResponseType:
        try:
            base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
            api_key = os.getenv("OPENROUTER_API_KEY", "")

            logger.info(
                f"{get_request_id()}收到聊天请求: query='{input.query[:50]}...', "
                f"model_type={input.model_type}, "
                f"model_name={input.model_name}, "
                f"agent_type={input.agent_type}, "
                f"stream={input.stream}, "
                f"url={base_url}, "
                f"api_key={api_key}"
            )

            context = None
            if input.context:
                try:
                    context = [
                        json.loads(ctx) if isinstance(ctx, str) else ctx
                        for ctx in input.context
                    ]
                except json.JSONDecodeError:
                    context = None

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 用户已保存自定义模型设置时，以其覆盖默认链路配置
            request = _get_info_request(info)
            user_settings = await _get_bearer_settings(request)

            if user_settings is not None:
                orchestrator = LangGraphSupervisor(
                    model_type=input.model_type,
                    model_name=user_settings.model_name,
                    api_key=user_settings.api_key,
                    base_url=user_settings.base_url,
                )
                chat_api_key = user_settings.api_key
                chat_base_url = user_settings.base_url
                chat_model_name = user_settings.model_name
            else:
                orchestrator = get_orchestrator()
                chat_api_key = None
                chat_base_url = None
                chat_model_name = input.model_name

            # 自动注入用户当前选中的 Markdown 提示词（每轮对话均携带）
            active_prompt_content: Optional[str] = None
            user = await _get_bearer_user(request)
            if user is not None:
                active_prompt = await get_active_markdown_prompt(user.id)
                if active_prompt is not None:
                    active_prompt_content = active_prompt.content
                    logger.info(
                        f"{get_request_id()}已注入提示词: filename={active_prompt.filename}, "
                        f"chars={len(active_prompt.content)}"
                    )

            result = await orchestrator.process(
                query=input.query,
                model_type=input.model_type,
                model_name=chat_model_name,
                agent_type=input.agent_type,
                conversation_id=input.conversation_id,
                context=context,
                db_name=input.db_name,
                api_key=chat_api_key,
                base_url=chat_base_url,
                prompt_content=active_prompt_content,
            )

            try:
                await save_conversation_log(
                    conversation_id=result["conversation_id"],
                    user_query=input.query,
                    model_response=result["response"],
                    thinking_process=result["thinking"],
                    model_type=input.model_type,
                    model_name=result["model_used"],
                    intent=result["intent"] or "",
                )
            except Exception as e:
                logger.error(f"{get_request_id()}保存对话日志失败: {e}", exc_info=True)

            return ChatResponseType(
                response=result["response"],
                thinking=result["thinking"],
                conversation_id=result["conversation_id"],
                model_used=result["model_used"],
                success=result["success"],
            )

        except Exception as e:
            logger.error(f"{get_request_id()}聊天接口错误: {e}", exc_info=True)
            raise Exception(f"处理请求失败: {str(e)}")

    @strawberry.mutation(description="用户登录")
    async def login(self, input: LoginInput) -> AuthResponseType:
        try:
            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                user = result.scalar_one_or_none()

                if user is None:
                    return AuthResponseType(success=False, message="用户不存在")

                password_hash = await hash_password(input.password)
                if user.password_hash != password_hash:
                    return AuthResponseType(success=False, message="密码错误")

                if user.is_active is False:
                    return AuthResponseType(success=False, message="用户尚未激活")

                token = await generate_token()

                expires_at = datetime.utcnow() + timedelta(hours=24)

                user_token = UserToken(
                    user_id=user.id,
                    token=token,
                    expires_at=expires_at,
                )
                session.add(user_token)
                await session.commit()
                await session.refresh(user)

                return AuthResponseType(
                    success=True,
                    message="登录成功",
                    token=token,
                    expires_at=expires_at.isoformat(),
                    user=build_user_info(user),
                )

        except Exception as e:
            logger.error(f"{get_request_id()}登录失败: {e}", exc_info=True)
            return AuthResponseType(success=False, message=f"登录失败: {str(e)}")

    @strawberry.mutation(description="SSO 单点登录（ADFS 授权码授予流，首次自动建档）")
    async def sso_login(self, input: OauthInput) -> AuthResponseType:
        return await view_sso_login(code=input.code, state=input.state)

    @strawberry.mutation(description="用户注册")
    async def register(self, input: RegisterInput) -> AuthResponseType:
        try:
            if input.password != input.confirm_password:
                return AuthResponseType(success=False, message="两次密码输入不一致")

            if len(input.password) < 6:
                return AuthResponseType(success=False, message="密码长度至少6位")

            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                existing_user = result.scalar_one_or_none()

                if existing_user:
                    return AuthResponseType(success=False, message="邮箱已被注册")

                password_hash = await hash_password(input.password)
                new_user = User(
                    email=input.email,
                    password_hash=password_hash,
                    phone=input.phone,
                    is_active=False,
                )
                session.add(new_user)
                await session.commit()
                await session.refresh(new_user)

                return AuthResponseType(
                    success=True,
                    message="注册成功，请等待管理员激活账户",
                    token=None,
                    user=build_user_info(new_user),
                )

        except Exception as e:
            logger.error(f"{get_request_id()}注册失败: {e}", exc_info=True)
            return AuthResponseType(success=False, message=f"注册失败: {str(e)}")

    @strawberry.mutation(description="忘记密码")
    async def forgot_password(
        self, input: ForgotPasswordInput
    ) -> ForgotPasswordResponseType:
        try:
            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                user = result.scalar_one_or_none()

                if user is None:
                    return ForgotPasswordResponseType(
                        success=True,
                        message="如果邮箱存在，重置链接已发送",
                    )

                old_tokens_result = await session.execute(
                    select(PasswordResetToken).where(
                        PasswordResetToken.user_id == user.id,
                        PasswordResetToken.used.is_(False),
                    )
                )
                old_tokens = old_tokens_result.scalars().all()
                for old_token in old_tokens:
                    old_token.used = True

                reset_token = secrets.token_urlsafe(32)
                expires_at = datetime.utcnow() + timedelta(hours=1)

                new_token = PasswordResetToken(
                    user_id=user.id,
                    token=reset_token,
                    expires_at=expires_at,
                )
                session.add(new_token)
                await session.commit()

                return ForgotPasswordResponseType(
                    success=True,
                    message="重置令牌已生成，生产环境应发送邮件",
                    reset_token=reset_token,
                )

        except Exception as e:
            logger.error(f"{get_request_id()}忘记密码处理失败: {e}", exc_info=True)
            return ForgotPasswordResponseType(
                success=False, message=f"处理失败: {str(e)}"
            )

    @strawberry.mutation(description="SQL审批操作")
    async def sql_approval(
        self,
        info: strawberry.Info,
        conversation_id: str,
        sql: str,
        action: str,
        question: str,
        model_type: str = "external",
        model_name: Optional[str] = None,
        db_name: Optional[str] = None,
    ) -> AsyncGenerator[StreamChunkType, None]:
        try:
            if action == "cancel":
                yield StreamChunkType(
                    type="sql_cancelled",
                    content="用户取消了本次查询",
                )
                return

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 用户已保存自定义模型设置时，以其覆盖默认链路配置
            user_settings = await _get_bearer_settings(_get_info_request(info))
            if user_settings is not None:
                model_name = user_settings.model_name

            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=user_settings.api_key if user_settings else None,
                base_url=user_settings.base_url if user_settings else None,
                db_name=db_name,
            )

            if action == "approve":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=True, question=question
                ):
                    yield StreamChunkType(
                        type=chunk.get("type", ""),
                        content=chunk.get("content"),
                        model_used=chunk.get("model_used"),
                        conversation_id=conversation_id,
                        sql=chunk.get("sql"),
                    )
            elif action == "reject":
                last_chunk_type = None
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=False, question=question
                ):
                    last_chunk_type = chunk.get("type", "")
                    yield StreamChunkType(
                        type=chunk.get("type", ""),
                        content=chunk.get("content"),
                        model_used=chunk.get("model_used"),
                        conversation_id=conversation_id,
                        sql=chunk.get("sql"),
                    )

                if last_chunk_type == "sql_rejected":
                    async for chunk2 in sql_agent.stream_query(question=question):
                        yield StreamChunkType(
                            type=chunk2.get("type", ""),
                            content=chunk2.get("content"),
                            model_used=chunk2.get("model_used"),
                            conversation_id=conversation_id,
                            sql=chunk2.get("sql"),
                        )
        except Exception as e:
            logger.error(f"{get_request_id()}SQL审批接口错误: {e}", exc_info=True)
            yield StreamChunkType(
                type="error",
                content=f"审批处理失败: {str(e)}",
            )

    @strawberry.mutation(description="保存当前用户的模型设置（保存前先做连通性检测）")
    async def save_model_settings(
        self, info: strawberry.Info, input: ModelSettingsInput
    ) -> ModelSettingsResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ModelSettingsResponseType(
                    success=False, message="未登录或登录已过期", settings=None
                )

            provider = input.provider.strip()
            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_name = input.model_name.strip()

            if not all([provider, base_url, api_key, model_name]):
                return ModelSettingsResponseType(
                    success=False,
                    message="模型厂商、访问地址、API-KEY、模型名称均为必填项",
                    settings=None,
                )

            logger.info(
                f"{get_request_id()}收到模型设置保存请求，开始连通性检测: "
                f"user_id={user.id}, provider={provider}, "
                f"model={model_name}, base_url={base_url}"
            )

            ok, message = await test_model_connectivity(
                base_url=base_url, api_key=api_key, model_name=model_name
            )
            if not ok:
                return ModelSettingsResponseType(
                    success=False,
                    message=f"连通性检测未通过，设置未保存: {message}",
                    settings=None,
                )

            settings = await upsert_user_model_settings(
                user_id=user.id,
                provider=provider,
                base_url=base_url,
                api_key=api_key,
                model_name=model_name,
            )

            # 同步登记到 external_models 表，使该模型出现在 get_models()
            # 返回的模型列表中（消息输入框的模型选择器可选用）。
            # 失败不影响用户设置已保存的事实，仅记日志。
            try:
                await upsert_external_model(
                    name=model_name,
                    provider=provider,
                    base_url=base_url,
                    api_key=api_key,
                )
            except Exception as sync_err:
                logger.warning(
                    f"{get_request_id()}同步登记 external_models 失败（用户设置已保存）: {sync_err}"
                )

            return ModelSettingsResponseType(
                success=True,
                message=f"{message}，设置已保存",
                settings=_settings_type(settings),
            )

        except Exception as e:
            logger.error(f"{get_request_id()}保存模型设置失败: {e}", exc_info=True)
            return ModelSettingsResponseType(
                success=False, message=f"保存模型设置失败: {str(e)}", settings=None
            )

    @strawberry.mutation(description="测试模型连通性（不落库），用于保存前的独立检测")
    async def test_connection(
        self, info: strawberry.Info, input: TestConnectionInput
    ) -> TestConnectionResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return TestConnectionResponseType(
                    success=False, message="未登录或登录已过期"
                )

            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_name = input.model_name.strip()

            if not all([base_url, api_key, model_name]):
                return TestConnectionResponseType(
                    success=False,
                    message="访问地址、API-KEY、模型名称均为必填项",
                )

            logger.info(
                f"{get_request_id()}收到连通性测试请求: user_id={user.id}, "
                f"model={model_name}, base_url={base_url}"
            )

            ok, message = await test_model_connectivity(
                base_url=base_url, api_key=api_key, model_name=model_name
            )
            return TestConnectionResponseType(success=ok, message=message)
        except Exception as e:
            logger.error(f"{get_request_id()}连通性测试失败: {e}", exc_info=True)
            return TestConnectionResponseType(
                success=False, message=f"连通性测试失败: {str(e)}"
            )

    @strawberry.mutation(description="新增/更新外部模型到 external_models 表（支持多模型 + Provider 自定义）")
    async def save_external_model(
        self, info: strawberry.Info, input: ExternalModelInput
    ) -> ExternalModelMutationResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ExternalModelMutationResponseType(
                    success=False, message="未登录或登录已过期", model=None
                )

            provider = input.provider.strip()
            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_name = input.model_name.strip()

            if not all([provider, base_url, api_key, model_name]):
                return ExternalModelMutationResponseType(
                    success=False,
                    message="厂商、访问地址、API-KEY、模型名称均为必填项",
                    model=None,
                )

            # 可选连通性检测（默认开启）
            if input.test_connection:
                logger.info(
                    f"{get_request_id()}保存外部模型前连通性检测: "
                    f"provider={provider}, model={model_name}"
                )
                ok, msg = await test_model_connectivity(
                    base_url=base_url, api_key=api_key, model_name=model_name
                )
                if not ok:
                    return ExternalModelMutationResponseType(
                        success=False,
                        message=f"连通性检测未通过，模型未保存: {msg}",
                        model=None,
                    )

            saved = await upsert_external_model(
                name=model_name,
                provider=provider,
                base_url=base_url,
                api_key=api_key,
            )
            if saved is None:
                return ExternalModelMutationResponseType(
                    success=False, message="保存到数据库失败", model=None
                )

            result_model = ExternalModelType(
                id=saved.id,
                name=saved.name,
                provider=saved.provider,
                base_url=saved.base_url,
                api_key=saved.api_key,
            )
            msg = (
                "连通性检测通过，模型已保存"
                if input.test_connection
                else "模型已保存"
            )
            return ExternalModelMutationResponseType(
                success=True, message=msg, model=result_model
            )
        except Exception as e:
            logger.error(f"{get_request_id()}保存外部模型失败: {e}", exc_info=True)
            return ExternalModelMutationResponseType(
                success=False, message=f"保存失败: {str(e)}", model=None
            )

    @strawberry.mutation(description="删除 external_models 表中的指定模型")
    async def delete_external_model(
        self, info: strawberry.Info, model_id: int
    ) -> DeleteExternalModelResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return DeleteExternalModelResponseType(
                    success=False, message="未登录或登录已过期"
                )

            ok = await delete_external_model(model_id)
            if not ok:
                return DeleteExternalModelResponseType(
                    success=False, message="模型不存在或已被删除"
                )
            return DeleteExternalModelResponseType(
                success=True, message="模型已删除"
            )
        except Exception as e:
            logger.error(f"{get_request_id()}删除外部模型失败: {e}", exc_info=True)
            return DeleteExternalModelResponseType(
                success=False, message=f"删除失败: {str(e)}"
            )

    @strawberry.mutation(description="将指定外部模型设为当前用户的活跃模型（写入 user_model_settings）")
    async def set_active_model(
        self, info: strawberry.Info, model_id: int
    ) -> SetActiveModelResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return SetActiveModelResponseType(
                    success=False, message="未登录或登录已过期"
                )

            model = await get_external_model_by_id(model_id)
            if model is None:
                return SetActiveModelResponseType(
                    success=False, message="模型不存在"
                )

            settings = await upsert_user_model_settings(
                user_id=user.id,
                provider=model.provider,
                base_url=model.base_url,
                api_key=model.api_key,
                model_name=model.name,
            )
            if settings is None:
                return SetActiveModelResponseType(
                    success=False, message="设置活跃模型失败"
                )

            logger.info(
                f"{get_request_id()}活跃模型已切换: user_id={user.id}, "
                f"model={model.name}, id={model.id}"
            )
            return SetActiveModelResponseType(
                success=True,
                message=f"活跃模型已切换为 {model.name}",
            )
        except Exception as e:
            logger.error(f"{get_request_id()}设置活跃模型失败: {e}", exc_info=True)
            return SetActiveModelResponseType(
                success=False, message=f"设置失败: {str(e)}"
            )
    async def logout(self) -> AuthResponseType:
        try:
            return AuthResponseType(
                success=True,
                message="登出成功",
                token=None,
                user=None,
            )

        except Exception as e:
            logger.error(f"{get_request_id()}登出失败: {e}", exc_info=True)
            return AuthResponseType(success=False, message=f"登出失败: {str(e)}")

    @strawberry.mutation(description="更新当前用户资料（显示名称；头像走 /upload-avatar 端点）")
    async def update_profile(
        self, info: strawberry.Info, input: UpdateProfileInput
    ) -> UpdateProfileResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UpdateProfileResponseType(
                    success=False, message="未登录或登录已过期", user=None
                )

            updated = await update_user_profile(
                user_id=user.id, display_name=input.display_name
            )
            if updated is None:
                return UpdateProfileResponseType(
                    success=False, message="用户不存在或更新失败", user=None
                )

            return UpdateProfileResponseType(
                success=True,
                message="资料已更新",
                user=build_user_info(updated),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}更新资料失败: {e}", exc_info=True)
            return UpdateProfileResponseType(
                success=False, message=f"更新资料失败: {str(e)}", user=None
            )

    @strawberry.mutation(description="选中一个 Markdown 提示词作为当前提示词")
    async def select_markdown_prompt(
        self, info: strawberry.Info, prompt_id: int
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            prompt = await select_markdown_prompt(user.id, prompt_id)
            if prompt is None:
                return MarkdownPromptResponseType(
                    success=False, message="提示词不存在或无权操作", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True, message="已设为当前提示词", prompt=_prompt_type(prompt)
            )
        except Exception as e:
            logger.error(f"{get_request_id()}选中提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"选中提示词失败: {str(e)}", prompt=None
            )

    @strawberry.mutation(description="删除一个 Markdown 提示词")
    async def delete_markdown_prompt(
        self, info: strawberry.Info, prompt_id: int
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            deleted = await delete_markdown_prompt(user.id, prompt_id)
            if not deleted:
                return MarkdownPromptResponseType(
                    success=False, message="提示词不存在或无权操作", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True, message="提示词已删除", prompt=None
            )
        except Exception as e:
            logger.error(f"{get_request_id()}删除提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"删除提示词失败: {str(e)}", prompt=None
            )

    @strawberry.mutation(description="更新提示词的备注名称")
    async def rename_markdown_prompt(
        self, info: strawberry.Info, prompt_id: int, note_name: Optional[str]
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            renamed = await rename_markdown_prompt(user.id, prompt_id, note_name)
            if renamed is None:
                return MarkdownPromptResponseType(
                    success=False, message="提示词不存在或无权操作", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True,
                message="备注名称已更新",
                prompt=_prompt_type(renamed),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}重命名提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"重命名提示词失败: {str(e)}", prompt=None
            )

    @strawberry.mutation(description="更新提示词的 Markdown 正文内容")
    async def update_markdown_content(
        self, info: strawberry.Info, prompt_id: int, content: str
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            updated = await update_markdown_content(user.id, prompt_id, content)
            if updated is None:
                return MarkdownPromptResponseType(
                    success=False,
                    message="提示词不存在、无权操作或内容为空",
                    prompt=None,
                )
            return MarkdownPromptResponseType(
                success=True,
                message="内容已更新",
                prompt=_prompt_type(updated),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}更新提示词内容失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"更新提示词内容失败: {str(e)}", prompt=None
            )


@strawberry.type
class Subscription:
    @strawberry.subscription(description="流式聊天请求")
    async def stream_chat(
        self,
        info: strawberry.Info,
        query: str,
        model_type: str = "external",
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        conversation_id: Optional[str] = None,
        context: Optional[List[str]] = None,
        db_name: Optional[str] = None,
    ) -> AsyncGenerator[StreamChunkType, None]:
        try:
            logger.info(
                f"{get_request_id()}收到流式聊天请求: query='{query[:50]}.../', model_type={model_type}, "
                f"agent_type={agent_type}"
            )

            frontend_context = None
            if context:
                try:
                    frontend_context = [
                        json.loads(ctx) if isinstance(ctx, str) else ctx
                        for ctx in context
                    ]
                except json.JSONDecodeError:
                    frontend_context = None

            db_history = None
            if conversation_id:
                db_history = await get_conversation_history(conversation_id)

            merged_context = merge_context(
                db_history=db_history,
                frontend_context=frontend_context,
            )

            if merged_context:
                logger.info(
                    f"{get_request_id()}上下文已加载: {len(merged_context)} 条消息, "
                    f"约 {len(merged_context) // 2} 轮对话"
                )

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 模型解析优先级：前端选中的 model_name → external_models 表查
            # base_url/api_key → 据此建连。无需 user_model_settings 中转，
            # 用户在消息输入框选哪个模型就用哪个。
            request = _get_info_request(info)
            ext_model = await get_external_model_by_name(model_name or "")
            if ext_model is not None:
                override_api_key = ext_model.api_key
                override_base_url = ext_model.base_url
                logger.info(
                    f"{get_request_id()}使用 external_models 配置: "
                    f"model={model_name}, base_url={override_base_url}"
                )
                orchestrator = LangGraphSupervisor(
                    model_type=model_type,
                    model_name=model_name,
                    api_key=override_api_key,
                    base_url=override_base_url,
                )
            else:
                # 回退：未在前端选择模型或名称不在 external_models 表中，
                # 使用全局 provider 配置（external_provider 表 / 环境变量）
                override_api_key = None
                override_base_url = None
                orchestrator = get_orchestrator()

            # 自动注入用户当前选中的 Markdown 提示词（每轮对话均携带）
            active_prompt_content: Optional[str] = None
            user = await _get_bearer_user(request)
            if user is not None:
                active_prompt = await get_active_markdown_prompt(user.id)
                if active_prompt is not None:
                    active_prompt_content = active_prompt.content
                    logger.info(
                        f"{get_request_id()}已注入提示词: filename={active_prompt.filename}, "
                        f"chars={len(active_prompt.content)}"
                    )

            full_response = []
            thinking_buffer = []
            model_used = ""
            intent = ""
            captured_usage: Optional[dict] = None

            async for chunk in orchestrator.stream_process(
                query=query,
                model_type=model_type,
                model_name=model_name,
                agent_type=agent_type,
                conversation_id=conversation_id,
                context=merged_context,
                db_name=db_name,
                api_key=override_api_key,
                base_url=override_base_url,
                prompt_content=active_prompt_content,
            ):
                chunk_type = StreamChunkType(
                    type=chunk.get("type", ""),
                    content=chunk.get("content"),
                    model_used=chunk.get("model_used"),
                    conversation_id=chunk.get("conversation_id"),
                    sql=chunk.get("sql"),
                )

                if chunk_type.type == "intent":
                    intent = chunk_type.content or ""
                elif chunk_type.type == "thinking":
                    thinking_buffer.append(chunk_type.content or "")
                elif chunk_type.type == "content":
                    full_response.append(chunk_type.content or "")
                    model_used = chunk_type.model_used or ""

                # 捕获 LLM 末块返回的 token 用量（best-effort，可能为 None）
                if chunk.get("usage"):
                    captured_usage = chunk["usage"]

                yield chunk_type

            try:
                await save_conversation_log(
                    conversation_id=conversation_id or "",
                    user_query=query,
                    model_response="".join(full_response),
                    thinking_process="".join(thinking_buffer),
                    model_type=model_type,
                    model_name=model_used,
                    intent=intent or "",
                )
            except Exception as e:
                logger.error(f"{get_request_id()}保存对话日志失败: {e}", exc_info=True)

            # 落库用量统计（token 消耗 + 估算花费），best-effort，不影响主链路
            try:
                await save_usage_log(
                    user_id=user.id if user is not None else None,
                    conversation_id=conversation_id or "",
                    model_type=model_type,
                    model_name=model_used or model_name or "",
                    intent=intent or "",
                    usage=captured_usage,
                )
            except Exception as e:
                logger.error(f"{get_request_id()}保存用量日志失败: {e}", exc_info=True)

        except Exception as e:
            logger.error(f"{get_request_id()}流式聊天接口错误: {e}", exc_info=True)
            yield StreamChunkType(
                type="error",
                content=f"处理请求失败: {str(e)}",
            )


schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    subscription=Subscription,
)


async def _generate_cancel_response():
    data = json.dumps(
        {
            "type": "sql_cancelled",
            "content": "用户取消了本次查询",
        }
    )
    yield f"data: {data}\n\n"


# ---------------------------------------------------------------------------
# Markdown 文件上传
# ---------------------------------------------------------------------------

_MARKDOWN_EXTENSIONS: tuple[str, ...] = (".md", ".markdown", ".mdown", ".mkd")
_MARKDOWN_CONTENT_TYPES: tuple[str, ...] = (
    "text/markdown",
    "text/x-markdown",
    # 许多系统对 .md 默认返回 text/plain，予以放行后由内容嗅探兜底校验
    "text/plain",
    "application/octet-stream",
)
_MARKDOWN_MAX_BYTES: int = 2 * 1024 * 1024  # 2MB
_MARKDOWN_SNIFF_HINTS: tuple[str, ...] = (
    "#", "##", "###", "- ", "* ", "> ", "```", "---", "| ", "[", "](", "1. ",
)


def _validate_markdown_file(
    filename: Optional[str],
    content_type: Optional[str],
    raw: bytes,
) -> tuple[bool, str, str]:
    """服务端 Markdown 校验：扩展名 → Content-Type → 大小 → UTF-8 解码 → 内容嗅探。

    返回 (是否通过, 文本内容, 错误信息)。文本内容仅在通过时有效。
    """
    if not filename:
        return False, "", "未提供文件名"

    name_lower = filename.lower()
    if not name_lower.endswith(_MARKDOWN_EXTENSIONS):
        return (
            False,
            "",
            f"仅支持 Markdown 文件（扩展名 .md / .markdown），当前文件：{filename}",
        )

    if content_type and content_type.lower() not in _MARKDOWN_CONTENT_TYPES:
        return False, "", f"文件 Content-Type 非 Markdown 文本：{content_type}"

    if not raw:
        return False, "", "文件内容为空"

    if len(raw) > _MARKDOWN_MAX_BYTES:
        return (
            False,
            "",
            f"文件过大（>{_MARKDOWN_MAX_BYTES // 1024 // 1024}MB），请精简后再上传",
        )

    # 优先 UTF-8，兼容 BOM
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return False, "", "文件非 UTF-8 文本，无法作为 Markdown 解析"

    # 内容嗅探：前 2KB 内须出现 Markdown 结构性标志，避免上传任意文本冒充
    head = text[:2048]
    if not any(hint in head for hint in _MARKDOWN_SNIFF_HINTS):
        return (
            False,
            "",
            "文件内容未检测到 Markdown 结构（标题 / 列表 / 代码块 / 引用 / 链接等）",
        )

    return True, text, ""


def _prompt_type(prompt: UserMarkdownPrompt) -> MarkdownPromptType:
    """ORM → GraphQL 类型转换。"""
    return MarkdownPromptType(
        id=prompt.id,
        filename=prompt.filename,
        note_name=prompt.note_name,
        content=prompt.content,
        is_active=prompt.is_active,
        char_count=len(prompt.content) if prompt.content else 0,
        created_at=prompt.created_at.isoformat() if prompt.created_at else None,
        updated_at=prompt.updated_at.isoformat() if prompt.updated_at else None,
    )


@post("/upload-markdown", media_type=MediaType.JSON)
async def upload_markdown_endpoint(request: Request) -> Response:
    """接收前端上传的 Markdown 文件，校验通过后按用户持久化到提示词库。

    需携带 Authorization: Bearer <token>。同名文件覆盖内容并保持原选中状态；
    用户首条提示词自动设为活跃。
    """
    import json as _json

    # 鉴权：未登录拒绝上传
    user = await _get_bearer_user(request)
    if user is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未登录或登录已过期，无法上传"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=401,
            media_type="application/json",
        )

    try:
        form = await request.form()
    except Exception as e:
        logger.warning(f"{get_request_id()}Markdown 上传表单解析失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"表单解析失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    upload_file = form.get("file") if form else None
    if upload_file is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未接收到文件，请选择一个 Markdown 文件"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    filename = getattr(upload_file, "filename", None)
    content_type = getattr(upload_file, "content_type", None)
    try:
        raw = await upload_file.read()
    except Exception as e:
        logger.warning(f"{get_request_id()}Markdown 上传读取失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"文件读取失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    ok, text, err = _validate_markdown_file(filename, content_type, raw)
    if not ok:
        logger.warning(f"{get_request_id()}Markdown 上传校验失败: {err}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": err},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    # 按用户持久化
    saved = await create_user_markdown_prompt(
        user_id=user.id, filename=filename, content=text
    )
    if saved is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "保存到数据库失败，请重试"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=500,
            media_type="application/json",
        )

    logger.info(
        f"{get_request_id()}Markdown 上传成功: user_id={user.id}, filename={filename}, "
        f"size={len(raw)}B, chars={len(text)}, is_active={saved.is_active}"
    )
    return Response(
        content=_json.dumps(
            {
                "success": True,
                "prompt": saved.to_dict(),
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        status_code=200,
        media_type="application/json",
    )


# ============================================
# 头像上传 / 头像读取
# ============================================

_AVATAR_ALLOWED_TYPES: tuple[str, ...] = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
)
_AVATAR_MAX_BYTES: int = 8 * 1024 * 1024  # 8MB
# imghdr 返回的图片类型标识 → Content-Type
_AVATAR_CONTENT_TYPES: dict[str, str] = {
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


@post("/upload-avatar", media_type=MediaType.JSON)
async def upload_avatar_endpoint(request: Request) -> Response:
    """接收前端上传的头像图片，校验通过后写入 users.avatar 字段。

    需携带 Authorization: Bearer <token>。仅支持 JPEG/PNG/WebP/GIF，≤2MB。
    成功后返回新的 avatar_url（带版本号防缓存）。
    """
    import json as _json

    user = await _get_bearer_user(request)
    if user is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未登录或登录已过期，无法上传"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=401,
            media_type="application/json",
        )

    try:
        form = await request.form()
    except Exception as e:
        logger.warning(f"{get_request_id()}头像上传表单解析失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"表单解析失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    upload_file = form.get("file") if form else None
    if upload_file is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未接收到文件"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    content_type = getattr(upload_file, "content_type", None)
    try:
        raw = await upload_file.read()
    except Exception as e:
        logger.warning(f"{get_request_id()}头像上传读取失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"文件读取失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    if not raw:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "文件内容为空"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )
    if len(raw) > _AVATAR_MAX_BYTES:
        return Response(
            content=_json.dumps(
                {
                    "success": False,
                    "error": "头像过大（>8MB），请压缩后重试",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    # 双重校验：MIME 头 + 内容嗅探（imghdr 根据文件头识别真实格式）
    if content_type and content_type.lower() not in _AVATAR_ALLOWED_TYPES:
        return Response(
            content=_json.dumps(
                {
                    "success": False,
                    "error": f"仅支持 JPEG/PNG/WebP/GIF，当前类型：{content_type}",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )
    sniffed = imghdr.what(None, h=raw)
    if sniffed not in _AVATAR_CONTENT_TYPES:
        return Response(
            content=_json.dumps(
                {
                    "success": False,
                    "error": "文件内容不是有效图片（嗅探失败），请检查文件是否损坏",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    updated = await set_user_avatar(user.id, raw)
    if updated is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "保存到数据库失败，请重试"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=500,
            media_type="application/json",
        )

    info = build_user_info(updated)
    logger.info(
        f"{get_request_id()}头像上传成功: user_id={user.id}, size={len(raw)}B, "
        f"type={sniffed}"
    )
    return Response(
        content=_json.dumps(
            {
                "success": True,
                "avatarUrl": info.avatar_url,
                "user": {
                    "id": info.id,
                    "email": info.email,
                    "phone": info.phone,
                    "displayName": info.display_name,
                    "avatarUrl": info.avatar_url,
                    "createdAt": info.created_at,
                },
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        status_code=200,
        media_type="application/json",
    )


@get("/avatar/{user_id:int}", media_type=MediaType.JSON)
async def serve_avatar_endpoint(user_id: int) -> Response:
    """按 user_id 输出头像二进制。无头像时返回 404，由前端回退到字母占位。

    响应体为图片字节；Content-Type 由嗅探的真实格式决定。
    """
    avatar = await get_user_avatar(user_id)
    if not avatar:
        return Response(
            content=b"",
            status_code=404,
            media_type="application/json",
        )
    sniffed = imghdr.what(None, h=avatar)
    media_type = _AVATAR_CONTENT_TYPES.get(sniffed or "", "image/jpeg")
    return Response(
        content=avatar,
        status_code=200,
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache, must-revalidate",
        },
    )


def register_routers(route_prefix: str) -> Router:
    from strawberry.litestar import make_graphql_controller

    GraphQLController = make_graphql_controller(
        schema,
        path="/graphql",
    )

    @post("/graphql/stream", media_type=MediaType.TEXT)
    async def graphql_stream_subscription(request: Request) -> Stream:
        import json as _json

        body = await request.json()
        query = body.get("query", "")
        variables = body.get("variables", {})
        operation_name = body.get("operationName")

        # 在请求上下文中捕获 request_id，确保 generate() 内可用
        req_id = request_id_var.get("")

        logger.info(
            f"{get_request_id()}收到 GraphQL 流式订阅请求: query='{query[:100]}...'"
        )

        async def generate():
            # 异步生成器在新的协程上下文中执行，需要重新设置 request_id
            if req_id:
                request_id_var.set(req_id)
            try:
                subscription_result = await schema.subscribe(
                    query,
                    variable_values=variables,
                    operation_name=operation_name,
                    # 默认 context 为 dict（与 HTTP controller 一致），
                    # 供 resolver 读取 Authorization 做用户设置解析
                    context_value={"request": request},
                )

                if subscription_result is None:
                    error_response = {"errors": [{"message": "订阅返回空结果"}]}
                    yield f"data: {_json.dumps(error_response, ensure_ascii=False)}\n\n"
                    return

                errors = getattr(subscription_result, "errors", None)
                if errors:
                    error_response = {"errors": [{"message": str(e)} for e in errors]}
                    yield f"data: {_json.dumps(error_response, ensure_ascii=False)}\n\n"
                    return

                async for result in subscription_result:
                    response_data = {}

                    data = getattr(result, "data", None)
                    if data:
                        response_data["data"] = data

                    result_errors = getattr(result, "errors", None)
                    if result_errors:
                        response_data["errors"] = [
                            {"message": str(e)} for e in result_errors
                        ]

                    if response_data:
                        yield f"data: {_json.dumps(response_data, ensure_ascii=False)}\n\n"

                yield f"data: {_json.dumps({'complete': True}, ensure_ascii=False)}\n\n"

            except Exception as e:
                logger.error(
                    f"{get_request_id()}GraphQL 订阅执行错误: {e}", exc_info=True
                )
                error_response = {"errors": [{"message": str(e)}]}
                yield f"data: {_json.dumps(error_response, ensure_ascii=False)}\n\n"

        return Stream(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @post("/sql-approval", media_type=MediaType.TEXT)
    async def sql_approval_endpoint(request: Request) -> Response | Stream:
        import json as _json

        body = await request.json()
        conversation_id = body.get("conversation_id", "")
        sql = body.get("sql", "")
        action = body.get("action", "")
        question = body.get("question", "")
        model_type = body.get("model_type", "external")
        model_name = body.get("model_name")
        db_name = body.get("db_name")

        if action not in ["approve", "reject", "cancel"]:
            return Response(
                content=_json.dumps(
                    {"error": "Invalid action"}, ensure_ascii=False
                ).encode("utf-8"),
                status_code=400,
                media_type="application/json",
            )

        if action == "cancel":
            return Stream(
                _generate_cancel_response(),
                media_type="text/event-stream",
            )

        # 在请求上下文中捕获 request_id，确保 generate() 内可用
        req_id = request_id_var.get("")

        # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
        await load_llm_provider_config()

        # 用户已保存自定义模型设置时，以其覆盖默认链路配置
        user_settings = await _get_bearer_settings(request)
        if user_settings is not None:
            model_name = user_settings.model_name

        async def generate():
            if req_id:
                request_id_var.set(req_id)
            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=user_settings.api_key if user_settings else None,
                base_url=user_settings.base_url if user_settings else None,
                db_name=db_name,
            )

            if action == "approve":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=True, question=question
                ):
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"
            elif action == "reject":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=False, question=question
                ):
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                        }
                    )
                    yield f"data: {chunk_data}\n\n"

                async for chunk in sql_agent.stream_query(question=question):
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"

        return Stream(generate(), media_type="text/event-stream")

    router = Router(
        path=route_prefix,
        route_handlers=[
            GraphQLController,
            graphql_stream_subscription,
            sql_approval_endpoint,
            upload_markdown_endpoint,
            upload_avatar_endpoint,
            serve_avatar_endpoint,
        ],
    )

    return router
