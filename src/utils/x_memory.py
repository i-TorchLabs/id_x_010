"""对话上下文记忆管理：滚动摘要 + 实体记忆 + 最近 N 条原文。

本模块服务于所有 Agent 的上下文构建，不引入 Agent 间联动：
- ``get_context`` 用作 stream_chat 的 merged_context 替代品；
- ``maybe_summarize`` 在对话流结束后 fire-and-forget 调用，不阻塞主响应。

设计：
- 摘要存于 ``conversation_summaries`` 表，每个 conversation_id 一行；
- 触发条件：当前 ConversationLog 数 - 上次摘要的 message_count > SUMMARY_TRIGGER；
- 失败 best-effort：任何异常仅 logger.warning，主流程不受影响。
"""

import json
from typing import Dict, List, Optional

from sqlalchemy import func, select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import (
    ConversationLog,
    ConversationSummary,
    get_external_model_config,
    get_session,
)

# 注入到 LLM 的最近原文条数（user/assistant 各算一条，约 3 轮）
RECENT_MSG_COUNT = 6
# 触发新一轮摘要的阈值：未摘要消息数 > 此值则触发
SUMMARY_TRIGGER = 8

_SYSTEM_PROMPT = (
    "你是对话摘要助手。请把以下对话压缩为不超过 300 字的中文摘要，并抽取关键"
    "实体为 JSON 对象（字段名为实体名，值为字符串）。只输出严格 JSON："
    '{"summary": "...", "entities": {...}}。'
)


async def get_context(conversation_id: str) -> List[Dict[str, str]]:
    """返回应注入 LLM 的 messages 列表。

    结构：
    1. 若有 ConversationSummary，注入两条 system：
       - 对话历史摘要
       - 已知实体（如有 entity_memory）
    2. 最近 RECENT_MSG_COUNT 条 ConversationLog（按 id 升序），role 还原为
       user/assistant，user_query 为 user，model_response 为 assistant。

    若 conversation_id 为空或无任何记录，返回空列表，调用方可能降级回
    merge_context 行为。
    """
    if not conversation_id:
        return []

    try:
        async with get_session()() as session:
            sum_row = (
                await session.execute(
                    select(ConversationSummary).where(
                        ConversationSummary.conversation_id == conversation_id
                    )
                )
            ).scalar_one_or_none()

            recent_logs = (
                await session.execute(
                    select(ConversationLog)
                    .where(ConversationLog.conversation_id == conversation_id)
                    .order_by(ConversationLog.id.desc())
                    .limit(RECENT_MSG_COUNT)
                )
            ).scalars().all()
    except Exception as e:
        logger.warning(
            f"{get_request_id()}get_context 失败,返回空上下文: "
            f"{type(e).__name__}: {e}"
        )
        return []

    # 最近消息按时间正序排列（id 升序）
    recent_logs.reverse()

    ctx: List[Dict[str, str]] = []
    if sum_row and sum_row.summary:
        ctx.append({"role": "system", "content": f"对话历史摘要:\n{sum_row.summary}"})
        if sum_row.entity_memory:
            ctx.append(
                {
                    "role": "system",
                    "content": f"已知实体: {json.dumps(sum_row.entity_memory, ensure_ascii=False)}",
                }
            )

    for log in recent_logs:
        if log.user_query:
            ctx.append({"role": "user", "content": log.user_query})
        if log.model_response:
            ctx.append({"role": "assistant", "content": log.model_response})

    return ctx


