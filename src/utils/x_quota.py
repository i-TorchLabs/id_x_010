"""用户月度额度检查（TASK-008 重构）。

按 ``user_model_settings.quota_limit_monthly_usd`` 配置的月度额度上限，
从 ``usage_logs.cost_usd`` 按**自然月**聚合该用户全部模型的花费进行比较。

- 用户未配置模型设置、或 ``quota_limit_monthly_usd`` 为 NULL：不限额，放行。
- 聚合失败时 best-effort 放行（不阻塞主链路），仅记 warning。

取代了原先按日 token 聚合的 ``DEFAULT_DAILY_TOKEN_QUOTA`` 机制；流量（RPM）
限制由 ``x_ratelimit`` 独立处理，本模块不再涉及。
"""

from datetime import datetime, timezone
from typing import Tuple

from sqlalchemy import func, select

from x_models.id_x_010.src.models.x_models import UsageLog, get_session
from x_models.id_x_010.src.views.x_views import get_user_model_settings


def _month_start_utc(now: datetime) -> datetime:
    """返回给定 UTC 时刻所在自然月的起始时刻（当月 1 日 00:00:00 UTC）。"""
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def check_user_quota(user_id: int) -> Tuple[bool, str]:
    """检查用户本月花费是否超过其配置的月度额度上限。

    Args:
        user_id: 用户 ID。

    Returns:
        (ok, message) —— ok=True 时 message 为空；ok=False 时 message 含详情。
        任何异常都 best-effort 返回 (True, "")，不阻塞主流程。
    """
    try:
        settings = await get_user_model_settings(user_id)
        if settings is None:
            return True, ""

        limit = settings.quota_limit_monthly_usd
        if limit is None:
            return True, ""

        now = datetime.now(timezone.utc)
        month_start = _month_start_utc(now)

        async with get_session()() as session:
            total = (
                await session.execute(
                    select(func.coalesce(func.sum(UsageLog.cost_usd), 0.0)).where(
                        UsageLog.user_id == user_id,
                        UsageLog.created_at >= month_start,
                    )
                )
            ).scalar_one()

        if total is None:
            return True, ""

        if total >= limit:
            return (
                False,
                f"本月额度已用尽（${total:.2f}/${limit:.2f}），"
                f"次月 1 日自动恢复",
            )

        return True, ""
    except Exception as e:
        from utils.log_util import get_request_id, logger

        logger.warning(
            f"{get_request_id()}check_user_quota 失败,放行: "
            f"{type(e).__name__}: {e}"
        )
        return True, ""
