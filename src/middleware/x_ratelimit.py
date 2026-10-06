"""进程内滑动窗口限流器（TASK-008）。

实现：每个 scope+key 维护一个时间戳列表，每次请求裁掉 60s 窗口外的旧记录，
再判断是否达到上限。线程/协程安全由 GIL 与 asyncio 单线程模型保证（list.append
+ list comprehension 都是原子性表达，且 async 调用点之间无 await）。

已知限制：**多副本部署时各副本独立计数，无法跨进程聚合**。如需精确限流，
请后续引入 Redis（已明确不在本期范围）。

调用约定：
- ``rate_limit(scope, key, limit=None)`` 返回 True 允许、False 拒绝；
- ``clear_rate_limit(scope, key)`` 在登录成功等"清零失败计数"场景调用。
"""

import time
from collections import defaultdict
from typing import Optional

from utils.log_util import get_request_id, logger

# 默认每分钟上限：scope 维度（chat 包含 Mutation.chat 与 SSE stream_chat）
RATE_LIMITS = {"chat": 20, "stream_chat": 20, "login": 5}
# 滑动窗口长度（秒）
WINDOW_SEC = 60

# key=f"{scope}:{key}" → [t1, t2, ...]，窗口外的时间戳在每次 rate_limit 调用
# 时被惰性清理，避免起定时器线程
_buckets: defaultdict = defaultdict(list)


async def rate_limit(scope: str, key: str, limit: Optional[int] = None) -> bool:
    """返回 True 表示允许，False 表示已达上限。

    Args:
        scope: "chat" / "stream_chat" / "login" / 自定义；未注册的 scope 默认 20。
        key: 用户 ID、客户端 IP 或邮箱等唯一标识。
        limit: 显式上限；None 时取 RATE_LIMITS.get(scope, 20)。
    """
    if not scope or not key:
        return True  # 缺 key 不限流，避免异常路径阻塞

    cap = limit if limit is not None else RATE_LIMITS.get(scope, 20)
    now = time.time()
    bucket_key = f"{scope}:{key}"

    # 清理窗口外（list comprehension 是原子的；async 上下文无 await 中断）
    current = _buckets[bucket_key]
    current = [t for t in current if now - t < WINDOW_SEC]
    if len(current) >= cap:
        logger.warning(
            f"{get_request_id()}rate_limit 拒绝: scope={scope} key={key} "
            f"count={len(current)}/{cap} window={WINDOW_SEC}s"
        )
        _buckets[bucket_key] = current  # 仍要写回清理后的列表
        return False

    current.append(now)
    _buckets[bucket_key] = current
    return True


def clear_rate_limit(scope: str, key: str) -> None:
    """清除指定 scope+key 的全部计数（登录成功后调用，避免遗留失败计数）。"""
    if not scope or not key:
        return
    _buckets.pop(f"{scope}:{key}", None)
