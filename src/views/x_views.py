from typing import Dict, List, Optional

from sqlalchemy import desc
from utils.log_util import get_request_id, logger
from x_models.id-x-010..models.x_models import ConversationLog, get_session

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
