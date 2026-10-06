"""Prometheus 指标定义（TASK-007）。

仅定义指标实例；具体埋点在三个 Agent 与 SQLSecurityChecker 中调用。
通过 ``controllers.`` 的 GET /metrics endpoint 暴露 ``generate_latest()``。

命名规范：
- 前缀 ``id_x_010_``（与 plugin name 一致，避免跨服务冲突）
- Counter 后缀 ``_total``，Histogram 后缀 ``_seconds``
- label 名按 Prometheus 推荐使用小写下划线
"""

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

# LLM 调用次数：labels 与 usage_logs 字段对齐，便于交叉查询
LLM_CALLS = Counter(
    "id_x_010_llm_calls_total",
    "LLM 调用次数",
    ["model", "intent", "status"],
)

# LLM 调用延迟：仅记录成功路径，异常路径不observe（避免拉高 P99）
LLM_LATENCY = Histogram(
    "id_x_010_llm_latency_seconds",
    "LLM 调用延迟（秒）",
    ["model"],
)

# 活跃 SSE 流数：连接断开时 dec，开始时 inc，反映并发负载
ACTIVE_STREAMS = Gauge(
    "id_x_010_active_streams",
    "活跃 SSE 流式连接数",
)

# SQL 安全拦截：reason_type 区分 protected_table / protected_column /
# forbidden_statement / non_select / etc.（详见 sql_agent.SQLSecurityChecker）
SECURITY_BLOCKS = Counter(
    "id_x_010_security_blocks_total",
    "SQL 安全拦截次数",
    ["reason_type"],
)

# SQL Agent 连接池大小（TASK-011 通过 _collect_pool_metrics 上报）
DB_POOL_SIZE = Gauge(
    "id_x_010_db_pool_size",
    "SQL Agent 连接池当前大小",
    ["db_name"],
)


def render_metrics() -> tuple[bytes, str]:
    """供 /metrics endpoint 调用，返回 (content_bytes, content_type)。"""
    return generate_latest(), CONTENT_TYPE_LATEST
