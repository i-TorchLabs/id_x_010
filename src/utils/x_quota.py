"""用户月度额度检查。

按 ``users.system_model_quota_usd`` 配置的月度额度上限，从 ``usage_logs`` 仅
聚合 ``is_system_model=True`` 的系统预置模型调用花费进行比较。

- ``system_model_quota_usd`` 为 NULL：不限额，放行。
- 仅限制系统预置模型调用；用户自定义模型不受配额限制。
- 聚合失败时 best-effort 放行（不阻塞主链路），仅记 warning。
"""

from datetime import datetime, timezone
from typing import Tuple

from sqlalchemy import func, select

from x_models.id_x_010.src.models.x_models import UsageLog, User, get_session


def _month_start_utc(now: datetime) -> datetime:
    """返回给定 UTC 时刻所在自然月的起始时刻（当月 1 日 00:00:00 UTC）。"""
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def check_user_quota(user_id: int) -> Tuple[bool, str]:
    """检查用户本月系统模型花费是否超过配额上限。

    仅统计 ``is_system_model=True`` 的调用；用户自定义模型不计入。

    Args:
        user_id: 用户 ID。

    Returns:
        (ok, message) —— ok=True 时 message 为空；ok=False 时 message 含详情。
        任何异常都 best-effort 返回 (True, "")，不阻塞主流程。
    """
    try:
        async with get_session()() as session:
            user = (
                await session.execute(
                    select(User).where(User.id == user_id)
                )
            ).scalar_one_or_none()
            if user is None:
                return True, ""

            limit = getattr(user, "system_model_quota_usd", None)
            if limit is None:
                return True, ""

            now = datetime.now(timezone.utc)
            month_start = _month_start_utc(now)

            total = (
                await session.execute(
                    select(func.coalesce(func.sum(UsageLog.cost_usd), 0.0)).where(
                        UsageLog.user_id == user_id,
                        UsageLog.is_system_model.is_(True),
                        UsageLog.created_at >= month_start,
                    )
                )
            ).scalar_one()

        if total is None:
            return True, ""

        if total >= limit:
            return (
                False,
                f"本月系统模型额度已用尽（${total:.2f}/${limit:.2f}），"
                f"次月 1 日自动恢复。自定义模型不受此限制。",
            )

        return True, ""
    except Exception as e:
        from utils.log_util import get_request_id, logger

        logger.warning(
            f"{get_request_id()}check_user_quota 失败,放行: "
            f"{type(e).__name__}: {e}"
        )
        return True, ""
