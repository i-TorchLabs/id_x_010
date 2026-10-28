from __future__ import annotations

import os
import re
import time
from collections import OrderedDict
from typing import (
    TYPE_CHECKING,
    Any,
    AsyncGenerator,
    Dict,
    List,
    Literal,
    Optional,
    Tuple,
    cast,
)
from urllib.parse import quote_plus

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

if TYPE_CHECKING:
    from langchain_community.agent_toolkits import SQLDatabaseToolkit
    from langchain_community.utilities import SQLDatabase

try:
    from langchain_community.agent_toolkits import (
        SQLDatabaseToolkit as _SQLDatabaseToolkit,
    )
    from langchain_community.utilities import SQLDatabase as _SQLDatabase

    LANGCHAIN_COMMUNITY_AVAILABLE = True
except ImportError:
    _SQLDatabase = None  # type: ignore[misc,assignment]
    _SQLDatabaseToolkit = None  # type: ignore[misc,assignment]
    LANGCHAIN_COMMUNITY_AVAILABLE = False

from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import MessagesState
from langgraph.graph.state import CompiledStateGraph
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.agents.x_llm_error import (
    DEFAULT_EXTERNAL_MODEL,
    friendly_llm_error,
)
from x_models.id_x_010.src.models.x_models import (
    get_external_model_config,
)

# TASK-007：可选 metrics，缺失 prometheus_client 时静默跳过
try:
    from x_models.id_x_010.src.utils.x_metrics import LLM_CALLS, LLM_LATENCY
except Exception:  # pragma: no cover
    LLM_CALLS = None  # type: ignore[assignment]
    LLM_LATENCY = None  # type: ignore[assignment]


def _observe_llm(model: str, intent: str, status: str, elapsed: float) -> None:
    """埋点 LLM 调用，任何异常静默忽略——指标不可用不影响主链路。"""
    try:
        if LLM_CALLS is not None:
            LLM_CALLS.labels(model=model, intent=intent, status=status).inc()
        if LLM_LATENCY is not None and status == "success":
            LLM_LATENCY.labels(model=model).observe(elapsed)
    except Exception:
        pass


class SQLAgentState(MessagesState):
    question: str
    sql: str
    sql_meaning: str
    result: List[Dict[str, Any]]
    columns: List[str]
    answer: str
    thinking: str
    error: Optional[str]
    tables: List[str]
    relevant_tables: List[str]
    approval_status: str
    pending_sql: str
    # True: check_query 通过后跳过 human_approval 直接 run_query，并在拿到结果后
    # 流式输出自然语言解释。False: 进入 human_approval 节点等用户审批。
    auto_execute: bool
    # 前置意图识别：在 generate_query 之前判定，用于塑形 SQL（ORDER BY/GROUP BY/LIMIT）
    # 并指导后续图表推荐。形如 {"intent": "trend", "reason": "...", "suggest_chart": "line"}
    analysis_intent: Optional[Dict[str, str]]


GENERATE_QUERY_SYSTEM_PROMPT = """你是一个专业的 SQL 专家，负责与 PostgreSQL 数据库交互。

# Schema 检索说明
下方 schema 已基于用户问题向量化召回 top-5 相关表。如不足以回答，请明确指出"需要 X 表的更多信息"。

给定用户的问题，生成符合 PostgreSQL 语法的查询语句。

重要规则：
1. 只生成 SELECT 查询语句，禁止使用 INSERT、UPDATE、DELETE、DROP、TRUNCATE 等修改数据的语句
2. 除非用户明确指定返回数量，否则总是限制结果最多返回 {top_k} 条记录
3. 只查询与问题相关的列，不要使用 SELECT *
4. 可以按相关列排序以返回最有趣的示例
5. 生成的 SQL 必须符合 PostgreSQL 语法
6. 使用适当的表别名提高可读性
7. 如果用户问题无法用 SQL 表达，请说明原因
8. **按分析意图塑形 SQL**（见下方意图）：
   - trend（趋势）: 必须按时间列 ASC 排序，便于前端折线/面积图按时间轴渲染
   - ranking（排名）: 必须按主要数值列 DESC 排序 + LIMIT，便于前端取 Top N
   - distribution（分布）: 用 GROUP BY 类别列 + COUNT/SUM 聚合，结果类别数 ≤ 30
   - comparison（对比）: 用 GROUP BY 类别列 + 多个聚合指标，便于前端分组柱状图
   - correlation（相关性）: 返回两个数值列的原始行（不要聚合），≥ 20 行最佳
   - aggregate（聚合）: 返回单值或少量汇总行
   - lookup/detail: 返回明细行，必要时 ORDER BY 主键

# 分析意图（由前置节点识别，请严格遵循）

{intent_guidance}
"""


# 前置意图识别 prompt：在生成 SQL 之前判断用户分析目的，
# 用于塑形 SQL（ORDER BY / GROUP BY / LIMIT 策略）并指导后续图表推荐
INTENT_ANALYSIS_PROMPT = """你是数据分析意图识别专家。基于用户问题和数据库表结构，判断用户的**核心分析意图**。

# 意图类型定义

| intent | 含义 | 决策线索 |
|--------|------|---------|
| trend | 趋势 / 时间序列变化 | 问题含"趋势""变化""走势""近 N 天/月"或涉及时间列 |
| comparison | 多维对比 | 问题含"对比""比较""VS""各 X 的 Y"或多个类别要并列 |
| distribution | 占比 / 分布 | 问题含"占比""分布""比例""百分比""构成" |
| ranking | 排名 / Top N | 问题含"排名""前 N""最高""最低""Top" |
| correlation | 两变量相关性 | 问题含"关系""相关""随 X 变化的 Y""影响" |
| lookup | 单值查表 | 查单个实体的某属性，如"张三的手机号" |
| detail | 多列明细列表 | "列出""显示所有""查询所有 X 的详细信息" |
| aggregate | 单值统计 | "总数""平均""总和""最大值""计数"等单一聚合值 |
| schema | 元数据查询 | "有哪些表""表结构""字段" |

# 输出格式（严格单行 JSON，无 markdown 包裹）

{{"intent": "<intent>", "reason": "<一句话依据>", "suggest_chart": "<bar|line|area|pie|scatter|none>"}}

- suggest_chart: 即使没明确要求画图，**也要基于意图给出建议**（trend→line/area, comparison→bar, distribution→pie, ranking→bar, correlation→scatter, 其余→none）
- reason: 30 字以内，说明识别依据

# 输入

用户问题：{question}
数据库表结构（节选）：
{schema_info}
"""


INTENT_ANALYSIS_SYSTEM = "你是数据分析意图识别专家。只输出**单行 JSON**，不要 markdown 包裹、不要解释。"

CHECK_QUERY_SYSTEM_PROMPT = """你是一个 SQL 专家，具有极强的细节关注能力。
请检查 PostgreSQL 查询中的常见错误，包括：
- 在 NOT IN 中使用 NULL 值
- 应使用 UNION ALL 时使用了 UNION
- 对排他范围使用 BETWEEN
- 谓词中的数据类型不匹配
- 标识符引用不正确
- 函数参数数量错误
- 转换为错误的数据类型
- 连接使用了错误的列

如果有上述错误，请重写查询。如果没有错误，只需重现原始查询。
你将在检查后调用适当的工具来执行查询。
"""

RESULT_EXPLANATION_PROMPT = """你是一个数据分析专家，负责将 SQL 查询结果转换为易懂的自然语言回答。

原始问题：{original_question}
执行的 SQL：{sql_query}
查询结果：
{query_result}

请将查询结果转换为清晰、易懂的自然语言回答：
1. 直接回答用户的问题
2. 如果结果为空，说明没有找到相关数据
3. 如果有数据，简洁地呈现关键信息
4. 避免重复 SQL 语句或原始数据格式
"""


SQL_MEANING_PROMPT = """You are a database expert. Given a user's question and the SQL query generated to answer it, \
provide a concise one-sentence explanation in the SAME LANGUAGE as the user's question, \
describing what this SQL query does.

Rules:
1. Keep it to ONE sentence (max 40 words).
2. Describe the query's purpose/intent in plain language (e.g., "This query counts the number of orders in the last 30 days").
3. Do NOT repeat the SQL syntax — focus on its meaning.
4. Do NOT add any preamble like "This query" prefix or "Explanation:" label.
5. Use the SAME language as the user's question (Chinese question → Chinese explanation).
"""


CHART_DETECTION_PROMPT = """你是数据分析与可视化专家。基于用户问题、列结构和样本数据，**深度识别用户分析意图**并决定是否主动推荐图表。

# 第一步：识别分析意图（intent）

| intent | 含义 | 典型问法示例 |
|--------|------|--------------|
| trend | 趋势 / 时间序列变化 | "近 30 天销量变化"、"每月新增用户趋势" |
| comparison | 多维对比 | "各部门预算对比"、"各品类销量对比" |
| distribution | 占比 / 分布 | "用户来源占比"、"性别分布"、"市场份额" |
| ranking | 排名 / Top N | "销量前 10 的产品"、"最高分的 5 名学生" |
| correlation | 两变量相关性 | "价格与销量的关系"、"学习时长与分数的相关性" |
| lookup | 单值查表 / 明细查证 | "用户张三的手机号"、"订单 #12345 的详情" |
| detail | 多列明细列表 | "列出所有订单"、"显示用户表" |
| aggregate | 单值统计 / 聚合 | "总销售额"、"平均年龄"、"用户总数" |
| schema | 元数据查询 | "有哪些表"、"表结构是什么" |

# 第二步：图表推荐（proactive，不依赖关键词）

**关键原则：当结果数据结构适合可视化时，主动推荐图表，即使用户没说"画图/可视化"。**
仅当下述条件不满足时才输出 chart_type = "none"：

- **bar**: intent ∈ {{comparison, ranking, distribution(类别少时也可 pie)}}；1 类别列 + ≥1 数值列；≤30 行最佳（>30 行仍可，前端会截断）
- **line**: intent = trend；1 时间/有序数值列为 x + ≥1 数值列；行数 ≥2
- **pie**: intent = distribution；1 类别列 + 恰好 1 数值列；类别数 2-8
- **area**: intent = trend；同 line，但强调累积量或单指标长期走势
- **scatter**: intent = correlation；2 个数值列（x, y）；行数 ≥5
- **none**: intent ∈ {{lookup, detail, schema, aggregate}} 或数据不适合（单值/全文本/空/单列）

# 第三步：title 与 axis 选择

- title：用**用户问题的语言**写一句话概括，不超过 30 字
- x_column / y_columns：必须从实际 columns 中选择（不要凭空造列名）
- 多个数值列时 y_columns 列出所有可比的；pie 只取一个

# 输出格式（严格遵守，单行 JSON，无多余文本）

不需要图表时：
```json
{{"intent": "<intent>", "chart_type": "none", "reason": "<一句话说明为何不画图>"}}
```

需要图表时：
```json
{{"intent": "<intent>", "chart_type": "bar|line|pie|area|scatter", "x_column": "<列名>", "y_columns": ["<列1>", ...], "title": "<标题>", "reason": "<一句话为何此图>"}}
```

# 输入数据

用户问题：{question}
列结构：{columns}
样本数据（前 5 行）：{sample_rows}
"""


CHART_DETECTION_SYSTEM = "你是数据分析与可视化专家。只输出**单行 JSON**（不要 markdown 包裹、不要解释文字）。chart_type 必须是 none/bar/line/pie/area/scatter 之一。"


DANGEROUS_KEYWORDS = {
    "INSERT": "插入数据",
    "UPDATE": "更新数据",
    "DELETE": "删除数据",
    "DROP": "删除表/库",
    "ALTER": "修改结构",
    "CREATE": "创建对象",
    "TRUNCATE": "清空表",
    "RENAME": "重命名",
    "GRANT": "授权",
    "REVOKE": "撤销权限",
    "EXEC": "执行存储过程",
    "EXECUTE": "执行存储过程",
    "CALL": "调用存储过程",
    "MERGE": "合并数据",
    "REPLACE": "替换数据",
}

ALLOWED_KEYWORDS = {
    "SELECT": "查询数据",
    "WITH": "公用表表达式",
    "FROM": "指定表",
    "WHERE": "条件过滤",
    "JOIN": "表连接",
    "LEFT": "左连接",
    "RIGHT": "右连接",
    "INNER": "内连接",
    "OUTER": "外连接",
    "ON": "连接条件",
    "AND": "逻辑与",
    "OR": "逻辑或",
    "NOT": "逻辑非",
    "IN": "包含",
    "LIKE": "模糊匹配",
    "BETWEEN": "范围",
    "IS": "空值判断",
    "NULL": "空值",
    "GROUP": "分组",
    "BY": "分组字段",
    "HAVING": "分组条件",
    "ORDER": "排序",
    "ASC": "升序",
    "DESC": "降序",
    "LIMIT": "限制行数",
    "OFFSET": "偏移量",
    "AS": "别名",
    "DISTINCT": "去重",
    "UNION": "合并查询",
    "EXCEPT": "差集",
    "INTERSECT": "交集",
}


# ---------------------------------------------------------------------------
# SQL Agent 表级 + 列级访问控制
#
# 设计原则（再次放宽管控范围）：
#   - 默认 ReadOnly：除完全禁止的表与禁止的列外，所有表都可以 SELECT-only
#     方式读取，execute_query 以 BEGIN READ ONLY 事务执行，DB 层兜底
#   - 完全禁止的表：仅 user_tokens / password_reset_tokens —— 这两张表的
#     核心字段 token 等同会话/密码重置凭据，整表无可放出的非敏感列，
#     整表拒绝最简最安全
#   - 列级遮蔽：users 表允许查 id/email/display_name 等用户名信息列，
#     但 password_hash 列禁止；通过 SQL 解析识别 SELECT 列清单拦截
#   - 受保护名单/列名均可由环境变量扩展（追加）
# ---------------------------------------------------------------------------

# 完全禁止的表：含认证凭据 / 重置凭据，整表无可放出的非敏感列
_DEFAULT_PROTECTED_TABLES = {
    "user_tokens",            # 含认证 token（等同会话密码）
    "password_reset_tokens",  # 含密码重置 token（可重置任意账号密码）
}

