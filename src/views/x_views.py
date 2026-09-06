import asyncio
from typing import Dict, List, Optional, Tuple

from sqlalchemy import desc, select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import (
    ConversationLog,
    UserModelSettings,
    get_session,
)

DEFAULT_MAX_ROUNDS = 5


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
# 用户模型设置（/home 设置弹窗）
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
) -> Optional[UserModelSettings]:
    """新建或更新用户的模型设置（每用户一行）。"""
    async with get_session()() as session:
        result = await session.execute(
            select(UserModelSettings).where(UserModelSettings.user_id == user_id)
        )
        settings = result.scalar_one_or_none()

        if settings is None:
            settings = UserModelSettings(
                user_id=user_id,
                provider=provider,
                base_url=base_url,
                api_key=api_key,
                model_name=model_name,
            )
            session.add(settings)
        else:
            settings.provider = provider
            settings.base_url = base_url
            settings.api_key = api_key
            settings.model_name = model_name

        await session.commit()
        await session.refresh(settings)
        logger.info(
            f"{get_request_id()}用户模型设置已保存: user_id={user_id}, "
            f"provider={provider}, model={model_name}"
        )
        return settings


async def test_model_connectivity(
    base_url: str,
    api_key: str,
    model_name: str,
    timeout: int = 20,
) -> Tuple[bool, str]:
    """以最小开销调用一次模型，验证 (base_url, api_key, model_name) 可用性。

    面向 OpenAI 兼容接口（ChatOpenAI 约定），返回 (是否成功, 人类可读消息)。
    """
    from langchain_core.messages import HumanMessage
    from langchain_openai import ChatOpenAI
    from pydantic import SecretStr

    llm = ChatOpenAI(
        model=model_name,
        api_key=SecretStr(api_key),
        base_url=base_url,
        temperature=0,
        max_retries=1,
        timeout=15,
        streaming=False,
    )

    try:
        await asyncio.wait_for(
            llm.ainvoke([HumanMessage(content="ping")]), timeout=timeout
        )
        logger.info(
            f"{get_request_id()}模型连通性检测通过: model={model_name}, base_url={base_url}"
        )
        return True, "连通性检测通过，模型响应正常"
    except asyncio.TimeoutError:
        logger.warning(
            f"{get_request_id()}模型连通性检测超时: model={model_name}, base_url={base_url}"
        )
        return False, f"连接超时（>{timeout} 秒无响应），请检查访问地址是否可达"
    except Exception as e:
        detail = str(e).replace("\n", " ")[:200]
        logger.warning(
            f"{get_request_id()}模型连通性检测失败: model={model_name}, "
            f"base_url={base_url} | 原因: {type(e).__name__}: {detail}"
        )
        return False, f"连接失败: {type(e).__name__}: {detail}"


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
