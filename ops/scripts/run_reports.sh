#!/bin/bash
# 报告订阅系统 cron 入口（TASK-014）
#
# 由 ops/crontab.example 中的条目调用，每日 9:00 跑所有到期订阅。
# 执行环境为容器内 /app 目录，需要 service 容器已构建（含全部 Python 依赖）。
#
# 输出：reports/{subscription_id}_{timestamp}.{format}
# 日志：写到 stdout/stderr，由 cron 重定向到 /var/log/id_x_010_reports.log

set -e

# 容器内 ROOT 路径；本地 dev 改为项目根
cd "${ID_X_010_ROOT:-/app/i-Core/x_models/id_x_010}" 2>/dev/null || cd /app

# 触发 Python 异步入口
python -c "
import asyncio
import sys

from x_models.id_x_010.src.utils.x_report_runner import run_due_subscriptions

try:
    n = asyncio.run(run_due_subscriptions())
    print(f'executed {n} subscriptions')
    sys.exit(0)
except Exception as e:
    print(f'run_reports failed: {type(e).__name__}: {e}', file=sys.stderr)
    sys.exit(1)
"