# 列级遮蔽：表 → 禁止 SELECT 的列集合。
# users 表允许 LLM 查询 id/email/display_name/created_at 等用户名/身份信息列，
# 仅 password_hash 一列禁止（避免口令哈希被离线爆破）。
# 通过 _extract_select_columns 解析 SQL 中的列清单来检测。
_DEFAULT_PROTECTED_COLUMNS = {
    "users": {"password_hash"},
}

# PostgreSQL 系统目录 schema 策略：
#   - pg_catalog：全拒绝。内部混有 pg_class（结构，安全）与 pg_user/pg_shadow/
#     pg_authid（含口令哈希，敏感），无法按表名安全白名单，整体拒绝 LLM 触达。
#     SQL Agent 自身内省通过 execute_query(internal=True) 绕过此检查。
#   - information_schema：按视图白名单放行。该 schema 含两类视图：
#       * 结构性元数据（白名单放行）：tables/columns/views/schemata 等
#         仅暴露表名/列名/类型，LLM 回答"有多少表""字段类型"等合理问题时需要
#       * 权限/身份元数据（仍拒绝）：role_table_grants/enabled_roles 等
#         暴露用户名、权限授予、连接映射，存在被 LLM 枚举用户身份的风险
#
# 因此 PROTECTED_SCHEMAS 仅保留 pg_catalog；information_schema 改由
# SAFE_INFORMATION_SCHEMA_VIEWS 白名单 + check_protected_tables 中按表名判定
_DEFAULT_PROTECTED_SCHEMAS = {
    "pg_catalog",
}

# information_schema 中允许 LLM 查询的视图白名单：
# 仅含结构性元数据，不含权限/角色/用户身份信息
SAFE_INFORMATION_SCHEMA_VIEWS = {
    "tables",            # 表清单（table_name, table_schema, table_type）
    "columns",           # 列清单（column_name, data_type, is_nullable）
    "views",             # 视图清单
    "schemata",          # schema 清单（schema_name）
    "table_constraints", # 约束清单（constraint_name, constraint_type）
    "key_column_usage",  # 主键/唯一键列使用
    "referential_constraints",  # 外键约束
    "check_constraints",         # 检查约束
    "parameters",        # 函数参数
    "routines",          # 函数/存储过程清单（不含定义体）
}


def _load_protected_tables() -> set:
    """加载完全禁止的表集合：默认集 + 环境变量扩展。

    环境变量 SQL_AGENT_PROTECTED_TABLES 行为：
      - 缺省（未设置）：使用 _DEFAULT_PROTECTED_TABLES
      - 设置为非空（如 "users,custom_secret"）：**追加**到默认集
      - 设置为 "NONE"（全大写）：清空默认集（用于完全自定义环境的极简场景，
        不推荐生产使用）
    返回的元素均为小写，便于无大小写敏感比较。
    """
    tables = set(_DEFAULT_PROTECTED_TABLES)
    env_val = os.getenv("SQL_AGENT_PROTECTED_TABLES", "").strip()
    if env_val:
        if env_val.upper() == "NONE":
            tables = set()
        else:
            for name in env_val.split(","):
                name = name.strip().strip('"').strip("`").strip("'").lower()
                if name:
                    tables.add(name)
    return tables


def _load_protected_schemas() -> set:
    """加载受保护 schema 集合：默认集 + 环境变量扩展。"""
    schemas = set(_DEFAULT_PROTECTED_SCHEMAS)
    env_val = os.getenv("SQL_AGENT_PROTECTED_SCHEMAS", "").strip()
    if env_val:
        if env_val.upper() == "NONE":
            schemas = set()
        else:
            for name in env_val.split(","):
                name = name.strip().strip('"').strip("`").strip("'").lower()
                if name:
                    schemas.add(name)
    return schemas


def _load_protected_columns() -> Dict[str, set]:
    """加载列级遮蔽映射：表名(小写) → 禁止 SELECT 的列名集合(小写)。

    环境变量 SQL_AGENT_PROTECTED_COLUMNS 格式：
      "<table>:<col1>,<col2>;<table2>:<col>"
    例如："users:password_hash,salt;payments:card_number"
    会与 _DEFAULT_PROTECTED_COLUMNS 合并（同表取并集）。
    设为 "NONE" 清空默认集。
    """
    cols: Dict[str, set] = {t: set(s) for t, s in _DEFAULT_PROTECTED_COLUMNS.items()}
    env_val = os.getenv("SQL_AGENT_PROTECTED_COLUMNS", "").strip()
    if env_val:
        if env_val.upper() == "NONE":
            return {}
        # 格式：table:col1,col2;table2:col3
        for entry in env_val.split(";"):
            entry = entry.strip()
            if not entry or ":" not in entry:
                continue
            table_part, cols_part = entry.split(":", 1)
            table = table_part.strip().strip('"').strip("`").strip("'").lower()
            if not table:
                continue
            for c in cols_part.split(","):
                c = c.strip().strip('"').strip("`").strip("'").lower()
                if c:
                    cols.setdefault(table, set()).add(c)
    return cols


PROTECTED_TABLES = _load_protected_tables()
PROTECTED_SCHEMAS = _load_protected_schemas()
PROTECTED_COLUMNS = _load_protected_columns()


