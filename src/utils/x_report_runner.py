"""报告订阅执行器（TASK-014）。

**由系统 cron 调用，不依赖异步任务队列**：``ops/scripts/run_reports.sh`` 将
本模块的 ``run_due_subscriptions`` 包成一个独立 Python 进程跑一次后退出。
"""

import os
from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import ReportSubscription, get_session

# 报告输出目录：容器内 /app/reports/，本地 dev 为 ROOT/reports/
REPORT_DIR = os.getenv("ID_X_010_REPORT_DIR", "reports")

# 单次 export 上限：避免长跑 SQL 把磁盘塞爆；超限则只保留前 N 行并标注截断
MAX_EXPORT_ROWS = 10_000


async def run_subscription(subscription_id: int) -> str:
    """执行单个订阅：加载 → SQL Agent 跑 query_template → 导出 → 存盘。

    Returns:
        生成的文件绝对路径；失败返回空字符串并 last_run_status='failed'。
    """
    try:
        async with get_session()() as session:
            sub = (
                await session.execute(
                    select(ReportSubscription).where(
                        ReportSubscription.id == subscription_id
                    )
                )
            ).scalar_one_or_none()
            if sub is None:
                logger.warning(
                    f"{get_request_id()}run_subscription: 订阅不存在 id={subscription_id}"
                )
                return ""
            db_name = sub.db_name or ""
            query_template = sub.query_template
            fmt = sub.format or "xlsx"
            sub_name = sub.name

        # 延迟导入避免循环：SQLAgent import x_models
        from x_models.id_x_010.src.agents.x_sql_agent import SQLAgent
        from x_models.id_x_010.src.utils.x_export import (
            export_csv,
            export_json,
            export_xlsx,
        )

        agent = SQLAgent(db_name=db_name)
        await agent.db.connect()
        try:
            rows, columns = await agent.db.execute_query(query_template)
        finally:
            try:
                await agent.db.disconnect()
            except Exception:
                pass

        # 截断保护
        truncated = len(rows) > MAX_EXPORT_ROWS
        rows = rows[:MAX_EXPORT_ROWS]

        os.makedirs(REPORT_DIR, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        filename = f"{sub.id}_{ts}.{fmt}"
        filepath = os.path.join(REPORT_DIR, filename)

        if fmt == "csv":
            data = export_csv(rows, columns)
        elif fmt == "json":
            data = export_json(rows)
        else:
            data = export_xlsx(rows, columns)

        with open(filepath, "wb") as f:
            f.write(data)

        # 更新 last_run 状态
        async with get_session()() as session:
            sub = (
                await session.execute(
                    select(ReportSubscription).where(
                        ReportSubscription.id == subscription_id
                    )
                )
            ).scalar_one_or_none()
            if sub is not None:
                sub.last_run_at = datetime.now(timezone.utc)
                sub.last_run_status = "success"
                await session.commit()

        suffix = " (truncated)" if truncated else ""
        logger.info(
            f"{get_request_id()}run_subscription 完成 id={subscription_id} "
            f"name='{sub_name}' rows={len(rows)} file={filepath}{suffix}"
        )
        return filepath
    except Exception as e:
        logger.error(
            f"{get_request_id()}run_subscription 失败 id={subscription_id}: {e}",
            exc_info=True,
        )
        # 失败也记 last_run_status
        try:
            async with get_session()() as session:
                sub = (
                    await session.execute(
                        select(ReportSubscription).where(
                            ReportSubscription.id == subscription_id
                        )
                    )
                ).scalar_one_or_none()
                if sub is not None:
                    sub.last_run_at = datetime.now(timezone.utc)
                    sub.last_run_status = "failed"
                    await session.commit()
        except Exception:
            pass
        return ""


async def run_due_subscriptions() -> int:
    """扫描所有 enabled 订阅，cron 匹配当前时间则执行。

    判断逻辑：尝试用 croniter 库；缺失则所有订阅都不执行（best-effort）。
    Returns: 实际执行的订阅数。
    """
    try:
        from croniter import croniter
    except ImportError:
        logger.warning(
            f"{get_request_id()}croniter 未安装，run_due_subscriptions 跳过。"
            "请 pip install croniter 启用此能力"
        )
        return 0

    try:
        async with get_session()() as session:
            subs = (
                await session.execute(
                    select(ReportSubscription).where(
                        ReportSubscription.enabled.is_(True)
                    )
                )
            ).scalars().all()

        now = datetime.now(timezone.utc)
        executed = 0
        for sub in subs:
            try:
                # 取上次执行时间作为基准；从未执行则从 1 小时前
                base = sub.last_run_at or datetime.fromtimestamp(0, tz=timezone.utc)
                if base.tzinfo is None:
                    base = base.replace(tzinfo=timezone.utc)
                # croniter 不直接支持 tz-aware；转 naive 比较
                next_run = croniter(sub.cron, base.replace(tzinfo=None)).get_next(datetime)
                if next_run <= now.replace(tzinfo=None):
                    await run_subscription(sub.id)
                    executed += 1
            except Exception as e:
                logger.warning(
                    f"{get_request_id()}subscription {sub.id} 执行失败: "
                    f"{type(e).__name__}: {e}"
                )
        logger.info(
            f"{get_request_id()}run_due_subscriptions 完成 executed={executed}/{len(subs)}"
        )
        return executed
    except Exception as e:
        logger.error(
            f"{get_request_id()}run_due_subscriptions 失败: {e}", exc_info=True
        )
        return 0
