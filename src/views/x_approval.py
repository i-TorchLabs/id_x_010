"""SQL 审批任务视图层（TASK-012）。

提供 ApprovalTask 的 CRUD + 超时扫描 + WS 发布接口，供 controllers 调用。
**WS 发布基于进程内 asyncio.Queue**，多副本部署时审批通知仅推送给本副本
（如需跨副本请后续引入 Redis pub/sub——已明确不在本期范围）。
"""

import asyncio
import json
import uuid as _uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import select, update
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import ApprovalTask, get_session

# 默认审批超时时间（30 分钟）；超时后 cleanup_expired_tasks 改为 timeout
DEFAULT_TIMEOUT_MINUTES = 30

# 进程内 WS 订阅：每个 channelId 一组 asyncio.Queue
# channelId 取值："__admin__"（所有管理员）/ f"user:{user_id}"（指定用户）
# 以及 task_id 维度：单 task 完成时 publish 到该 task_id channel
_subscribers: Dict[str, Set[asyncio.Queue]] = defaultdict(set)


async def publish(channel_id: str, message: Dict[str, Any]) -> None:
    """向指定 channel 的所有订阅者推送消息（best-effort,失败静默）。"""
    queues = list(_subscribers.get(channel_id, set()))
    for q in queues:
        try:
            await q.put(message)
        except Exception as e:
            logger.warning(
                f"{get_request_id()}approval publish 失败 channel={channel_id}: "
                f"{type(e).__name__}: {e}"
            )


async def publish_task_event(
    task_id: str,
    *,
    event: str,
    payload: Optional[Dict[str, Any]] = None,
    admin_only: bool = False,
) -> None:
    """推送一条审批事件到 admin 与（可选）所有用户频道。

    Args:
        task_id: 任务 ID；订阅者按 task_id 订阅时能收到。
        event: 事件名：created / approved / rejected / cancelled / timeout
        payload: 额外字段，如 sql_meaning/question/user_id
        admin_only: True 时只推送 admin 频道
    """
    message = {
        "type": "approval_event",
        "task_id": task_id,
        "event": event,
        "payload": payload or {},
        "ts": datetime.now(timezone.utc).isoformat(),
    }
    await publish(f"task:{task_id}", message)
    await publish("__admin__", message)
    if not admin_only and payload and payload.get("user_id"):
        await publish(f"user:{payload['user_id']}", message)


async def create_approval_task(
    *,
    conversation_id: str,
    sql: str,
    question: str,
    user_id: Optional[int] = None,
    sql_meaning: Optional[str] = None,
    timeout_minutes: int = DEFAULT_TIMEOUT_MINUTES,
) -> ApprovalTask:
    """创建审批任务并落库 + 推送 created 事件。"""
    task_id = str(_uuid.uuid4())
    timeout_at = datetime.now(timezone.utc) + timedelta(minutes=timeout_minutes)
    async with get_session()() as session:
        task = ApprovalTask(
            id=task_id,
            conversation_id=conversation_id,
            sql=sql,
            sql_meaning=sql_meaning,
            question=question,
            user_id=user_id,
            status="pending",
            timeout_at=timeout_at,
        )
        session.add(task)
        await session.commit()
        await session.refresh(task)

    await publish_task_event(
        task_id,
        event="created",
        payload={
            "conversation_id": conversation_id,
            "sql": sql,
            "sql_meaning": sql_meaning,
            "question": question,
            "user_id": user_id,
            "timeout_at": timeout_at.isoformat(),
        },
    )
    logger.info(
        f"{get_request_id()}approval_task 创建: id={task_id}, "
        f"conversation_id={conversation_id}, user_id={user_id}"
    )
    return task


async def list_pending_tasks() -> List[Dict[str, Any]]:
    """列出所有未超时的 pending 任务。"""
    now = datetime.now(timezone.utc)
    try:
        async with get_session()() as session:
            rows = (
                await session.execute(
                    select(ApprovalTask)
                    .where(
                        ApprovalTask.status == "pending",
                        ApprovalTask.timeout_at > now,
                    )
                    .order_by(ApprovalTask.created_at.desc())
                )
            ).scalars().all()
        return [_task_to_dict(r) for r in rows]
    except Exception as e:
        logger.warning(
            f"{get_request_id()}list_pending_tasks 失败: {type(e).__name__}: {e}"
        )
        return []


