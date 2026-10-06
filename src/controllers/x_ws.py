"""WebSocket 审批通道（TASK-012）。

**已知限制**：基于进程内 ``asyncio.Queue`` 的 pub/sub——多副本部署时审批通知
仅推送给本副本订阅者。如需跨副本实时通知，请后续引入 Redis pub/sub（已明确
不在本期范围）。前端应同时拉 ``listApprovalTasks`` 查询兜底，避免错过事件。

鉴权：从 query string ``token`` 解析 UserToken（与 REST 路径的 Bearer 头一致）。
is_admin 检查依赖 TASK-013 的 User.is_admin 字段；该字段缺失时所有登录用户
均订阅 ``__admin__`` 频道（向后兼容）。
"""

import asyncio
import json
from typing import Optional

from litestar import WebSocket
from sqlalchemy import select
from utils.log_util import get_request_id, logger, request_id_var
from x_models.id_x_010.src.models.x_models import UserToken, User, get_session
from x_models.id_x_010.src.views.x_approval import (
    subscribe,
    unsubscribe,
    dump_message,
)


async def _verify_user_from_ws(socket: WebSocket) -> Optional[User]:
    """解析登录用户，支持三种 token 传递方式（优先级递减）：

    1. **Sec-WebSocket-Protocol 子协议**（推荐）：客户端 ``new WebSocket(url, ['bearer.<token>'])``
       传 token，服务端在headers['sec-websocket-protocol']中拿到。**生产推荐**——
       token 不会出现在 URL/日志/nginx access log，避免泄漏。
    2. **Cookie**：若 token 写入 cookie 则从 socket.headers['cookie'] 取。
    3. **query string ``?token=``**：兼容现有实现，但**已知风险**——
       token 出现在 URL/proxy access log，仅作向后兼容保留。

    失败返回 None。
    """
    token: Optional[str] = None

    # 1. 子协议优先：客户端 WebSocket(url, ['bearer.<token>']) 触发
    subprotocols = socket.headers.get("sec-websocket-protocol") if socket.headers else None
    if subprotocols:
        # 形如 "bearer.<token>, bearer.alt" —— 取第一个 bearer. 前缀的项
        for proto in subprotocols.split(","):
            proto = proto.strip()
            if proto.startswith("bearer."):
                token = proto[len("bearer."):]
                break

    # 2. Cookie：浏览器场景下若主程序设置 token cookie
    if not token and socket.headers:
        cookie_header = socket.headers.get("cookie", "")
        if cookie_header:
            for kv in cookie_header.split(";"):
                kv = kv.strip()
                if kv.startswith("token="):
                    token = kv[len("token="):]
                    break

    # 3. query string 兜底（兼容）
    if not token:
        token = socket.query_params.get("token") if socket.query_params else None

    if not token:
        return None
    try:
        async with get_session()() as session:
            user_token = (
                await session.execute(
                    select(UserToken).where(UserToken.token == token)
                )
            ).scalar_one_or_none()
            if user_token is None or not user_token.is_valid():
                return None
            user = (
                await session.execute(
                    select(User).where(User.id == user_token.user_id)
                )
            ).scalar_one_or_none()
            return user
    except Exception as e:
        logger.warning(
            f"{get_request_id()}WS 鉴权失败: {type(e).__name__}: {e}"
        )
        return None


def _select_subprotocol(socket: WebSocket) -> Optional[str]:
    """握手响应时回选客户端发来的 bearer.<token> 子协议。

    WebSocket 规范要求服务端在 accept 时回选一个客户端提供的子协议；
    否则浏览器会报"协议不匹配"。token 已在 _verify_user_from_ws 中消费，
    回选相同子协议仅为握手合规。
    """
    subprotocols = socket.headers.get("sec-websocket-protocol") if socket.headers else None
    if not subprotocols:
        return None
    for proto in subprotocols.split(","):
        proto = proto.strip()
        if proto.startswith("bearer."):
            return proto
    return None


def _user_channels(user: User) -> list[str]:
    """根据是否 admin 返回该用户应订阅的频道列表。"""
    channels = [f"user:{user.id}"]
    # is_admin 字段在 TASK-013 加上；向后兼容： getattr 取不到则视为非 admin
    if getattr(user, "is_admin", False):
        channels.append("__admin__")
    return channels


async def approval_ws(socket: WebSocket) -> None:
    """审批 WS 入口 /ws/approval。

    协议：
    - 鉴权失败立即 close code=4001；
    - 鉴权通过后 accept，订阅 user:{id} + （如有）__admin__；
    - 服务端 put 到 queue 时 send_text(JSON)；
    - 客户端断开时 finally 移除订阅。
    """
    # 设置请求上下文 request_id（与 REST / SSE 一致，便于日志追踪）
    request_id_var.set(f"ws-{id(socket)}")

    user = await _verify_user_from_ws(socket)
    if user is None:
        try:
            await socket.close(code=4001)
        except Exception:
            pass
        logger.warning(f"{get_request_id()}WS /ws/approval 鉴权失败,已关闭")
        return

    try:
        # 子协议回选：客户端用 new WebSocket(url, ['bearer.<token>']) 时
        # 必须回选该子协议，否则握手失败。token 仅作为握手协议字段，
        # 已在 _verify_user_from_ws 中消费，回选仅为浏览器规范合规。
        subproto = _select_subprotocol(socket)
        try:
            await socket.accept(subprotocols=[subproto] if subproto else None)
        except TypeError:
            # 旧版 litestar 参数名差异：subprotocols → subprotocol
            await socket.accept()
    except Exception as e:
        logger.warning(
            f"{get_request_id()}WS accept 失败: {type(e).__name__}: {e}"
        )
        return

    channels = _user_channels(user)
    queues = [(c, subscribe(c)) for c in channels]
    logger.info(
        f"{get_request_id()}WS /ws/approval 已连接 user_id={user.id} "
        f"channels={channels}"
    )

    try:
        # 同时监听所有订阅 queue，先到先发
        pending = {asyncio.create_task(dump_message(q)): chan for chan, q in queues}
        while True:
            done, _ = await asyncio.wait(
                pending.keys(), return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                chan = pending.pop(task)
                try:
                    msg = task.result()
                    await socket.send_text(msg)
                except Exception as e:
                    logger.warning(
                        f"{get_request_id()}WS send_text 失败 chan={chan}: "
                        f"{type(e).__name__}: {e}"
                    )
                # 重新挂一个新的等待
                q = next((qq for c, qq in queues if c == chan), None)
                if q is not None:
                    pending[asyncio.create_task(dump_message(q))] = chan
    except Exception as e:
        # 客户端断开会抛 WebSocketDisconnect 之类
        logger.info(
            f"{get_request_id()}WS /ws/approval 连接结束 user_id={user.id}: "
            f"{type(e).__name__}: {e}"
        )
    finally:
        for chan, q in queues:
            unsubscribe(chan, q)
        try:
            await socket.close()
        except Exception:
            pass