class SQLSecurityChecker:
    @staticmethod
    def extract_first_keyword(sql: str) -> Optional[str]:
        sql_clean = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
        sql_clean = re.sub(r"/\*.*?\*/", "", sql_clean, flags=re.DOTALL)
        sql_clean = sql_clean.strip()

        match = re.match(r"^\s*(\w+)", sql_clean, re.IGNORECASE)
        if match:
            return match.group(1).upper()
        return None

    @staticmethod
    def _looks_like_sql_start(text: str) -> bool:
        """判断文本是否以合法 SQL 起手关键字开头（SELECT / WITH）。

        排除中文起首、英文叙述（"I will..."、"This query..."）等被误判为 SQL。
        """
        if not text:
            return False
        # 去掉前导空白和注释
        cleaned = re.sub(r"--.*$", "", text, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
        cleaned = cleaned.lstrip()
        # 必须以 SELECT 或 WITH 开头（大小写不敏感）
        return bool(re.match(r"^(SELECT|WITH)\b", cleaned, re.IGNORECASE))

    @staticmethod
    def detect_dangerous_patterns(sql: str) -> List[Dict[str, str]]:
        dangers = []
        sql_upper = sql.upper()

        first_keyword = SQLSecurityChecker.extract_first_keyword(sql)
        if first_keyword and first_keyword in DANGEROUS_KEYWORDS:
            dangers.append(
                {
                    "type": "dangerous_start",
                    "keyword": first_keyword,
                    "description": f"SQL 语句以危险关键词 {first_keyword} 开头",
                    "action": DANGEROUS_KEYWORDS[first_keyword],
                }
            )

        for keyword, description in DANGEROUS_KEYWORDS.items():
            pattern = rf"\b{keyword}\b"
            if re.search(pattern, sql_upper):
                if first_keyword == keyword:
                    continue
                dangers.append(
                    {
                        "type": "dangerous_keyword",
                        "keyword": keyword,
                        "description": f"SQL 中包含危险关键词 {keyword}",
                        "action": description,
                    }
                )

        injection_patterns = [
            (r";\s*\w+", "多语句执行"),
            (r"--\s*$", "注释截断"),
            (r"/\*.*\*/", "注释注入"),
            (r"UNION\s+(ALL\s+)?SELECT", "UNION 注入"),
            (r"1\s*=\s*1", "恒真条件"),
            (r"'\s*OR\s*'", "字符串注入"),
        ]

        for pattern, desc in injection_patterns:
            if re.search(pattern, sql_upper):
                dangers.append(
                    {
                        "type": "injection_pattern",
                        "pattern": pattern,
                        "description": f"检测到可能的 SQL 注入模式: {desc}",
                    }
                )

        return dangers

    @staticmethod
    def check(sql: str, skip_protected: bool = False) -> Dict[str, Any]:
        result = {
            "safe": True,
            "allowed": True,
            "first_keyword": None,
            "dangers": [],
            "reason": "SQL 语句安全，允许执行",
        }

        # TASK-007：尝试导入 metrics（缺失 prometheus_client 时静默跳过）
        try:
            from x_models.id_x_010.src.utils.x_metrics import SECURITY_BLOCKS
        except Exception:  # pragma: no cover - prometheus_client 可选
            SECURITY_BLOCKS = None  # type: ignore[assignment]

        def _block(reason_type: str) -> None:
            if SECURITY_BLOCKS is not None:
                try:
                    SECURITY_BLOCKS.labels(reason_type=reason_type).inc()
                except Exception:
                    pass

        first_keyword = SQLSecurityChecker.extract_first_keyword(sql)
        result["first_keyword"] = first_keyword

        if not first_keyword:
            result["safe"] = False
            result["allowed"] = False
            result["reason"] = "无法识别 SQL 语句"
            _block("unparsable")
            return result

        dangers = SQLSecurityChecker.detect_dangerous_patterns(sql)
        result["dangers"] = dangers

        if dangers:
            result["safe"] = False
            result["allowed"] = False
            danger_keywords = [d["keyword"] for d in dangers if d.get("keyword")]
            if danger_keywords:
                unique_keywords = list(set(danger_keywords))
                result["reason"] = (
                    f"安全限制：不允许执行 {', '.join(unique_keywords)} 语句"
                )
            else:
                result["reason"] = f"安全限制：{dangers[0]['description']}"
            _block("dangerous_pattern")

        if first_keyword and first_keyword not in ALLOWED_KEYWORDS:
            if first_keyword not in DANGEROUS_KEYWORDS:
                result["safe"] = False
                result["allowed"] = False
                result["reason"] = (
                    f"安全限制：不允许执行未知类型的 SQL 语句（{first_keyword}）"
                )
                _block("unknown_keyword")

        # 受保护表 / 系统目录检查：完全禁止的表（user_tokens 等）即使
        # SELECT 也拒绝；pg_catalog 全 schema 拒绝；information_schema 按白名单放行。
        # skip_protected=True 仅由 SQL Agent 自身内省（list_tables / get_schema_info
        # 查 information_schema）使用，避免规则反噬内省链路
        if not skip_protected:
            protected_violations = SQLSecurityChecker.check_protected_tables(sql)
            if protected_violations:
                result["safe"] = False
                result["allowed"] = False
                first_reason = protected_violations[0].get("reason", "禁止查询受保护表")
                if result["dangers"]:
                    # 已有危险词违例时，将受保护违例附加到 dangers 列表后
                    result["dangers"].extend(protected_violations)
                    # 但 reason 不覆盖——DML/DDL 拒绝信息优先级更高
                else:
                    result["dangers"] = protected_violations
                    result["reason"] = first_reason
                _block("protected_table")

            # 列级遮蔽检查：对未整表禁止、但有遮蔽列的表（如 users.password_hash）
            # 仅在表级检查未拒绝时执行——表已被拒就不再重复列检查
            if result["safe"]:
                col_violations = SQLSecurityChecker.check_protected_columns(sql)
                if col_violations:
                    result["safe"] = False
                    result["allowed"] = False
                    first_col_reason = col_violations[0].get("reason", "禁止查询受保护列")
                    if result["dangers"]:
                        result["dangers"].extend(col_violations)
                    else:
                        result["dangers"] = col_violations
                        result["reason"] = first_col_reason
                    _block("protected_column")

        return result

    @staticmethod
    def is_safe(sql: str) -> bool:
        return SQLSecurityChecker.check(sql)["safe"]

    @staticmethod
    def is_select(sql: str) -> bool:
        first_keyword = SQLSecurityChecker.extract_first_keyword(sql)
        return first_keyword == "SELECT" or first_keyword == "WITH"

    @staticmethod
    def extract_referenced_tables(sql: str) -> List[Tuple[Optional[str], str]]:
        """从 SQL 中提取 FROM / JOIN 子句引用的表（尽力而为的正则解析）。

        返回 [(schema, table), ...]，schema 可能为 None；元素均小写。
        仅覆盖常见 PostgreSQL 形态：
          - ``FROM users``                       -> (None,   "users")
          - ``FROM public.users``                -> ("public","users")
          - ``FROM "User"."Account"``            -> ("user", "account")
          - ``JOIN orders o``                    -> (None,   "orders")
          - ``JOIN schema.orders AS o``          -> ("schema","orders")
        CTE 名（WITH x AS (...)）不会被误识为表引用——WITH 后别名紧接 AS，
        而 FROM/JOIN 后才出现真实表名，正则要求 FROM/JOIN 前缀词。
        """
        if not sql:
            return []

        # 清除注释与字符串字面量，避免误把字面量里的 FROM/JOIN 当成引用
        cleaned = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
        # 字符串字面量：单引号转义双单号为空再整体移除
        cleaned = re.sub(r"'(?:[^']|'')*'", "''", cleaned)

        # FROM/JOIN + 可选 schema. + 表名（支持双引号包裹的标识符）
        pattern = re.compile(
            r"""(?:FROM|JOIN)\s+
                (?:"?(\w+)"?\.)?        # 可选 schema.（可带双引号）
                "?(\w+)"?                # 表名（可带双引号）
            """,
            re.IGNORECASE | re.VERBOSE,
        )

        refs: List[Tuple[Optional[str], str]] = []
        seen = set()
        for match in pattern.finditer(cleaned):
            schema = match.group(1)
            table = match.group(2)
            if not table:
                continue
            # 过滤 SQL 保留字被误判（如 FROM VALUES、FROM LATERAL 等）
            if table.upper() in {
                "VALUES", "LATERAL", "SELECT", "ONLY", "DUAL",
                "UNNEST", "GENERATE_SERIES",
            }:
                continue
            schema_low = schema.lower() if schema else None
            table_low = table.lower()
            key = (schema_low, table_low)
            if key in seen:
                continue
            seen.add(key)
            refs.append((schema_low, table_low))

        return refs

    @staticmethod
    def extract_select_columns(sql: str) -> List[Tuple[Optional[str], str]]:
        """提取 SQL 中显式列出的 SELECT 列名 + 列所属表别名前缀。

        返回 [(table_alias_or_none, column_name), ...]，元素均小写。
        尽力而为的正则解析，覆盖常见 PostgreSQL 形态：
          - ``SELECT id, email FROM users``                -> [(None,"id"),(None,"email")]
          - ``SELECT u.id, u.email FROM users u``          -> [("u","id"),("u","email")]
          - ``SELECT count(*) FROM users``                 -> []  (函数/通配符不出现在结果)
          - ``SELECT * FROM users``                        -> []  (通配符，列不可枚举)
          - ``SELECT password_hash FROM users``            -> [(None,"password_hash")]

        解析失败（CTE、子查询交错、UNION）等情况返回空列表，
        check_protected_columns 会回退到保守判定（拒绝整表）。
        """
        if not sql:
            return []

        # 清除注释与字符串字面量
        cleaned = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
        cleaned = re.sub(r"'(?:[^']|'')*'", "''", cleaned)

        # 提取 SELECT 关键字之后、FROM 之前的列清单（首个 SELECT 阶段）
        # 用 DOTALL 让 . 跨行；CASE-INSENSITIVE
        m = re.search(
            r"\bSELECT\b\s+(?:DISTINCT\s+)?(.*?)\s+FROM\b",
            cleaned,
            re.IGNORECASE | re.DOTALL,
        )
        if not m:
            return []
        cols_str = m.group(1).strip()
        if not cols_str:
            return []

        # 通配符 SELECT *：无法枚举列，返回空让调用方保守处理
        if cols_str == "*" or cols_str.endswith(".*"):
            return []

        # 按逗号分割列清单（不递归处理括号——聚合函数参数里可能有逗号，
        # 简单处理：第一层括号内不分割）
        parts: List[str] = []
        depth = 0
        buf: List[str] = []
        for ch in cols_str:
            if ch == "(":
                depth += 1
                buf.append(ch)
            elif ch == ")":
                depth = max(0, depth - 1)
                buf.append(ch)
            elif ch == "," and depth == 0:
                parts.append("".join(buf))
                buf = []
            else:
                buf.append(ch)
        if buf:
            parts.append("".join(buf))

        result: List[Tuple[Optional[str], str]] = []
        for part in parts:
            part = part.strip()
            if not part:
                continue
            # 跳过 *（出现在 SELECT a.*, b.id 等场景）
            if part == "*" or part.endswith(".*"):
                continue
            # 去除 AS alias 后缀
            # 形如：u.email AS user_email / u.email user_email
            as_match = re.search(
                r"\bAS\b\s+\w+$",
                part,
                re.IGNORECASE,
            )
            if as_match:
                part = part[: as_match.start()].strip()
            else:
                # 也处理隐式别名："col alias"（空格分隔的纯标识符）
                # 但要避免误处理 "u.email" 这种 schema.table 形式
                tokens = re.split(r"\s+", part)
                if len(tokens) >= 2 and not tokens[0].endswith(".*"):
                    # 仅当最后一段看起来像别名（无点、无函数括号）时取倒数第二段
                    if re.match(r"^\w+$", tokens[-1]) and "." not in tokens[-1]:
                        # "u.email e" → 取 "u.email"
                        # 但 "count(*) total" → 跳过（含括号）
                        if "(" not in part:
                            part = " ".join(tokens[:-1])

            # 提取列名：支持 "alias.col" 或 "col"
            col_match = re.match(
                r'(?:"?(\w+)"?\.)?"?(\w+)"?$',
                part,
            )
            if not col_match:
                continue
            tbl_alias = col_match.group(1)
            col_name = col_match.group(2)
            if not col_name:
                continue
            # 过滤函数调用残留（如 count、sum、avg 等聚合关键字）
            if col_name.lower() in {
                "count", "sum", "avg", "min", "max", "distinct",
                "coalesce", "length", "round", "cast",
            }:
                continue
            result.append(
                (tbl_alias.lower() if tbl_alias else None, col_name.lower())
            )

        return result

    @staticmethod
    def check_protected_columns(sql: str) -> List[Dict[str, Any]]:
        """检查 SQL 是否在 SELECT 列清单中显式引用了 PROTECTED_COLUMNS 中的列。

        策略：
          - 解析 SELECT 列清单；若列名命中 PROTECTED_COLUMNS[table] 则拒绝
          - 表与列别名的映射来自 FROM/JOIN 的 alias；若 SQL 用了表别名
            （如 "FROM users u" + "SELECT u.password_hash"），通过 alias 映射到表名
          - 若 SELECT * 或解析不可行，且查询涉及的表在 PROTECTED_COLUMNS 中，
            保守拒绝（无法确认是否触及遮蔽列）
        返回违例列表，空列表表示无违例。
        """
        if not sql or not PROTECTED_COLUMNS:
            return []

        violations: List[Dict[str, Any]] = []

        # 1. 解析 FROM/JOIN 的表别名映射：alias -> table_name(小写)
        #    "FROM users u" → {"u": "users"}
        #    "FROM public.users AS usr" → {"usr": "users"}
        alias_to_table: Dict[str, str] = {}
        cleaned = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
        cleaned = re.sub(r"/\*.*?\*/", "", cleaned, flags=re.DOTALL)
        cleaned = re.sub(r"'(?:[^']|'')*'", "''", cleaned)
        alias_pattern = re.compile(
            r"""(?:FROM|JOIN)\s+
                (?:"?(\w+)"?\.)?        # schema
                "?(\w+)"?                # table
                (?:\s+(?:AS\s+)?(\w+))?  # alias
            """,
            re.IGNORECASE | re.VERBOSE,
        )
        for m in alias_pattern.finditer(cleaned):
            table = m.group(2)
            alias = m.group(3)
            if not table or table.upper() in {
                "VALUES", "LATERAL", "SELECT", "ONLY", "DUAL",
                "UNNEST", "GENERATE_SERIES",
            }:
                continue
            tbl_low = table.lower()
            # 仅记录受列级保护表的别名（其他表别名无意义）
            if tbl_low in PROTECTED_COLUMNS and alias:
                alias_to_table[alias.lower()] = tbl_low

        # 2. 解析 SELECT 列清单
        cols = SQLSecurityChecker.extract_select_columns(sql)
        if not cols:
            # 区分两种情况：
            #   (a) SELECT * / SELECT tbl.* —— 通配符，无法枚举列 → 保守拒绝
            #   (b) SELECT COUNT(*), SUM(col) ... —— 纯聚合无裸列引用，且
            #       不会触及遮蔽列（聚合函数输入参数显式给出）→ 放行
            # 用原始 cols_str 是否含 * 来区分
            cleaned_for_check = re.sub(r"--.*$", "", sql, flags=re.MULTILINE)
            cleaned_for_check = re.sub(r"/\*.*?\*/", "", cleaned_for_check, flags=re.DOTALL)
            cleaned_for_check = re.sub(r"'(?:[^']|'')*'", "''", cleaned_for_check)
            m_sel = re.search(
                r"\bSELECT\b\s+(?:DISTINCT\s+)?(.*?)\s+FROM\b",
                cleaned_for_check,
                re.IGNORECASE | re.DOTALL,
            )
            cols_str = (m_sel.group(1).strip() if m_sel else "").strip()

            # 含 * 通配符 → 保守拒绝（仅当查询涉及受列级保护的表时）
            has_wildcard = "*" in cols_str and ".*" in cols_str or cols_str == "*" or cols_str.endswith(".*")

            if has_wildcard:
                refs = SQLSecurityChecker.extract_referenced_tables(sql)
                for _, tbl in refs:
                    if tbl in PROTECTED_COLUMNS:
                        violations.append(
                            {
                                "type": "protected_column_wildcard",
                                "table": tbl,
                                "reason": (
                                    f"安全限制：禁止以 SELECT * 查询 {tbl}（"
                                    f"含受保护列 {sorted(PROTECTED_COLUMNS[tbl])}，"
                                    "请显式列出非敏感列）"
                                ),
                            }
                        )
                return violations

            # 否则视为纯聚合查询（COUNT(*)/SUM(col) 等），不触及遮蔽列 → 放行
            return []

        # 3. 逐列检查：每列的表名通过 alias 解析或来自唯一受保护表
        # 若 SQL 只 FROM 一个受列级保护的表，无别名的列也算该表的列
        referenced_protected_tables = [
            tbl for _, tbl in SQLSecurityChecker.extract_referenced_tables(sql)
            if tbl in PROTECTED_COLUMNS
        ]
        single_protected_table = (
            referenced_protected_tables[0]
            if len(set(referenced_protected_tables)) == 1
            else None
        )

        seen_violations = set()
        for tbl_alias, col_name in cols:
            # 通过 alias 映射到受保护表
            resolved_table: Optional[str] = None
            if tbl_alias and tbl_alias in alias_to_table:
                resolved_table = alias_to_table[tbl_alias]
            elif not tbl_alias and single_protected_table:
                # 无 alias 且整 SQL 只 FROM 一个受保护表 → 列归属此表
                resolved_table = single_protected_table

            if not resolved_table or resolved_table not in PROTECTED_COLUMNS:
                continue
            if col_name in PROTECTED_COLUMNS[resolved_table]:
                key = (resolved_table, col_name)
                if key in seen_violations:
                    continue
                seen_violations.add(key)
                violations.append(
                    {
                        "type": "protected_column",
                        "table": resolved_table,
                        "column": col_name,
                        "reason": (
                            f"安全限制：禁止查询 {resolved_table}.{col_name}"
                            "（密码/凭据字段，请改选其他列）"
                        ),
                    }
                )

        return violations

    @staticmethod
    def check_protected_tables(sql: str) -> List[Dict[str, Any]]:
        """检查 SQL 是否引用了受保护的表或 schema。

        返回违例列表，每项形如::
            {"type": "protected_table", "table": "users", "reason": "..."}
            {"type": "protected_schema", "schema": "pg_catalog", "table": "pg_class"}
        空列表表示无违例。

        细化策略：
          - pg_catalog.* / pg_前缀 schema.* → 全拒绝（含口令哈希风险）
          - information_schema.* → 仅 SAFE_INFORMATION_SCHEMA_VIEWS 白名单放行，
            其他视图（role_table_grants/enabled_roles 等）仍拒绝
          - PROTECTED_TABLES（用户信息表）→ 完全拒绝
        """
        if not sql:
            return []

        violations: List[Dict[str, Any]] = []
        refs = SQLSecurityChecker.extract_referenced_tables(sql)

        for schema, table in refs:
            # 1. pg_catalog / pg_前缀 schema：整体拒绝
            if schema and (
                schema in PROTECTED_SCHEMAS or schema.startswith("pg_")
            ):
                violations.append(
                    {
                        "type": "protected_schema",
                        "schema": schema,
                        "table": table,
                        "reason": (
                            f"安全限制：禁止查询系统目录 schema '{schema}'"
                            f"（表 {schema}.{table}，含敏感权限/口令视图）"
                        ),
                    }
                )
                continue

            # 2. information_schema：按视图白名单放行结构性元数据
            if schema == "information_schema":
                if table not in SAFE_INFORMATION_SCHEMA_VIEWS:
                    violations.append(
                        {
                            "type": "protected_schema",
                            "schema": schema,
                            "table": table,
                            "reason": (
                                f"安全限制：information_schema.{table} 不在元数据"
                                f"白名单中（仅允许 tables/columns/views 等结构性视图，"
                                f"权限/角色相关视图禁止查询）"
                            ),
                        }
                    )
                # 白名单内视图 → 不报违例，继续下一引用
                continue

            # 3. 显式访问 i-Core 应用自身用户信息表
            #    若 schema 已显式（如 public.users）仍按表名命中
            if table in PROTECTED_TABLES:
                violations.append(
                    {
                        "type": "protected_table",
                        "schema": schema,
                        "table": table,
                        "reason": (
                            f"安全限制：禁止查询用户信息表 '{table}'"
                            "（含用户身份/凭据/隐私数据）"
                        ),
                    }
                )

        return violations


def validate_sql_security(sql: str) -> Tuple[bool, str]:
    result = SQLSecurityChecker.check(sql)
    return result["safe"], result["reason"]


class DatabaseConnection:
    def __init__(
        self,
        host: Optional[str] = None,
        port: Optional[int] = None,
        database: Optional[str] = None,
        user: Optional[str] = None,
        password: Optional[str] = None,
    ):
        # SQL Agent 使用独立的数据库连接参数，与业务库（DB_*）隔离。
        # 连接参数延迟到 connect() 时解析：显式传参优先，
        # 其次读业务库 agent_db_settings 表（按 database 匹配库名），
        # 表无匹配行时回退环境变量 AGENT_DB_*（含 _ENC 加密值）。
        self.host = host
        self.port = port
        self.database = database
        self.user = user
        self.password = password
        self._settings_resolved = False

        self.engine = None
        self.session_factory: Optional[async_sessionmaker[AsyncSession]] = None
        self._is_connected = False
        self._sql_database: Optional[SQLDatabase] = None

    async def _resolve_settings(self):
        """解析最终连接参数：从 agent_db_settings 表读取。"""
        if self._settings_resolved:
            return

        explicit_all = all(
            [
                bool(self.host),
                bool(self.port),
                bool(self.database),
                bool(self.user),
                self.password is not None,
            ]
        )
        if not explicit_all:
            from x_models.id_x_010.src.views.x_views import get_agent_db_settings

            row = await get_agent_db_settings(self.database)
            if row is not None:
                self.host = self.host or row.db_host
                self.port = self.port or int(row.db_port)
                self.database = row.db_name
                self.user = self.user or row.db_username
                self.password = self.password or row.db_password
                logger.info(
                    f"{get_request_id()}SQLAgent 目标库配置来源: agent_db_settings 表 "
                    f"(db_name={row.db_name}, host={row.db_host}:{row.db_port})"
                )
            else:
                logger.error(
                    f"{get_request_id()}SQLAgent 目标库配置缺失: "
                    f"agent_db_settings 表无数据 (db_name={self.database})"
                )
        else:
            logger.info(
                f"{get_request_id()}SQLAgent 目标库配置来源: 显式传参 "
                f"(db_name={self.database})"
            )

        self._settings_resolved = True

    async def connect(self):
        if self._is_connected:
            return

        await self._resolve_settings()

        try:
            encoded_password = quote_plus(self.password)
            db_url = (
                f"postgresql+asyncpg://{self.user}:{encoded_password}"
                f"@{self.host}:{self.port}/{self.database}"
            )

            self.engine = create_async_engine(
                db_url,
                echo=False,
                pool_size=5,
                max_overflow=10,
                pool_pre_ping=True,
            )

            self.session_factory = async_sessionmaker(
                self.engine,
                class_=AsyncSession,
                expire_on_commit=False,
            )

            async with self.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

            sync_db_url = (
                f"postgresql://{self.user}:{encoded_password}"
                f"@{self.host}:{self.port}/{self.database}"
            )

            if LANGCHAIN_COMMUNITY_AVAILABLE:
                assert _SQLDatabase is not None
                self._sql_database = _SQLDatabase.from_uri(
                    sync_db_url,
                    include_tables=[],
                    sample_rows_in_table_info=3,
                )

            self._is_connected = True
            logger.info(
                f"{get_request_id()}SQLAgent 数据库连接成功: {self.host}:{self.port}/{self.database}"
            )

        except Exception as e:
            logger.error(f"{get_request_id()}数据库连接失败: {e}", exc_info=True)
            raise ConnectionError(f"无法连接到数据库: {e}")

    async def disconnect(self):
        if self.engine:
            await self.engine.dispose()
            self._is_connected = False
            self._sql_database = None
            logger.info(f"{get_request_id()}SQLAgent 数据库连接已断开")

    async def get_session(self) -> AsyncSession:
        if not self._is_connected:
            await self.connect()
        assert self.session_factory is not None
        return self.session_factory()

    def get_sql_database(self) -> Optional[SQLDatabase]:
        return self._sql_database

    async def execute_query(
        self,
        sql: str,
        internal: bool = False,
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """执行 SQL 查询。

        Args:
            sql: 待执行的 SQL（必须为 SELECT）
            internal: True 表示此调用源自 SQL Agent 自身内省（list_tables /
                get_schema_info 查 information_schema），跳过受保护表检查
                以避免规则反噬；SELECT-only / 危险词检查仍然强制。LLM 生成的
                查询走默认 False 分支，必须通过完整安全检查。
        """
        if not self._is_connected:
            await self.connect()

        security_result = SQLSecurityChecker.check(sql, skip_protected=internal)
        if not security_result["safe"]:
            logger.warning(
                f"{get_request_id()}SQL 安全检查未通过: {security_result['reason']}"
            )
            raise ValueError(security_result["reason"])

        if not SQLSecurityChecker.is_select(sql):
            raise ValueError("安全限制：只允许执行 SELECT 查询语句")

        try:
            session = await self.get_session()
            async with session:
                # ReadOnly 防御：在事务起点将当前事务设为只读，
                # DB 层兜底——即使 LLM 绕过应用层检查构造了写入/修改语句，
                # PostgreSQL 也会以 "cannot execute ... in a read-only transaction" 拒绝。
                # 失败时不阻塞主链路（部分老版本/部分驱动可能不支持的边界），
                # 仅记录告警——应用层 SELECT-only 检查已构成第一道防线。
                try:
                    await session.execute(text("SET TRANSACTION READ ONLY"))
                except Exception as ro_err:
                    logger.warning(
                        f"{get_request_id()}SET TRANSACTION READ ONLY 失败（已降级为"
                        f"应用层 SELECT 检查）: {type(ro_err).__name__}: {ro_err}"
                    )

                result = cast(CursorResult, await session.execute(text(sql)))
                columns = list(result.keys()) if result.returns_rows else []
                rows = []
                if result.returns_rows:
                    for row in result:
                        row_dict = {}
                        for i, col in enumerate(columns):
                            value = row[i]
                            if hasattr(value, "isoformat"):
                                value = value.isoformat()
                            row_dict[col] = value
                        rows.append(row_dict)

                logger.info(
                    f"{get_request_id()}SQL 执行成功(ReadOnly): {sql[:100]}... 返回 {len(rows)} 行"
                )
                return rows, columns

        except Exception as e:
            logger.error(f"{get_request_id()}SQL 执行失败: {e}\nSQL: {sql}")
            raise RuntimeError(f"SQL 执行错误: {e}")

    async def get_table_names(self) -> List[str]:
        schema_sql = """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        ORDER BY table_name;
        """
        try:
            # internal=True：跳过受保护 schema 检查，让 information_schema 自身可读
            rows, _ = await self.execute_query(schema_sql, internal=True)
            names = [row.get("table_name", "") for row in rows]
            # 屏蔽受保护表：LLM 在 list_tables 阶段就看不到这些表，
            # 减少生成针对性 SELECT 的概率（与 SQLSecurityChecker 形成双保险）
            filtered = [
                n for n in names
                if n and n.lower() not in PROTECTED_TABLES
            ]
            hidden = len(names) - len(filtered)
            if hidden > 0:
                logger.info(
                    f"{get_request_id()}已屏蔽 {hidden} 个受保护表对 LLM 可见"
                )
            return filtered
        except Exception as e:
            logger.error(f"{get_request_id()}获取表名失败: {e}", exc_info=True)
            return []

    async def get_schema_info(self, table_names: Optional[List[str]] = None) -> str:
        # 入参过滤：LLM 若尝试 sql_db_schema("users,orders") 取表结构，
        # 受保护表名会被剔除——既不返回列信息也不暴露受保护表存在与否
        if table_names:
            requested = [
                t for t in table_names
                if t and t.strip().lower() not in PROTECTED_TABLES
            ]
            if not requested:
                # 全部入参都被屏蔽——直接返回空，避免构造 IN('') 这种意外 SQL
                return "无可查询的表结构（请求的表受保护或不存在）"
            names_str = ",".join(f"'{t}'" for t in requested)
            table_filter = f"AND table_name IN ({names_str})"
        else:
            table_filter = ""

        schema_sql = f"""
        SELECT
            table_name,
            column_name,
            data_type,
            is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        {table_filter}
        ORDER BY table_name, ordinal_position;
        """

        try:
            # internal=True：跳过受保护 schema 检查，允许查 information_schema.columns
            rows, _ = await self.execute_query(schema_sql, internal=True)
            tables: Dict[str, List[Dict]] = {}
            for row in rows:
                table_name = row.get("table_name", "")
                # 出参过滤：table_names=None 全表场景下，剔除受保护表
                if table_name.lower() in PROTECTED_TABLES:
                    continue
                col_name = row.get("column_name", "")
                # 列级遮蔽：从 schema 描述里隐藏 users.password_hash 等敏感列，
                # LLM 拿不到列名 → 不会去生成针对该列的 SELECT
                if (
                    table_name.lower() in PROTECTED_COLUMNS
                    and col_name.lower() in PROTECTED_COLUMNS[table_name.lower()]
                ):
                    continue
                if table_name not in tables:
                    tables[table_name] = []
                tables[table_name].append(
                    {
                        "column_name": col_name,
                        "data_type": row.get("data_type"),
                        "is_nullable": row.get("is_nullable"),
                    }
                )

            schema_info = []
            for table_name, columns in tables.items():
                schema_info.append(f"\n表名: {table_name}")
                for col in columns:
                    nullable = "可空" if col["is_nullable"] == "YES" else "非空"
                    schema_info.append(
                        f"  - {col['column_name']} ({col['data_type']}, {nullable})"
                    )

            return "\n".join(schema_info)

        except Exception as e:
            logger.error(f"{get_request_id()}获取表结构失败: {e}", exc_info=True)
            return "无法获取表结构信息"


class SQLAgent:
    EXTERNAL_MODELS = {
        "gpt-4o": "openai/gpt-4o",
        "gpt-4o-mini": "openai/gpt-4o-mini",
        "claude-3.5-sonnet": "anthropic/claude-3.5-sonnet",
        "deepseek-chat": "deepseek/deepseek-chat",
    }

    def __init__(
        self,
        model_type: str = "external",
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        db_host: Optional[str] = None,
        db_port: Optional[int] = None,
        db_name: Optional[str] = None,
        db_user: Optional[str] = None,
        db_password: Optional[str] = None,
        top_k: int = 10,
    ):
        self.model_type = model_type
        self.top_k = top_k
        # 记录目标库名供 retriever / indexer 等内部模块使用（与 db.database 区分：
        # db.database 可能在 connect() 内被 agent_db_settings 行覆盖）
        self.db_name = db_name

        external_config = get_external_model_config()

        self.model_name = (
            model_name
            or external_config.get("model_name")
            or os.getenv("EXTERNAL_LLM_MODEL")
            or DEFAULT_EXTERNAL_MODEL
        )
        self.api_key = (
            api_key or external_config.get("api_key")
        )
        self.base_url = (
            base_url
            or external_config.get("base_url")
        )

        self.llm = self._create_llm()

        # 本轮 token 用量累加器：SQL 链路有多次独立 LLM 调用（意图/生成/
        # 校验/含义/解读/图表），逐次累加后随 done chunk 下发，供气泡
        # meta 展示与 usage_logs 计费。每次请求新建 SQLAgent 实例，天然按轮隔离。
        self._usage = {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}

        self.db = DatabaseConnection(
            host=db_host,
            port=db_port,
            database=db_name,
            user=db_user,
            password=db_password,
        )

        self._tools: List[Any] = []
        self._toolkit: Optional[SQLDatabaseToolkit] = None
        self._graph: Optional[CompiledStateGraph] = None
        self._schema_cache: Optional[str] = None
        # 模型是否支持强制工具调用（tool_choice="any"）：None=未探测，
        # False=不支持（部分中转网关/Anthropic 系模型仅支持 auto，强制会报 400）
        self._supports_forced_tool_choice: Optional[bool] = None

        logger.info(
            f"{get_request_id()}SQLAgent 初始化完成: model={self.model_name}, db_name={self.db_name}"
        )

    def _create_llm(self) -> ChatOpenAI:
        model_identifier = self.EXTERNAL_MODELS.get(self.model_name, self.model_name)

        return ChatOpenAI(
            model=model_identifier,
            api_key=SecretStr(self.api_key) if self.api_key else None,
            base_url=self.base_url,
            temperature=0.1,
            streaming=True,
            # 让 astream 末块携带 usage_metadata（转换为 stream_options.include_usage），
            # 否则 _stream_explanation 的流式解读永远统计不到 token
            stream_usage=True,
        )

    def _track_usage(self, response: Any) -> None:
        """累加单次 LLM 响应的 token 用量（best-effort，缺 usage_metadata 时静默跳过）。"""
        try:
            meta = getattr(response, "usage_metadata", None)
            if isinstance(meta, dict):
                self._usage["input_tokens"] += int(meta.get("input_tokens", 0) or 0)
                self._usage["output_tokens"] += int(meta.get("output_tokens", 0) or 0)
                self._usage["total_tokens"] += int(meta.get("total_tokens", 0) or 0)
        except Exception:  # pragma: no cover - 统计不影响主链路
            pass

    def _usage_snapshot(self) -> Optional[Dict[str, int]]:
        """当前累计用量快照；全 0（未获得任何 usage）时返回 None 不下发。"""
        if (
            self._usage["input_tokens"]
            or self._usage["output_tokens"]
            or self._usage["total_tokens"]
        ):
            return dict(self._usage)
        return None

    async def _initialize_tools(self):
        if self._tools:
            return

        await self.db.connect()

        sql_database = self.db.get_sql_database()
        if LANGCHAIN_COMMUNITY_AVAILABLE and sql_database:
            assert _SQLDatabaseToolkit is not None
            self._toolkit = _SQLDatabaseToolkit(
                db=sql_database,
                llm=self.llm,
            )
            self._tools = self._toolkit.get_tools()
        else:
            self._tools = self._create_custom_tools()

    def _create_custom_tools(self) -> List[Any]:
        from langchain_core.tools import tool

        @tool
        def sql_db_list_tables() -> str:
            """获取数据库中所有表的名称列表"""
            import asyncio

            tables = asyncio.get_event_loop().run_until_complete(
                self.db.get_table_names()
            )
            return ", ".join(tables)

        @tool
        def sql_db_schema(table_names: str) -> str:
            """获取指定表的表结构信息（列名、类型等）"""
            import asyncio

            tables = [t.strip() for t in table_names.split(",")]
            schema = asyncio.get_event_loop().run_until_complete(
                self.db.get_schema_info(tables)
            )
            return schema

        @tool
        def sql_db_query(query: str) -> str:
            """执行 SQL 查询并返回结果（最多 10 行）"""
            import asyncio

            try:
                rows, columns = asyncio.get_event_loop().run_until_complete(
                    self.db.execute_query(query)
                )
                if not rows:
                    return "查询结果为空"
                result_lines = [", ".join(columns)]
                for row in rows[:10]:
                    result_lines.append(", ".join(str(v) for v in row.values()))
                if len(rows) > 10:
                    result_lines.append(f"... 还有 {len(rows) - 10} 行")
                return "\n".join(result_lines)
            except Exception as e:
                return f"查询错误: {str(e)}"

        @tool
        def sql_db_query_checker(query: str) -> str:
            """检查 SQL 查询是否安全，防止危险操作"""
            safe, reason = validate_sql_security(query)
            if not safe:
                return f"查询不安全: {reason}"
            return query

        return [sql_db_list_tables, sql_db_schema, sql_db_query, sql_db_query_checker]

    def _build_graph(self):
        builder = StateGraph(SQLAgentState)

        builder.add_node("list_tables", self._list_tables_node)
        builder.add_node("call_get_schema", self._call_get_schema_node)
        builder.add_node("get_schema", self._get_schema_node)
        builder.add_node("analyze_intent", self._analyze_intent_node)
        builder.add_node("generate_query", self._generate_query_node)
        builder.add_node("check_query", self._check_query_node)
        builder.add_node("human_approval", self._human_approval_node)
        builder.add_node("run_query", self._run_query_node)

        builder.add_edge(START, "list_tables")
        builder.add_edge("list_tables", "call_get_schema")
        builder.add_edge("call_get_schema", "get_schema")
        # 在拿到 schema 后、生成 SQL 之前插入意图识别节点，
        # 让后续 SQL 生成能按意图塑形（trend→ORDER BY time, ranking→LIMIT 等）
        builder.add_edge("get_schema", "analyze_intent")
        builder.add_edge("analyze_intent", "generate_query")
        builder.add_conditional_edges(
            "generate_query",
            self._should_continue,
        )
        # check_query 之后按 auto_execute 决策：自动执行模式直接 run_query，
        # 否则进入 human_approval 等待用户审批
        builder.add_conditional_edges(
            "check_query",
            self._post_check_router,
        )
        builder.add_conditional_edges(
            "human_approval",
            self._approval_router,
        )
        builder.add_edge("run_query", END)

        self._graph = builder.compile()
        return self._graph

    async def _list_tables_node(self, state: SQLAgentState) -> Dict[str, Any]:
        await self._initialize_tools()
        tables = await self.db.get_table_names()

        tool_call = {
            "name": "sql_db_list_tables",
            "args": {},
            "id": "list_tables_call",
            "type": "tool_call",
        }
        tool_call_message = AIMessage(content="", tool_calls=[tool_call])
        # tool_call 必须有配对的 ToolMessage，否则严格网关（Anthropic 系）
        # 会拒绝后续携带该历史的请求
        tool_response_message = ToolMessage(
            content=f"可用表: {', '.join(tables)}",
            tool_call_id="list_tables_call",
        )

        response_message = AIMessage(f"可用表: {', '.join(tables)}")

        return {
            "tables": tables,
            "messages": [tool_call_message, tool_response_message, response_message],
        }

    @staticmethod
    def _is_tool_choice_error(err: Exception) -> bool:
        # 中转网关对不支持的 tool_choice 类型返回 400，错误文本形如：
        # tool_choice: type "tool" and "any" are not supported for this model
        return "tool_choice" in str(err).lower()

    async def _call_get_schema_node(self, state: SQLAgentState) -> Dict[str, Any]:
        question = state.get(
            "question", state["messages"][-1].content if state["messages"] else ""
        )

        get_schema_tool = next(
            (t for t in self._tools if t.name == "sql_db_schema"), None
        )

        if get_schema_tool:
            prompt = f"用户问题: {question}\n\n请确定需要查询哪些表的 schema。"
            messages = [
                SystemMessage(
                    content="你是数据库专家，需要确定哪些表与用户问题相关。"
                ),
                HumanMessage(content=prompt),
            ]

            # 优先强制调用工具（tool_choice="any"）提高 schema 选表可靠性；
            # 若模型/网关不支持强制模式（报 400）则回退 auto，并记住结果
            # 避免同一实例后续请求重复撞 400。未发起 tool call 的情况
            # 由 _get_schema_node 的向量召回/全 schema 兑底逻辑兼容。
            if self._supports_forced_tool_choice is not False:
                try:
                    llm_with_tools = self.llm.bind_tools(
                        [get_schema_tool], tool_choice="any"
                    )
                    response = await llm_with_tools.ainvoke(messages)
                    self._track_usage(response)
                    self._supports_forced_tool_choice = True
                    return {"messages": [response]}
                except Exception as e:
                    if not self._is_tool_choice_error(e):
                        raise
                    self._supports_forced_tool_choice = False
                    logger.info(
                        f"{get_request_id()}模型不支持 tool_choice=any，"
                        f"回退 auto 模式: {type(e).__name__}: {e}"
                    )

            llm_with_tools = self.llm.bind_tools([get_schema_tool])
            response = await llm_with_tools.ainvoke(messages)
            self._track_usage(response)
            return {"messages": [response]}

        schema = await self.db.get_schema_info()
        return {"messages": [AIMessage(content=f"数据库结构:\n{schema[:500]}...")]}

    async def _get_schema_node(self, state: SQLAgentState) -> Dict[str, Any]:
        last_message = state["messages"][-1]

        if isinstance(last_message, AIMessage) and last_message.tool_calls:
            tool_call = last_message.tool_calls[0]
            table_names = tool_call.get("args", {}).get("table_names", "")
            tables = [t.strip() for t in table_names.split(",") if t.strip()]
            schema = await self.db.get_schema_info(tables)
            return {
                "messages": [ToolMessage(content=schema, tool_call_id=tool_call["id"])]
            }

        # 优先按用户问题向量化召回 top-5 相关表 schema；table_comments 无数据或
        # 检索失败时 retrieve 内部已降级返回空列表，再走全 schema 缓存。
        question = state.get("question", "") or (
            last_message.content if isinstance(last_message, HumanMessage) else ""
        )
        if not self._schema_cache:
            # 仅在缓存空时构建一次；构建时尝试 retrieve 精简后续 prompt
            try:
                schema_text = await self._load_relevant_schema(question)
                # retrieve 返回的可能不是"全 schema"，缓存它会让后续同会话
                # 不同问题的请求错失新召回——所以此处只缓存全 schema 兜底，
                # retrieve 结果直接给本次用，不污染缓存
                self._schema_cache = await self.db.get_schema_info()
                return {"messages": [AIMessage(content=schema_text)]}
            except Exception as e:
                logger.warning(
                    f"{get_request_id()}_get_schema_node retrieve 失败,回退全 schema: "
                    f"{type(e).__name__}: {e}"
                )
                self._schema_cache = await self.db.get_schema_info()
        return {"messages": [AIMessage(content=self._schema_cache)]}

    async def _load_relevant_schema(self, question: str) -> str:
        """按用户问题向量化召回 top-5 相关表的 schema。

        本方法是 SQL Agent 内部优化，不构成 Agent 联动：
        - 仅在 SQLAgent 自身 _get_schema_node 调用；
        - retrieve_relevant_tables 已经 try/except 完全部降级；
        - 召回为空（如 table_comments 表未建索引）则回退全 schema 缓存，行为等同改造前。
        """
        if not question:
            return await self.db.get_schema_info()
        try:
            from x_models.id_x_010.src.agents.x_retriever_agent import (
                retrieve_relevant_tables,
            )

            relevant = await retrieve_relevant_tables(
                question, self.db_name, top_k=5
            )
        except Exception as e:
            logger.warning(
                f"{get_request_id()}_load_relevant_schema 检索失败,降级全 schema: "
                f"{type(e).__name__}: {e}"
            )
            relevant = []

        if not relevant:
            # table_comments 表为空 / 检索全部失败 → 回退原始全 schema
            return await self.db.get_schema_info()

        table_names: List[str] = [
            t["table_name"]
            for t in relevant
            if isinstance(t, dict) and t.get("table_name")
        ]
        if not table_names:
            return await self.db.get_schema_info()

        schema = await self.db.get_schema_info(table_names=table_names)
        # 召回被 PROTECTED_TABLES 全过滤掉时退回全 schema，避免 prompt 拿到空 schema
        if not schema or schema.startswith("无可查询"):
            return await self.db.get_schema_info()
        return schema

    async def _analyze_intent_node(self, state: SQLAgentState) -> Dict[str, Any]:
        """前置意图识别节点：在生成 SQL 之前判定用户的核心分析意图。

        返回 state.analysis_intent（dict），后续 _generate_query_node 据此塑形 SQL，
        _generate_chart_config 也会复用此意图（避免重复 LLM 调用）。
        失败时返回空 intent，链路继续——SQL 生成仍能完成，只是不按意图优化。
        """
        question = state.get("question", "")
        if not question:
            return {"analysis_intent": None}

        # 拿到 schema 信息（上一节点已写入 messages 中的 ToolMessage/AIMessage）
        schema_info = ""
        if state.get("messages"):
            last = state["messages"][-1]
            schema_info = self._content_to_str(
                last.content if hasattr(last, "content") else ""
            )
        # 截断避免 token 浪费
        schema_info = (schema_info or "")[:2000]

        prompt = INTENT_ANALYSIS_PROMPT.format(
            question=question,
            schema_info=schema_info or "（schema 信息不可用）",
        )

        try:
            response = await self.llm.ainvoke(
                [
                    SystemMessage(content=INTENT_ANALYSIS_SYSTEM),
                    HumanMessage(content=prompt),
                ]
            )
            self._track_usage(response)
            raw = self._content_to_str(response.content).strip()
            # 兼容 ```json ... ``` 包裹
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0].strip()
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0].strip()

            import json as _json

            intent_data = _json.loads(raw)
            # 字段规范化 + 合法性校验
            intent = (intent_data.get("intent") or "").strip().lower()
            if intent not in {
                "trend", "comparison", "distribution", "ranking",
                "correlation", "lookup", "detail", "aggregate", "schema",
            }:
                intent = "detail"
            suggest_chart = (intent_data.get("suggest_chart") or "").strip().lower()
            if suggest_chart not in {"bar", "line", "area", "pie", "scatter", "none"}:
                suggest_chart = "none"

            normalized = {
                "intent": intent,
                "reason": (intent_data.get("reason") or "").strip(),
                "suggest_chart": suggest_chart,
            }
            logger.info(
                f"{get_request_id()}[前置意图识别] intent={intent}, "
                f"suggest_chart={suggest_chart}, reason={normalized['reason'][:60]}"
            )
            return {"analysis_intent": normalized}
        except Exception as e:
            logger.warning(
                f"{get_request_id()}前置意图识别失败（非致命，按默认 detail 处理）: "
                f"{type(e).__name__}: {e}"
            )
            return {"analysis_intent": None}

    @staticmethod
    def _intent_to_sql_guidance(intent: Optional[Dict[str, str]]) -> str:
        """把识别出的意图翻译为对 SQL 生成的具体塑形指导。"""
        if not intent:
            return "（意图识别未完成，按通用规则生成）"
        it = intent.get("intent", "detail")
        guidance_map = {
            "trend": "TREND 意图：必须 ORDER BY 时间列 ASC；返回时间序列行（不要聚合到单值）；优先返回原始时序点",
            "comparison": "COMPARISON 意图：必须 GROUP BY 类别列；SELECT 类别列 + 多个聚合指标（COUNT/SUM/AVG）；类别数控制在 30 以内",
            "distribution": "DISTRIBUTION 意图：必须 GROUP BY 类别列 + COUNT(*) 或 SUM(指标)；结果用于占比可视化",
            "ranking": "RANKING 意图：必须 ORDER BY 主要数值列 DESC + LIMIT；返回 Top N 行",
            "correlation": "CORRELATION 意图：返回两个数值列的原始行（不要 GROUP BY）；行数 ≥ 20 最佳",
            "aggregate": "AGGREGATE 意图：返回单一聚合值或少量汇总行",
            "lookup": "LOOKUP 意图：返回单实体的指定字段；WHERE 用主键或唯一键",
            "detail": "DETAIL 意图：返回多列明细行；按主键或相关性排序",
            "schema": "SCHEMA 意图：查 information_schema 元数据；不要查业务数据",
        }
        return guidance_map.get(it, guidance_map["detail"])

    async def _generate_query_node(self, state: SQLAgentState) -> Dict[str, Any]:
        question = state.get("question", "")
        if not question and state["messages"]:
            for msg in reversed(state["messages"]):
                if isinstance(msg, HumanMessage):
                    question = msg.content
                    break

        # 注入前置意图识别结果，让 LLM 按意图塑形 SQL
        intent = state.get("analysis_intent")
        intent_guidance = self._intent_to_sql_guidance(intent)

        # TASK-018：优先从 PromptTemplate 表加载（admin 可热改），失败回退硬编码。
        # load_prompt 失败不阻塞主流程，prompt 完整性由 GENERATE_QUERY_SYSTEM_PROMPT 保证。
        system_prompt: str = ""
        try:
            from x_models.id_x_010.src.utils.x_prompts import load_prompt

            system_prompt = await load_prompt(
                "sql.generate_query",
                top_k=self.top_k,
                intent_guidance=intent_guidance,
            )
        except Exception as e:
            logger.warning(
                f"{get_request_id()}load_prompt(sql.generate_query) 失败,"
                f"用硬编码 prompt: {type(e).__name__}: {e}"
            )
        if not system_prompt:
            system_prompt = GENERATE_QUERY_SYSTEM_PROMPT.format(
                top_k=self.top_k,
                intent_guidance=intent_guidance,
            )

        # TASK-009：向 system_prompt 末尾追加 Few-Shot 例子段。
        # retrieve_examples 失败时返回空列表，prompt 不会被破坏；db_name
        # 为 None 时不召回（SQL Agent 内部决策，不引入跨 Agent 调用）
        if self.db_name and question:
            try:
                from x_models.id_x_010.src.utils.x_fewshot import retrieve_examples

                examples = await retrieve_examples(
                    question, self.db_name, top_k=3
                )
                if examples:
                    few_shot_lines = ["", "# 类似问题参考"]
                    for ex in examples:
                        few_shot_lines.append(f"Q: {ex.get('question', '')}")
                        few_shot_lines.append(f"SQL: {ex.get('sql', '')}")
                        if ex.get("explanation"):
                            few_shot_lines.append(f"说明: {ex['explanation']}")
                        few_shot_lines.append("")
                    system_prompt = system_prompt + "\n" + "\n".join(
                        few_shot_lines
                    )
            except Exception as e:
                logger.warning(
                    f"{get_request_id()}Few-Shot 召回失败（非致命）: "
                    f"{type(e).__name__}: {e}"
                )

        run_query_tool = next(
            (t for t in self._tools if t.name == "sql_db_query"), None
        )

        if run_query_tool:
            llm_with_tools = self.llm.bind_tools([run_query_tool])
        else:
            llm_with_tools = self.llm

        # 历史末尾可能是 AIMessage（如 schema 兑底内容），Anthropic 系网关
        # 要求对话必须以 user 消息结尾，否则报
        # "does not support assistant message prefill" 400 —— 补一条引导消息
        gen_messages: List[Any] = [
            SystemMessage(content=system_prompt),
            *state["messages"],
        ]
        if not isinstance(gen_messages[-1], HumanMessage):
            gen_messages.append(
                HumanMessage(
                    content="请根据以上表结构信息，为我的问题生成 SQL 查询。"
                )
            )

        response = await llm_with_tools.ainvoke(gen_messages)
        self._track_usage(response)

        sql = ""
        natural_answer = ""
        if isinstance(response, AIMessage) and response.tool_calls:
            sql = response.tool_calls[0].get("args", {}).get("query", "")
        elif response.content:
            content_str = self._content_to_str(response.content)
            sql = self._extract_sql(content_str)
            # 若 _extract_sql 返回空，说明 LLM 给的是自然语言回答而非 SQL
            # （schema 召回为空、问题无法用 SQL 表达、用户问的是元数据等场景）。
            # 把 content 直接当 answer，跳过 execute / explain 节点，直接 END。
            if not sql and content_str.strip():
                natural_answer = content_str.strip()
                logger.info(
                    f"{get_request_id()}LLM 未生成 SQL，"
                    f"以自然语言直接回答（schema 召回为空或问题不适合 SQL）: "
                    f"answer='{natural_answer[:80]}...'"
                )

        # 生成 SQL 的自然语言含义（一句话），供前端在审批面板展示
        sql_meaning = await self._generate_sql_meaning(question, sql)

        # 当 LLM 给出自然语言回答时，把 answer 写入 state 供 _post_check_router
        # 直接走 END 路径（见 _post_check_router 的 answer 非空分支）
        return {
            "sql": sql,
            "sql_meaning": sql_meaning,
            "messages": [response],
            **({"answer": natural_answer} if natural_answer else {}),
        }

    async def _check_query_node(self, state: SQLAgentState) -> Dict[str, Any]:
        last_message = state["messages"][-1]

        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            return {"messages": [last_message]}

        tool_call = last_message.tool_calls[0]
        sql = tool_call.get("args", {}).get("query", "")

        safe, reason = validate_sql_security(sql)
        if not safe:
            return {
                "error": reason,
                "messages": [AIMessage(content=f"查询被拒绝: {reason}")],
            }

        check_prompt = f"""请检查以下 SQL 查询是否有语法错误或逻辑问题：

{sql}

如果 SQL 没有问题，请回复'SQL检查通过'。
如果有问题，请说明问题并给出修正后的 SQL。"""

        # 非致命：检查环节的 LLM 调用可能撞上网关间歇性 503（负载均衡
        # 部分通道不可用）。此时沿用原 SQL 继续链路，而不是让整条流崩掉。
        try:
            response = await self.llm.ainvoke(
                [
                    SystemMessage(content="你是 SQL 专家，负责检查 SQL 查询的正确性。"),
                    HumanMessage(content=check_prompt),
                ]
            )
            self._track_usage(response)
        except Exception as e:
            logger.warning(
                f"{get_request_id()}SQL 检查 LLM 调用失败（非致命，沿用原 SQL）: "
                f"{type(e).__name__}: {e}"
            )
            return {"sql": sql, "messages": [last_message]}

        response_content = self._content_to_str(response.content)

        if "SQL检查通过" in response_content or "检查通过" in response_content:
            corrected_sql = sql
        else:
            corrected_sql = self._extract_sql(response_content) or sql

        response.id = last_message.id

        return {"sql": corrected_sql, "messages": [response]}

    async def _human_approval_node(self, state: SQLAgentState) -> Dict[str, Any]:
        sql = state.get("sql", "")
        return {
            "pending_sql": sql,
            "sql_meaning": state.get("sql_meaning", ""),
            "approval_status": "pending",
        }

    def _approval_router(
        self, state: SQLAgentState
    ) -> Literal["run_query", "generate_query", "__end__"]:
        approval_status = state.get("approval_status", "")
        if approval_status == "approved":
            return "run_query"
        elif approval_status == "rejected":
            return "generate_query"
        elif approval_status == "cancelled":
            return "__end__"
        return "__end__"

    async def _run_query_node(self, state: SQLAgentState) -> Dict[str, Any]:
        sql = state.get("sql", "")

        if not sql:
            return {"error": "没有可执行的 SQL 查询"}

        try:
            rows, columns = await self.db.execute_query(sql)
            return {
                "result": rows,
                "columns": columns,
                "messages": [AIMessage(content=f"查询成功，返回 {len(rows)} 行数据")],
            }
        except Exception as e:
            error_msg = str(e)
            return {
                "error": error_msg,
                "messages": [AIMessage(content=f"查询错误: {error_msg}")],
            }

    def _should_continue(
        self, state: SQLAgentState
    ) -> Literal["check_query", "__end__"]:
        # 安全失败/无 SQL（含 LLM 拒答）则结束，不再走 check_query / approval / run_query。
        # 注意：不依赖 tool_calls 判定——LLM 以纯文本回吐 SQL 时 _extract_sql 也能解析出 sql，
        # 这种情形同样需要继续走 check_query -> (run_query|human_approval) 链路。
        if state.get("error"):
            return "__end__"

        sql = (state.get("sql") or "").strip()
        if not sql:
            return "__end__"

        return "check_query"

    def _post_check_router(
        self, state: SQLAgentState
    ) -> Literal["run_query", "human_approval", "__end__"]:
        """check_query 之后路由。

        - 校验失败/有 error：结束
        - **LLM 给出自然语言回答（answer 非空且 sql 为空）**：直接结束，
          把 answer 作为最终响应返回，不走 run_query/exec
          （适用：schema 召回为空、问题不适合 SQL、用户问元数据 LLM 直接答）
        - auto_execute=True：直接 run_query（在 stream_query 中由调用方注入）
        - auto_execute=False：进入 human_approval 等待审批
        """
        if state.get("error"):
            return "__end__"

        # LLM 未生成 SQL 而是给出自然语言回答 → 直接 END
        if state.get("answer") and not state.get("sql"):
            return "__end__"

        # 没生成 SQL 也没 answer → 无内容，结束
        if not state.get("sql"):
            return "__end__"

        if state.get("auto_execute"):
            return "run_query"

        return "human_approval"

    @staticmethod
    def _content_to_str(content: str | list[str | dict[Any, Any]]) -> str:
        if isinstance(content, str):
            return content
        return "".join(item if isinstance(item, str) else str(item) for item in content)

    async def _generate_sql_meaning(self, question: str, sql: str) -> str:
        """生成 SQL 的自然语言含义（一句话），供前端独立"阐述气泡"展示。

        非致命：失败时返回空串，调用方继续流程。
        """
        if not sql:
            return ""
        try:
            meaning_resp = await self.llm.ainvoke(
                [
                    SystemMessage(content=SQL_MEANING_PROMPT),
                    HumanMessage(
                        content=f"User question: {question}\n\nSQL query:\n{sql}"
                    ),
                ]
            )
            self._track_usage(meaning_resp)
            return self._content_to_str(meaning_resp.content).strip()
        except Exception as e:
            logger.warning(
                f"{get_request_id()}生成 SQL 含义失败（非致命）: {type(e).__name__}: {e}"
            )
            return ""

    def _extract_sql(self, content: str) -> str:
        """从 LLM 输出中抽取 SQL 语句。

        严格策略：识别不到合法 SQL 起手（SELECT/WITH）时返回空串，
        由调用方识别为"LLM 给出的是自然语言解释而非 SQL"，
        把 content 作为 answer 直接返回，避免把"根据数据库查询结果..."
        当成 SQL 送进 SQLSecurityChecker 触发 unknown_keyword 拒绝。

        已知场景：
        - 用户问"数据库里有多少张表"等元数据问题，schema 召回为空时
          LLM 可能直接用自然语言回答，而非生成 SQL。
        - LLM 输出 ```` ```sql ... ``` ```` 包裹的 SQL，正常提取。
        - LLM 输出 "SQL: SELECT ..." / "查询语句：SELECT ..." 等带前缀的 SQL，
          剥前缀后再校验起手。
        """
        if not content:
            return ""

        # 1. 优先匹配 ```sql ... ``` 或 ``` ... ``` 代码块
        code_block_pattern = r"```(?:sql)?\s*([\s\S]*?)\s*```"
        match = re.search(code_block_pattern, content, re.IGNORECASE)
        if match:
            sql_candidate = match.group(1).strip()
            if SQLSecurityChecker._looks_like_sql_start(sql_candidate):
                return sql_candidate
            # 代码块内容不像 SQL（可能是 LLM 解释为什么不生成 SQL），fall through

        # 2. 剥常见前缀
        candidate = content
        prefixes = [
            r"^输出[：:]\s*",
            r"^SQL[：:]\s*",
            r"^SQL语句[：:]\s*",
            r"^查询语句[：:]\s*",
            r"^查询[：:]\s*",
        ]
        for prefix in prefixes:
            candidate = re.sub(prefix, "", candidate, flags=re.IGNORECASE)
        candidate = candidate.strip()

        # 3. 校验起手：必须是 SELECT / WITH 之一才认为是 SQL
        if SQLSecurityChecker._looks_like_sql_start(candidate):
            return candidate

        # 4. 兜底：尝试在原文中找首个 SELECT / WITH 起始的子串
        # （LLM 有时会输出 "我建议执行如下 SQL：\nSELECT ...", 起手不是 SELECT）
        m = re.search(
            r"(?ims)\b(SELECT|WITH)\b.*", content
        )
        if m:
            sql_candidate = m.group(0).strip()
            # 排除明显还在句中的（如 "I will SELECT ..."）—要求前面是换行或行首
            # 简单策略：要求 SELECT/WITH 出现在行首（多行模式）
            m2 = re.search(r"(?ms)^[ \t]*(SELECT|WITH)\b.*", content)
            if m2:
                return m2.group(0).strip()

        # 5. 都不像 SQL：返回空串，调用方据 content 直接作为 answer 返回
        return ""

    async def query(
        self,
        question: str,
        auto_execute: bool = True,
    ) -> Dict[str, Any]:
        result = {
            "success": False,
            "question": question,
            "sql": None,
            "columns": [],
            "data": [],
            "row_count": 0,
            "answer": "",
            "thinking": "",
            "error": None,
        }

        try:
            await self._initialize_tools()

            if not self._graph:
                self._build_graph()

            assert self._graph is not None
            initial_state = {
                "messages": [HumanMessage(content=question)],
                "question": question,
                # 与 stream_query 保持一致：让 _post_check_router 据此决定
                # 自动执行还是进入 human_approval
                "auto_execute": auto_execute,
            }

            final_state = None
            async for step in self._graph.astream(initial_state, stream_mode="values"):
                final_state = step

            if final_state:
                result["sql"] = final_state.get("sql", "")
                result["data"] = final_state.get("result", [])
                result["columns"] = final_state.get("columns", [])
                result["row_count"] = len(result["data"])
                result["error"] = final_state.get("error")

                if result["data"] and not result["error"]:
                    answer = await self._explain_result(
                        question, result["sql"], result["data"]
                    )
                    result["answer"] = answer

                result["success"] = not result["error"]

        except ValueError as e:
            result["error"] = str(e)
            result["answer"] = f"抱歉，出于安全考虑，{str(e)}"
            logger.warning(f"{get_request_id()}SQL 安全限制: {e}")

        except Exception as e:
            result["error"] = str(e)
            result["answer"] = friendly_llm_error(e, self.model_name)
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [sql.query] | model={self.model_name}, "
                f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
            )

        return result

    async def _explain_result(
        self,
        question: str,
        sql: str,
        results: List[Dict[str, Any]],
    ) -> str:
        if not results:
            return "查询结果为空，没有找到相关数据。"

        display_results = results[:20]
        result_str = "\n".join(str(row) for row in display_results)
        if len(results) > 20:
            result_str += f"\n... 还有 {len(results) - 20} 行数据"

        prompt = RESULT_EXPLANATION_PROMPT.format(
            original_question=question,
            sql_query=sql,
            query_result=result_str,
        )

        messages = [
            SystemMessage(content="你是一个数据分析专家，负责解释查询结果。"),
            HumanMessage(content=prompt),
        ]

        try:
            response = await self.llm.ainvoke(messages)
            self._track_usage(response)
        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [sql._explain_result] | model={self.model_name}, "
                f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
            )
            raise

        content = response.content

        if isinstance(content, list):
            content = "".join(
                item if isinstance(item, str) else str(item) for item in content
            )

        if "<thinking>" in content and "</thinking>" in content:
            start = content.find("<thinking>")
            end = content.find("</thinking>") + len("</thinking>")
            content = content[:start] + content[end:]
            content = content.strip()

        return content

    async def stream_query(
        self,
        question: str,
        auto_execute: bool = True,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        # TASK-007：记录 LLM 调用起始时间，done/error 处 observe 延迟
        _started = time.perf_counter()

        yield {
            "type": "start",
            "content": "正在分析您的问题...",
            "model_used": self.model_name,
        }

        try:
            await self._initialize_tools()

            if not self._graph:
                self._build_graph()

            yield {
                "type": "thinking",
                "content": "正在分析数据库结构，准备生成 SQL 查询...",
                "model_used": self.model_name,
            }

            initial_state = {
                "messages": [HumanMessage(content=question)],
                "question": question,
                # 注入 auto_execute 让 _post_check_router 决定是否跳过审批直接执行；
                # 未传时默认 True，保持与 supervisor.stream_process 的语义一致。
                "auto_execute": auto_execute,
            }

            assert self._graph is not None
            sql = ""
            data = []
            columns = []
            error = None
            # 终态判定标记：human_approval 挂起 / 安全拦截时，流在对应分支已
            # 自行收尾（或等待审批续流），结尾不再补发空结果的回答与 done
            approval_requested = False
            security_blocked = False
            # 复用前置节点识别出的意图，传给 _generate_chart_config 避免重复 LLM 调用
            captured_intent: Optional[Dict[str, str]] = None

            async for step in self._graph.astream(initial_state, stream_mode="updates"):
                for node_name, node_output in step.items():
                    if node_name == "list_tables":
                        tables = node_output.get("tables", [])
                        yield {
                            "type": "thinking",
                            "content": f"已获取数据库表信息：发现 {len(tables)} 个表",
                            "model_used": self.model_name,
                        }

                    elif node_name == "get_schema":
                        yield {
                            "type": "thinking",
                            "content": "已获取相关表的 schema 信息",
                            "model_used": self.model_name,
                        }

                    elif node_name == "analyze_intent":
                        intent_data = node_output.get("analysis_intent")
                        if intent_data:
                            captured_intent = intent_data
                            it = intent_data.get("intent", "")
                            reason = intent_data.get("reason", "")
                            suggest = intent_data.get("suggest_chart", "")
                            yield {
                                "type": "thinking",
                                "content": (
                                    f"已识别分析意图：{it}"
                                    + (f"（建议 {suggest} 图）" if suggest and suggest != "none" else "")
                                    + (f" — {reason}" if reason else "")
                                ),
                                "model_used": self.model_name,
                            }
                        else:
                            yield {
                                "type": "thinking",
                                "content": "意图识别未完成，按默认策略生成 SQL",
                                "model_used": self.model_name,
                            }

                    elif node_name == "generate_query":
                        sql = node_output.get("sql", "")
                        natural_answer = node_output.get("answer", "")
                        if sql:
                            sql_meaning = node_output.get("sql_meaning", "")
                            yield {
                                "type": "thinking",
                                "content": f"已生成 SQL 查询：{sql[:100]}{'...' if len(sql) > 100 else ''}",
                                "model_used": self.model_name,
                            }
                            yield {
                                "type": "sql_generated",
                                "content": sql,
                                "sql_meaning": sql_meaning,
                                "model_used": self.model_name,
                            }
                            # TASK-015：sql_generated 路径同样发 sql_explanation
                            # chunk，让前端独立渲染"阐述气泡"
                            if sql_meaning:
                                yield {
                                    "type": "sql_explanation",
                                    "content": sql_meaning,
                                    "sql": sql,
                                    "sql_meaning": sql_meaning,
                                    "model_used": self.model_name,
                                }
                        elif natural_answer:
                            # LLM 给出自然语言回答（未生成 SQL），直接流给前端
                            yield {
                                "type": "thinking",
                                "content": "该问题无需 SQL 查询，直接回答",
                                "model_used": self.model_name,
                            }
                            yield {
                                "type": "content",
                                "content": natural_answer,
                                "model_used": self.model_name,
                            }
                            yield {
                                "type": "done",
                                "sql": "",
                                "answer": natural_answer,
                                "model_used": self.model_name,
                                "usage": self._usage_snapshot(),
                            }
                            _observe_llm(
                                self.model_name, "sql", "success", time.perf_counter() - _started
                            )
                            return

                    elif node_name == "check_query":
                        # check_query 在发现危险 SQL/受保护表时会写 state.error，
                        # 此时路由会跳到 __end__，链路结束。需要：
                        #   1) 给用户一条 thinking 文本反馈（保留在思考区）
                        #   2) 发独立的 security_block chunk 让前端以红色告警渲染
                        #   3) 发 done chunk 关闭前端的 isTyping 状态
                        # —— 否则用户看到告警被埋在灰色 thinking 区，且 loading 不消失
                        check_error = node_output.get("error")
                        if check_error:
                            security_blocked = True
                            yield {
                                "type": "thinking",
                                "content": f"SQL 校验未通过：{check_error}",
                                "model_used": self.model_name,
                            }
                            # 独立 security_block chunk：前端识别 security_block=true
                            # 后以红色告警样式独立渲染（区别于普通 error 用于 LLM 失败）
                            yield {
                                "type": "security_block",
                                "content": check_error,
                                "sql": sql,
                                "security_block": True,
                                "model_used": self.model_name,
                            }
                            # 显式 done 关闭前端 isTyping，避免 loading 永远转下去
                            yield {
                                "type": "done",
                                "sql": sql,
                                "answer": "",
                                "model_used": self.model_name,
                                "usage": self._usage_snapshot(),
                            }
                        else:
                            yield {
                                "type": "thinking",
                                "content": "已验证 SQL 查询的正确性",
                                "model_used": self.model_name,
                            }

                    elif node_name == "human_approval":
                        # 仅在自动执行关闭时会到达此分支
                        pending_sql = node_output.get("pending_sql", "")
                        approval_status = node_output.get("approval_status", "")
                        sql_meaning = node_output.get("sql_meaning", "")
                        if approval_status == "pending":
                            approval_requested = True
                            # TASK-012：落库 ApprovalTask + 推送 WS 事件，
                            # 让管理员能在 Approval Center 看到（即使关闭浏览器）
                            try:
                                from x_models.id_x_010.src.views.x_approval import (
                                    create_approval_task,
                                )

                                # conversation_id 由 stream_process 调用方传入 LangGraph
                                # config，human_approval 节点无法直接拿到——用 question
                                # hash 作为占位 conversation_id（TASK-006 完整接入后改为
                                # 真实 conversation_id）
                                conv_id = (
                                    state.get("conversation_id")
                                    if isinstance(state, dict)
                                    else None
                                ) or f"sql-{hash(question) & 0xFFFFFFFF:x}"
                                await create_approval_task(
                                    conversation_id=conv_id,
                                    sql=pending_sql,
                                    question=question,
                                    sql_meaning=sql_meaning or None,
                                )
                            except Exception as e:
                                logger.warning(
                                    f"{get_request_id()}create_approval_task 失败（非致命）: "
                                    f"{type(e).__name__}: {e}"
                                )
                            yield {
                                "type": "sql_approval",
                                "content": pending_sql,
                                "sql": pending_sql,
                                "sql_meaning": sql_meaning,
                                "model_used": self.model_name,
                            }
                            # TASK-015：紧跟 sql_approval 发 sql_explanation chunk，
                            # 让前端独立维护"阐述气泡"——与审核状态解耦后，
                            # 审核通过/拒绝/取消时阐述气泡仍能保留显示。
                            if sql_meaning:
                                yield {
                                    "type": "sql_explanation",
                                    "content": sql_meaning,
                                    "sql": pending_sql,
                                    "sql_meaning": sql_meaning,
                                    "model_used": self.model_name,
                                }

                    elif node_name == "run_query":
                        data = node_output.get("result", [])
                        columns = node_output.get("columns", [])
                        error = node_output.get("error")

                        if error:
                            yield {
                                "type": "thinking",
                                "content": f"查询执行失败：{error}",
                                "model_used": self.model_name,
                            }
                            yield {
                                "type": "error",
                                "content": error,
                                "model_used": self.model_name,
                            }
                        else:
                            yield {
                                "type": "thinking",
                                "content": f"查询执行成功，返回 {len(data)} 行数据",
                                "model_used": self.model_name,
                            }
                            yield {
                                "type": "result",
                                "content": "",
                                "columns": columns,
                                "data": data[:512],
                                "row_count": len(data),
                                "model_used": self.model_name,
                            }

            if data and not error:
                answer = ""
                async for chunk in self._stream_explanation(question, sql, data):
                    yield chunk
                    if chunk.get("type") == "content":
                        answer += chunk.get("content", "")

                # 深度意图识别 + 主动可视化推荐：复用前置节点识别的意图
                # （避免重复 LLM 调用），仅在数据结构判定时补充列选择
                chart_config = await self._generate_chart_config(
                    question, columns, data, captured_intent
                )
                if chart_config:
                    yield {
                        "type": "thinking",
                        "content": (
                            f"已识别分析意图：{chart_config.get('intent', 'N/A')}"
                            f"，推荐 {chart_config.get('type', '')} 图"
                        ),
                        "model_used": self.model_name,
                    }
                    yield {
                        "type": "chart",
                        "content": "",
                        "chart_config": chart_config,
                        "model_used": self.model_name,
                    }
                elif columns and len(columns) >= 2 and len(data) >= 2:
                    # 数据有结构但 LLM 判定不适合画图——给用户一条透明反馈
                    yield {
                        "type": "thinking",
                        "content": "已分析数据结构，当前问题不需要图表可视化",
                        "model_used": self.model_name,
                    }

                _observe_llm(
                    self.model_name, "sql", "success", time.perf_counter() - _started
                )
                yield {
                    "type": "done",
                    "sql": sql,
                    "answer": answer,
                    "row_count": len(data),
                    "model_used": self.model_name,
                    "usage": self._usage_snapshot(),
                }
            elif error:
                _observe_llm(
                    self.model_name, "sql", "error", time.perf_counter() - _started
                )
                yield {
                    "type": "done",
                    "sql": sql,
                    "answer": f"查询失败: {error}",
                    "error": error,
                    "model_used": self.model_name,
                    "usage": self._usage_snapshot(),
                }
            elif sql and not approval_requested and not security_blocked:
                # 查询执行成功但结果为空（run_query 已发过 0 行 result chunk）：
                # 补发"回答"正文与 done——前端 done 不读取 answer 字段，
                # 缺 content chunk 会让四段式气泡的"回答"部分空缺
                empty_answer = "查询结果为空，没有找到相关数据。"
                yield {
                    "type": "content",
                    "content": empty_answer,
                    "model_used": self.model_name,
                }
                _observe_llm(
                    self.model_name, "sql", "success", time.perf_counter() - _started
                )
                yield {
                    "type": "done",
                    "sql": sql,
                    "answer": empty_answer,
                    "row_count": 0,
                    "model_used": self.model_name,
                    "usage": self._usage_snapshot(),
                }

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [sql.stream_query] | model={self.model_name}, "
                f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
            )
            yield {
                "type": "error",
                "content": friendly_llm_error(e, self.model_name),
                "model_used": self.model_name,
            }

    async def _stream_explanation(
        self,
        question: str,
        sql: str,
        results: List[Dict[str, Any]],
    ) -> AsyncGenerator[Dict[str, Any], None]:
        result_str = (
            "\n".join(str(row) for row in results[:20]) if results else "查询结果为空"
        )
        if len(results) > 20:
            result_str += f"\n... 还有 {len(results) - 20} 行"

        prompt = RESULT_EXPLANATION_PROMPT.format(
            original_question=question,
            sql_query=sql,
            query_result=result_str,
        )

        messages = [
            SystemMessage(content="你是一个数据分析专家，负责解释查询结果。"),
            HumanMessage(content=prompt),
        ]

        in_thinking = False

        try:
            async for chunk in self.llm.astream(messages):
                # stream_usage=True 时末块携带 usage_metadata（content 为空），
                # 在 token 处理前累加，保证流式解读的用量不丢
                self._track_usage(chunk)
                token = chunk.content

                if isinstance(token, list):
                    token = "".join(
                        item if isinstance(item, str) else str(item) for item in token
                    )

                if "<thinking>" in token:
                    in_thinking = True
                    token = token.replace("<thinking>", "")

                if "</thinking>" in token:
                    in_thinking = False
                    token = token.replace("</thinking>", "")

                if token:
                    yield {
                        "type": "thinking" if in_thinking else "content",
                        "content": token,
                        "model_used": self.model_name,
                    }

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [sql._stream_explanation] | model={self.model_name}, "
                f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
            )
            yield {
                "type": "error",
                "content": friendly_llm_error(e, self.model_name),
            }

    @staticmethod
    def _build_chart_from_pre_intent(
        pre_intent: Dict[str, str],
        columns: List[str],
        numeric_cols: List[str],
        data: List[Dict[str, Any]],
        question: str,
    ) -> Optional[Dict[str, Any]]:
        """根据前置意图识别结果 + 数据列类型，免 LLM 调用直接构造图表配置。

        策略：
          - trend  → line/area：x 选第一个时间/日期列，y 选所有数值列
          - comparison/ranking → bar：x 选第一个非数值列（类别），y 选数值列
          - distribution → pie：x 选第一个非数值列，y 选第一个数值列（要求 ≤8 类）
          - correlation → scatter：x、y 取前两个数值列
        返回 None 表示数据结构与建议类型不匹配，应回退 LLM 判定。
        """
        suggest = pre_intent.get("suggest_chart", "none")
        intent = pre_intent.get("intent", "")
        reason = pre_intent.get("reason", "")

        def _is_temporal_col(col: str) -> bool:
            col_lower = col.lower()
            # 列名线索：time/date/day/month/year/week/created/updated/temporal
            temporal_hints = (
                "time", "date", "day", "month", "year", "week",
                "created", "updated", "timestamp",
            )
            if any(h in col_lower for h in temporal_hints):
                return True
            # 值线索：前 3 行采样是否为日期字符串/日期对象
            for row in data[:3]:
                v = row.get(col)
                if v is None:
                    continue
                if hasattr(v, "isoformat"):
                    return True
                if isinstance(v, str) and (
                    "-" in v and len(v) >= 8  # YYYY-MM-DD 等
                ):
                    return True
            return False

        non_numeric_cols = [c for c in columns if c not in numeric_cols]
        temporal_cols = [c for c in columns if _is_temporal_col(c)]

        x_column: Optional[str] = None
        y_columns: List[str] = []
        chart_type = suggest

        if suggest in ("line", "area"):
            # trend：x 优先取时间列，无时间列回退非数值列，再不行取第一列
            x_column = temporal_cols[0] if temporal_cols else (
                non_numeric_cols[0] if non_numeric_cols else columns[0]
            )
            # y 取除 x 外的所有数值列
            y_columns = [c for c in numeric_cols if c != x_column]
            if not y_columns:
                return None

        elif suggest == "bar":
            # comparison/ranking：x 取非数值列（类别），y 取数值列
            x_column = non_numeric_cols[0] if non_numeric_cols else (
                temporal_cols[0] if temporal_cols else None
            )
            if not x_column:
                return None
            y_columns = [c for c in numeric_cols if c != x_column]
            if not y_columns:
                return None

        elif suggest == "pie":
            # distribution：x 取类别列，y 取单个数值列；类别数 ≤ 8
            x_column = non_numeric_cols[0] if non_numeric_cols else None
            if not x_column:
                return None
            y_columns = [numeric_cols[0]] if numeric_cols else []
            if not y_columns:
                return None
            # 类别数检测：从数据里取 x_column 的不同值
            unique_cats = set()
            for row in data[:50]:
                unique_cats.add(str(row.get(x_column, "")))
            if len(unique_cats) > 8:
                # 类别过多不适合饼图，退化为 bar
                chart_type = "bar"

        elif suggest == "scatter":
            # correlation：需要 ≥2 个数值列
            if len(numeric_cols) < 2:
                return None
            x_column = numeric_cols[0]
            y_columns = [numeric_cols[1]]
        else:
            return None

        # 标题：用问题截断或意图描述
        title = question.strip()
        if len(title) > 30:
            title = title[:30] + "…"

        return {
            "intent": intent,
            "type": chart_type,
            "x_column": x_column,
            "y_columns": y_columns,
            "title": title or f"{intent} 视图",
            "reason": reason or f"根据意图 {intent} 自动选择 {chart_type} 图",
        }

    async def _generate_chart_config(
        self,
        question: str,
        columns: List[str],
        data: List[Dict[str, Any]],
        pre_intent: Optional[Dict[str, str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """深度意图识别 + 主动可视化推荐。

        优先复用前置 `_analyze_intent_node` 识别出的意图（``pre_intent``），
        当 pre_intent.suggest_chart 已给出明确建议时直接据此构造配置，
        避免重复 LLM 调用；否则回退到调用 LLM 做图表判定。

        返回 None 表示不需要图表；否则返回形如::

            {
                "intent": "trend",          # 分析意图
                "type": "line",             # 图表类型（bar/line/pie/area/scatter）
                "x_column": "month",
                "y_columns": ["revenue"],
                "title": "近12个月营收趋势",
                "reason": "时间序列趋势适合折线图",
            }
        """
        # 数据结构预检：根本不可能画图的情况直接返回，省一次 LLM 调用
        if not data or not columns or len(data) < 2:
            return None
        if len(columns) < 2:
            return None

        # 数值列检测：至少需要 1 个数值列才有可视化意义。
        # 用前 3 行采样判断（避免 Decimal/Decimal128 等类型的字符串误判）。
        def _is_numeric_col(col: str) -> bool:
            for row in data[:3]:
                v = row.get(col)
                if v is None:
                    continue
                if isinstance(v, (int, float)):
                    return True
                if isinstance(v, str):
                    try:
                        float(v.replace(",", ""))
                        return True
                    except ValueError:
                        continue
            return False

        numeric_cols = [c for c in columns if _is_numeric_col(c)]
        if not numeric_cols:
            # 没有数值列：纯文本/枚举明细，画图无意义
            return None

        # ── 快速路径：复用前置节点识别的意图，免 LLM 调用直接构造配置 ──
        # 仅当 pre_intent.suggest_chart != "none" 且数据结构匹配建议类型时启用
        if pre_intent and pre_intent.get("suggest_chart") in {
            "bar", "line", "area", "pie", "scatter"
        }:
            config = self._build_chart_from_pre_intent(
                pre_intent, columns, numeric_cols, data, question
            )
            if config:
                logger.info(
                    f"{get_request_id()}[意图复用] 直接根据前置意图构造图表: "
                    f"intent={config['intent']}, type={config['type']}"
                )
                return config
            # 快速路径构造失败（列选择不匹配等）→ 回退到 LLM 判定
            logger.info(
                f"{get_request_id()}[意图复用] 快速路径不匹配，回退 LLM 判定"
            )

        sample_rows = data[:5]
        prompt = CHART_DETECTION_PROMPT.format(
            columns=columns,
            sample_rows=sample_rows,
            question=question,
        )

        try:
            response = await self.llm.ainvoke(
                [
                    SystemMessage(content=CHART_DETECTION_SYSTEM),
                    HumanMessage(content=prompt),
                ]
            )
            self._track_usage(response)
            raw = self._content_to_str(response.content).strip()

            # 兼容 ```json ... ``` 包裹
            if "```json" in raw:
                raw = raw.split("```json")[1].split("```")[0].strip()
            elif "```" in raw:
                raw = raw.split("```")[1].split("```")[0].strip()

            if not raw:
                return None

            import json as _json

            config = _json.loads(raw)

            # 兼容老格式（type 字段）与新格式（chart_type 字段）
            chart_type = config.get("chart_type") or config.get("type")
            intent = config.get("intent", "")
            reason = config.get("reason", "")

            if not chart_type or chart_type == "none":
                logger.info(
                    f"{get_request_id()}[意图分析] intent={intent}, "
                    f"不画图：{reason[:80] if reason else 'N/A'}"
                )
                return None

            # 校验必要字段
            x_column = config.get("x_column")
            y_columns = config.get("y_columns") or []
            if not x_column or not y_columns:
                logger.info(
                    f"{get_request_id()}[意图分析] chart_type={chart_type} "
                    f"但缺 x/y 列，跳过：{config}"
                )
                return None

            # 列名必须在结果集中
            if x_column not in columns:
                logger.warning(
                    f"{get_request_id()}[意图分析] x_column '{x_column}' "
                    f"不在结果列 {columns}，跳过"
                )
                return None
            y_columns = [c for c in y_columns if c in columns]
            if not y_columns:
                logger.warning(
                    f"{get_request_id()}[意图分析] y_columns 全部不在结果列，跳过"
                )
                return None

            # scatter 类型至少需要 1 个数值列做 y；其他类型同样要求 y 为数值
            y_numeric = [c for c in y_columns if c in numeric_cols]
            if not y_numeric:
                logger.warning(
                    f"{get_request_id()}[意图分析] y_columns {y_columns} "
                    f"均非数值列，无法画图"
                )
                return None

            normalized = {
                "intent": intent,
                "type": chart_type,
                "x_column": x_column,
                "y_columns": y_columns,
                "title": config.get("title") or "",
                "reason": reason,
            }
            logger.info(
                f"{get_request_id()}[意图分析] intent={intent}, "
                f"chart_type={chart_type}, x={x_column}, y={y_columns}, "
                f"title='{normalized['title']}'"
            )
            return normalized
        except Exception as e:
            logger.warning(
                f"{get_request_id()}图表配置生成失败（非致命）: {type(e).__name__}: {e}"
            )
            return None

    async def natural_language_to_sql(self, question: str) -> Tuple[str, str]:
        await self._initialize_tools()

        if not self._schema_cache:
            self._schema_cache = await self.db.get_schema_info()

        from langchain_core.prompts import ChatPromptTemplate

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", GENERATE_QUERY_SYSTEM_PROMPT),
                ("human", "数据库结构:\n{schema}\n\n用户问题: {question}"),
            ]
        )

        chain = prompt | self.llm
        response = await chain.ainvoke(
            {
                "schema": self._schema_cache,
                "question": question,
                "top_k": self.top_k,
            }
        )

        sql = self._extract_sql(self._content_to_str(response.content))
        return sql, ""

    async def execute_sql(self, sql: str) -> Tuple[List[Dict[str, Any]], List[str]]:
        return await self.db.execute_query(sql)

    async def result_to_natural_language(
        self,
        original_question: str,
        sql: str,
        results: List[Dict[str, Any]],
    ) -> Tuple[str, str]:
        answer = await self._explain_result(original_question, sql, results)
        return answer, ""

    async def stream_query_with_approval(
        self,
        question: str,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        async for chunk in self.stream_query(question, auto_execute=False):
            yield chunk

    async def continue_with_approval(
        self,
        sql: str,
        approved: bool,
        question: str = "",
    ) -> AsyncGenerator[Dict[str, Any], None]:
        _started = time.perf_counter()
        await self._initialize_tools()

        if approved:
            # TASK-015：审核通过时重新生成 sql_meaning 并发 sql_explanation chunk，
            # 让前端"阐述气泡"在执行期间仍可见（与审核气泡解耦）。
            # 前端 sql_approval 流里收到的 sql_meaning 会因 stream 切换丢失，
            # 这里重发以保活。
            sql_meaning = await self._generate_sql_meaning(question, sql)
            if sql_meaning:
                yield {
                    "type": "sql_explanation",
                    "content": sql_meaning,
                    "sql": sql,
                    "sql_meaning": sql_meaning,
                    "model_used": self.model_name,
                }
            # 提前做安全检查：审批通过的 SQL 仍可能因列级遮蔽/受保护表被拒
            # （用户可能手动修改了 SQL，或原 SQL 在 check_query 后被改动）。
            # 此处显式判定，发 security_block + done 让前端以红色告警呈现并关闭 loading。
            safe, reason = validate_sql_security(sql)
            if not safe:
                logger.warning(
                    f"{get_request_id()}审批后 SQL 安全检查未通过: {reason}"
                )
                yield {
                    "type": "thinking",
                    "content": f"SQL 校验未通过：{reason}",
                    "model_used": self.model_name,
                }
                yield {
                    "type": "security_block",
                    "content": reason,
                    "sql": sql,
                    "security_block": True,
                    "model_used": self.model_name,
                }
                yield {
                    "type": "done",
                    "sql": sql,
                    "answer": "",
                    "model_used": self.model_name,
                    "usage": self._usage_snapshot(),
                }
                return

            try:
                rows, columns = await self.db.execute_query(sql)
                yield {
                    "type": "thinking",
                    "content": f"查询执行成功，返回 {len(rows)} 行数据",
                    "model_used": self.model_name,
                }
                yield {
                    "type": "result",
                    "content": "",
                    "columns": columns,
                    "data": rows[:512],
                    "row_count": len(rows),
                    "model_used": self.model_name,
                }
                if rows:
                    answer = ""
                    async for chunk in self._stream_explanation(question, sql, rows):
                        yield chunk
                        if chunk.get("type") == "content":
                            answer += chunk.get("content", "")

                    # 深度意图识别 + 主动可视化推荐（与 stream_query 链路一致）
                    chart_config = await self._generate_chart_config(
                        question, columns, rows
                    )
                    if chart_config:
                        yield {
                            "type": "thinking",
                            "content": (
                                f"已识别分析意图：{chart_config.get('intent', 'N/A')}"
                                f"，推荐 {chart_config.get('type', '')} 图"
                            ),
                            "model_used": self.model_name,
                        }
                        yield {
                            "type": "chart",
                            "content": "",
                            "chart_config": chart_config,
                            "model_used": self.model_name,
                        }
                    elif columns and len(columns) >= 2 and len(rows) >= 2:
                        yield {
                            "type": "thinking",
                            "content": "已分析数据结构，当前问题不需要图表可视化",
                            "model_used": self.model_name,
                        }

                    yield {
                        "type": "done",
                        "sql": sql,
                        "answer": answer,
                        "row_count": len(rows),
                        "model_used": self.model_name,
                        "usage": self._usage_snapshot(),
                    }
                    _observe_llm(
                        self.model_name, "sql", "success", time.perf_counter() - _started
                    )
                else:
                    # 空结果也要给"回答"子气泡正文——前端 done 不读取 answer 字段
                    empty_answer = "查询结果为空，没有找到相关数据。"
                    yield {
                        "type": "content",
                        "content": empty_answer,
                        "model_used": self.model_name,
                    }
                    yield {
                        "type": "done",
                        "sql": sql,
                        "answer": empty_answer,
                        "row_count": 0,
                        "model_used": self.model_name,
                        "usage": self._usage_snapshot(),
                    }
                    _observe_llm(
                        self.model_name, "sql", "success", time.perf_counter() - _started
                    )
            except Exception as e:
                _observe_llm(
                    self.model_name, "sql", "error", time.perf_counter() - _started
                )
                logger.error(
                    f"{get_request_id()}第三方模型调用失败 [sql.continue_with_approval] | model={self.model_name}, "
                    f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
                )
                yield {
                    "type": "error",
                    "content": friendly_llm_error(e, self.model_name),
                    "model_used": self.model_name,
                }
        else:
            yield {
                "type": "sql_rejected",
                "content": "用户拒绝了SQL，正在重新生成...",
                "model_used": self.model_name,
            }

    async def close(self):
        await self.db.disconnect()


_sql_agent_cache: "OrderedDict[str, SQLAgent]" = OrderedDict()

# TASK-011：缓存上限与 TTL，控制连接池数量与生命周期
_MAX_AGENTS = 16
_AGENT_TTL = 3600  # 1 小时；超过则下次命中时重建


async def _evict_sql_agent(key: str, agent: "SQLAgent") -> None:
    """从缓存移除并 disconnect；best-effort 失败仅 logger.warning。"""
    try:
        await agent.db.disconnect()
        logger.info(
            f"{get_request_id()}SQLAgent evict: key='{key}', "
            f"剩余缓存数={len(_sql_agent_cache)}"
        )
    except Exception as e:
        logger.warning(
            f"{get_request_id()}SQLAgent evict disconnect 失败（继续移除）: "
            f"{type(e).__name__}: {e}"
        )


def get_sql_agent(
    model_type: str = "external",
    model_name: Optional[str] = None,
    force_new: bool = False,
    **kwargs,
) -> SQLAgent:
    """获取/创建 SQLAgent 实例。

    缓存策略（TASK-011）：
    - 命中且未过 TTL：``move_to_end`` 标记为最近使用，返回；
    - 命中但超 TTL：``force_new`` 等效路径——先 evict 旧实例再新建；
    - 未命中且达容量上限：``popitem(last=False)`` 移除最旧实例并 disconnect；
    - ``force_new=True``：强制重建。
    """
    db_name = kwargs.get("db_name", "")
    key = f"{model_type}/{model_name or ''}/{db_name}"
    now = time.time()

    cached = _sql_agent_cache.get(key)
    if cached is not None and not force_new:
        created_ts = getattr(cached, "_cache_created_ts", now)
        if now - created_ts > _AGENT_TTL:
            # TTL 期满：先 evict 再走新建路径
            _sql_agent_cache.pop(key, None)
            try:
                import asyncio as _asyncio

                _asyncio.create_task(_evict_sql_agent(key, cached))
            except Exception:
                pass  # evict 失败不阻塞新建
        else:
            # 命中且未过 TTL——LCU 标记最近使用
            _sql_agent_cache.move_to_end(key)
            return cached

    # 容量上限：先淘汰最旧
    while len(_sql_agent_cache) >= _MAX_AGENTS:
        old_key, old_agent = _sql_agent_cache.popitem(last=False)
        try:
            import asyncio as _asyncio

            _asyncio.create_task(_evict_sql_agent(old_key, old_agent))
        except Exception:
            pass

    agent = SQLAgent(
        model_type=model_type,
        model_name=model_name,
        **kwargs,
    )
    agent._cache_created_ts = now  # type: ignore[attr-defined]
    _sql_agent_cache[key] = agent
    logger.info(
        f"{get_request_id()}SQLAgent 实例创建: key='{key}', "
        f"当前缓存数={len(_sql_agent_cache)}/{_MAX_AGENTS}"
    )
    return agent


def _collect_pool_metrics() -> None:
    """遍历 _sql_agent_cache 上报连接池大小指标（TASK-007/TASK-011）。

    由 /metrics endpoint 调用前触发；任何异常静默忽略——指标不可用不影响主链路。
    """
    try:
        from x_models.id_x_010.src.utils.x_metrics import DB_POOL_SIZE

        for agent in _sql_agent_cache.values():
            try:
                engine = getattr(agent.db, "engine", None)
                if engine is None:
                    continue
                pool_size = engine.pool.size() if engine.pool else 0
                DB_POOL_SIZE.labels(db_name=agent.db_name or "unknown").set(pool_size)
            except Exception:
                continue
    except Exception:
        pass


async def close_all_sql_agents() -> None:
    """Litestar on_shutdown 钩子调用：清理所有缓存的 SQLAgent 连接。"""
    if not _sql_agent_cache:
        return
    keys = list(_sql_agent_cache.keys())
    for k in keys:
        agent = _sql_agent_cache.pop(k, None)
        if agent is None:
            continue
        try:
            await agent.db.disconnect()
        except Exception as e:
            logger.warning(
                f"{get_request_id()}close_all_sql_agents disconnect 失败 key='{k}': "
                f"{type(e).__name__}: {e}"
            )
    logger.info(
        f"{get_request_id()}close_all_sql_agents 完成，已清理 {len(keys)} 个实例"
    )