async def resolve_task(
    task_id: str,
    *,
    action: str,
    assigned_to: Optional[int] = None,
) -> Optional[ApprovalTask]:
    """更新任务状态并推送 resolved 事件。

    Args:
        task_id: 任务 ID
        action: "approve" / "reject" / "cancel"
        assigned_to: 审批管理员 ID

    Returns:
        更新后的 ApprovalTask；任务不存在或已结束返回 None。
    """
    if action not in ("approve", "reject", "cancel"):
        return None
    status_map = {
        "approve": "approved",
        "reject": "rejected",
        "cancel": "cancelled",
    }
    new_status = status_map[action]
    now = datetime.now(timezone.utc)
    try:
        async with get_session()() as session:
            task = (
                await session.execute(
                    select(ApprovalTask).where(ApprovalTask.id == task_id)
                )
            ).scalar_one_or_none()
            if task is None:
                return None
            if task.status != "pending":
                # 已被其它管理员处理或超时——返回当前状态供调用方判断
                return task
            task.status = new_status
            task.assigned_to = assigned_to
            task.resolved_at = now
            await session.commit()
            await session.refresh(task)

        await publish_task_event(
            task_id,
            event=new_status,
            payload={
                "conversation_id": task.conversation_id,
                "question": task.question,
                "sql": task.sql,
                "user_id": task.user_id,
                "assigned_to": assigned_to,
            },
        )
        logger.info(
            f"{get_request_id()}approval_task resolved: id={task_id}, "
            f"status={new_status}, assigned_to={assigned_to}"
        )
        return task
    except Exception as e:
        logger.error(
            f"{get_request_id()}resolve_task 失败: {e}", exc_info=True
        )
        return None


async def cleanup_expired_tasks() -> int:
    """扫描超时任务并标 timeout。返回本轮清理数量。"""
    now = datetime.now(timezone.utc)
    try:
        async with get_session()() as session:
            result = await session.execute(
                update(ApprovalTask)
                .where(
                    ApprovalTask.status == "pending",
                    ApprovalTask.timeout_at <= now,
                )
                .values(status="timeout", resolved_at=now)
                .returning(ApprovalTask.id, ApprovalTask.conversation_id, ApprovalTask.user_id)
            )
            expired = result.all()
            if expired:
                await session.commit()
            for row in expired:
                await publish_task_event(
                    row[0],
                    event="timeout",
                    payload={
                        "conversation_id": row[1],
                        "user_id": row[2],
                    },
                    admin_only=False,
                )
            if expired:
                logger.info(
                    f"{get_request_id()}cleanup_expired_tasks: 清理 {len(expired)} 条超时任务"
                )
            return len(expired)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}cleanup_expired_tasks 失败: {type(e).__name__}: {e}"
        )
        return 0


def subscribe(channel_id: str) -> asyncio.Queue:
    """注册一个 asyncio.Queue 订阅 channel;WS 连接建立时调用。"""
    q: asyncio.Queue = asyncio.Queue()
    _subscribers[channel_id].add(q)
    return q


def unsubscribe(channel_id: str, q: asyncio.Queue) -> None:
    """WS 连接断开时调用,从订阅集合移除。"""
    _subscribers.get(channel_id, set()).discard(q)


def _task_to_dict(task: ApprovalTask) -> Dict[str, Any]:
    return {
        "id": task.id,
        "conversation_id": task.conversation_id,
        "sql": task.sql,
        "sql_meaning": task.sql_meaning,
        "question": task.question,
        "user_id": task.user_id,
        "status": task.status,
        "assigned_to": task.assigned_to,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "resolved_at": task.resolved_at.isoformat() if task.resolved_at else None,
        "timeout_at": task.timeout_at.isoformat() if task.timeout_at else None,
    }


async def dump_message(q: asyncio.Queue) -> str:
    """从 queue 拿一条消息并 JSON 序列化为字符串,WS 端 send_text。"""
    msg = await q.get()
    return json.dumps(msg, ensure_ascii=False, default=str)
