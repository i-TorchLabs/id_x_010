"""用户当日 token 配额检查（TASK-008）。

从 ``usage_logs`` 表聚合当日（最近 24 小时）的 token 消耗，与用户配额比较。
未配置 USAGE_LOGS 表或聚合失败时返回 True 许可（best-effort，不阻塞主链路）。
"""

from datetime import datetime, timedelta, timezone
from typing import Tuple

from sqlalchemy import func, select
from x_models.id_x_010.src.models.x_models import UsageLog, get_session

# 默认每用户每日 100 万 token，约够 200 条较长 SQL Agent 对话
DEFAULT_DAILY_TOKEN_QUOTA = 1_000_000


async def check_user_quota(
    user_id: int, quota: int = DEFAULT_DAILY_TOKEN_QUOTA
) -> Tuple[bool, str]:
    """检查用户当日 token 是否超限。

    Args:
        user_id: 用户 ID。
        quota: 上限，默认 DEFAULT_DAILY_TOKEN_QUOTA。

    Returns:
        (ok, message) —— ok=True 时 message 为空；ok=False 时 message 含详情。
        任何异常都 best-effort 返回 (True, "")，不阻塞主流程。
    """
    try:
        now = datetime.now(timezone.utc)
        start = now - timedelta(days=1)
        async with get_session()() as session:
            total = (
                await session.execute(
                    select(func.coalesce(func.sum(UsageLog.total_tokens), 0)).where(
                        UsageLog.user_id == user_id,
                        UsageLog.created_at >= start,
                    )
                )
            ).scalar_one()

        if total is None:
            return True, ""

        if total >= quota:
            return False, f"今日额度已用尽（{total}/{quota} tokens）"

        return True, ""
    except Exception as e:
        # best-effort：聚合失败时放行，仅 logger.warning
        from utils.log_util import get_request_id, logger

        logger.warning(
            f"{get_request_id()}check_user_quota 失败,放行: "
            f"{type(e).__name__}: {e}"
        )
        return True, ""