async def maybe_summarize(conversation_id: str) -> None:
    """检查并执行一次滚动摘要。

    触发条件：当前 ConversationLog 总数 - last_summary.message_count > SUMMARY_TRIGGER。
    失败 best-effort；任何异常仅 logger.warning 后退出，不抛错。

    本函数应 fire-and-forget 调用（asyncio.create_task），不应阻塞主响应。
    """
    if not conversation_id:
        return

    try:
        async with get_session()() as session:
            total_count = (
                await session.execute(
                    select(func.count(ConversationLog.id)).where(
                        ConversationLog.conversation_id == conversation_id
                    )
                )
            ).scalar_one()

            sum_row = (
                await session.execute(
                    select(ConversationSummary).where(
                        ConversationSummary.conversation_id == conversation_id
                    )
                )
            ).scalar_one_or_none()

            last_count = sum_row.message_count if sum_row else 0
            if total_count - last_count <= SUMMARY_TRIGGER:
                return  # 未达摘要阈值

            # 取上次摘要后新增的全部消息
            new_logs = (
                await session.execute(
                    select(ConversationLog)
                    .where(ConversationLog.conversation_id == conversation_id)
                    .order_by(ConversationLog.id.asc())
                    .offset(last_count)
                )
            ).scalars().all()

        if not new_logs:
            return

        # 构造对话文本：user_query / model_response 简化呈现
        dialogue_lines = []
        for log in new_logs:
            if log.user_query:
                dialogue_lines.append(f"用户: {log.user_query}")
            if log.model_response:
                dialogue_lines.append(f"助手: {log.model_response}")
        dialogue_text = "\n".join(dialogue_lines)[:6000]  # 截断避免 token 溢出

        # 调 LLM 生成摘要 + 实体抽取
        summary, entities = await _generate_summary(dialogue_text, sum_row)

        async with get_session()() as session:
            if sum_row is None:
                sum_row = ConversationSummary(conversation_id=conversation_id)
                session.add(sum_row)
            else:
                # 重新 attach 到当前 session
                sum_row = await session.merge(sum_row)
            sum_row.summary = summary
            sum_row.entity_memory = entities or None
            sum_row.message_count = total_count
            await session.commit()

        logger.info(
            f"{get_request_id()}maybe_summarize 完成 conversation_id={conversation_id} "
            f"summarized={total_count - last_count} message_count={total_count}"
        )
    except Exception as e:
        logger.warning(
            f"{get_request_id()}maybe_summarize 失败（best-effort,不影响主流程）: "
            f"{type(e).__name__}: {e}"
        )


async def _generate_summary(
    dialogue_text: str, prev_summary: Optional[ConversationSummary]
) -> tuple[str, Optional[dict]]:
    """调 LLM 生成新一轮摘要 + 实体。

    Args:
        dialogue_text: 自上次摘要后的新对话拼接文本。
        prev_summary: 上一版摘要行（None 表示首次）。

    Returns:
        (summary, entities) — entities 为 dict 或 None。
    """
    try:
        from langchain_core.messages import HumanMessage, SystemMessage
        from langchain_openai import ChatOpenAI
        from pydantic import SecretStr

        cfg = get_external_model_config()
        api_key = cfg.get("api_key")
        base_url = cfg.get("base_url")
        model_name = (
            cfg.get("model_name")
            or "gpt-4o-mini"  # 摘要任务用小模型，省钱
        )

        if not api_key or not base_url:
            logger.warning(
                f"{get_request_id()}_generate_summary 跳过: 缺 api_key/base_url"
            )
            return (prev_summary.summary if prev_summary else "(摘要生成失败)", None)

        llm = ChatOpenAI(
            model=model_name,
            api_key=SecretStr(api_key),
            base_url=base_url,
            temperature=0.3,
        )
        prev_hint = (
            f"上一版摘要:\n{prev_summary.summary}\n\n" if prev_summary and prev_summary.summary else ""
        )
        msg = HumanMessage(
            content=f"{prev_hint}本次新对话:\n{dialogue_text}\n\n请按 system 指令输出 JSON。"
        )
        resp = await llm.ainvoke([SystemMessage(content=_SYSTEM_PROMPT), msg])
        raw = resp.content if isinstance(resp.content, str) else str(resp.content)

        # 兼容 ```json ... ``` 包裹
        if "```json" in raw:
            raw = raw.split("```json")[1].split("```")[0].strip()
        elif "```" in raw:
            raw = raw.split("```")[1].split("```")[0].strip()

        data = json.loads(raw)
        summary = (data.get("summary") or "").strip() or "(摘要为空)"
        entities = data.get("entities")
        if not isinstance(entities, dict):
            entities = None
        return (summary, entities)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}_generate_summary LLM 调用失败: "
            f"{type(e).__name__}: {e}"
        )
        return (prev_summary.summary if prev_summary else "(摘要生成失败)", None)
