from __future__ import annotations

import os
import re
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
from x_models.id_x_010.src.models.x_models import (
    get_external_model_config,
)


class SQLAgentState(MessagesState):
    question: str
    sql: str
    result: List[Dict[str, Any]]
    columns: List[str]
    answer: str
    thinking: str
    error: Optional[str]
    tables: List[str]
    relevant_tables: List[str]
    approval_status: str
    pending_sql: str


GENERATE_QUERY_SYSTEM_PROMPT = """你是一个专业的 SQL 专家，负责与 PostgreSQL 数据库交互。

给定用户的问题，生成符合 PostgreSQL 语法的查询语句。

重要规则：
1. 只生成 SELECT 查询语句，禁止使用 INSERT、UPDATE、DELETE、DROP、TRUNCATE 等修改数据的语句
2. 除非用户明确指定返回数量，否则总是限制结果最多返回 {top_k} 条记录
3. 只查询与问题相关的列，不要使用 SELECT *
4. 可以按相关列排序以返回最有趣的示例
5. 生成的 SQL 必须符合 PostgreSQL 语法
6. 使用适当的表别名提高可读性
7. 如果用户问题无法用 SQL 表达，请说明原因
"""

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
    def check(sql: str) -> Dict[str, Any]:
        result = {
            "safe": True,
            "allowed": True,
            "first_keyword": None,
            "dangers": [],
            "reason": "SQL 语句安全，允许执行",
        }

        first_keyword = SQLSecurityChecker.extract_first_keyword(sql)
        result["first_keyword"] = first_keyword

        if not first_keyword:
            result["safe"] = False
            result["allowed"] = False
            result["reason"] = "无法识别 SQL 语句"
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

        if first_keyword and first_keyword not in ALLOWED_KEYWORDS:
            if first_keyword not in DANGEROUS_KEYWORDS:
                result["safe"] = False
                result["allowed"] = False
                result["reason"] = (
                    f"安全限制：不允许执行未知类型的 SQL 语句（{first_keyword}）"
                )

        return result

    @staticmethod
    def is_safe(sql: str) -> bool:
        return SQLSecurityChecker.check(sql)["safe"]

    @staticmethod
    def is_select(sql: str) -> bool:
        first_keyword = SQLSecurityChecker.extract_first_keyword(sql)
        return first_keyword == "SELECT" or first_keyword == "WITH"


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
        # SQL Agent 使用独立的数据库连接参数（AGENT_DB_*），与业务库（DB_*）隔离
        # 优先取解密后的明文变量（由 main.py 启动时注入 os.environ），
        # 其次尝试解密 _ENC 变量（.env 文件中存储的加密值）
        from utils.decrypt_util import decrypt

        def _resolve_env(plain_key: str, enc_key: str, default: str) -> str:
            val = os.getenv(plain_key)
            if val:
                return val
            enc_val = os.getenv(enc_key)
            if enc_val:
                try:
                    return decrypt(enc_val)
                except Exception:
                    pass
            return default

        self.host = host or _resolve_env(
            "AGENT_DB_HOST", "AGENT_DB_HOST_ENC", "localhost"
        )
        self.port = port or int(
            _resolve_env("AGENT_DB_PORT", "AGENT_DB_PORT_ENC", "5432")
        )
        self.database = database or _resolve_env(
            "AGENT_DB_NAME", "AGENT_DB_NAME_ENC", "postgres"
        )
        self.user = user or _resolve_env(
            "AGENT_DB_USERNAME", "AGENT_DB_USERNAME_ENC", "postgres"
        )
        self.password = password or _resolve_env(
            "AGENT_DB_PASSWORD", "AGENT_DB_PASSWORD_ENC", ""
        )

        self.engine = None
        self.session_factory: Optional[async_sessionmaker[AsyncSession]] = None
        self._is_connected = False
        self._sql_database: Optional[SQLDatabase] = None

    async def connect(self):
        if self._is_connected:
            return

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

    async def execute_query(self, sql: str) -> Tuple[List[Dict[str, Any]], List[str]]:
        if not self._is_connected:
            await self.connect()

        security_result = SQLSecurityChecker.check(sql)
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
                    f"{get_request_id()}SQL 执行成功: {sql[:100]}... 返回 {len(rows)} 行"
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
            rows, _ = await self.execute_query(schema_sql)
            return [row.get("table_name", "") for row in rows]
        except Exception as e:
            logger.error(f"{get_request_id()}获取表名失败: {e}", exc_info=True)
            return []

    async def get_schema_info(self, table_names: Optional[List[str]] = None) -> str:
        if table_names:
            names_str = ",".join(f"'{t}'" for t in table_names)
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
            rows, _ = await self.execute_query(schema_sql)
            tables: Dict[str, List[Dict]] = {}
            for row in rows:
                table_name = row.get("table_name", "")
                if table_name not in tables:
                    tables[table_name] = []
                tables[table_name].append(
                    {
                        "column_name": row.get("column_name"),
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

        external_config = get_external_model_config()

        self.model_name = (
            model_name
            or external_config.get("model_name")
            or os.getenv("EXTERNAL_LLM_MODEL")
            or "Pro/zai-org/GLM-5"
        )
        self.api_key = (
            api_key or external_config.get("api_key") or os.getenv("EXTERNAL_API_KEY")
        )
        self.base_url = (
            base_url
            or external_config.get("base_url")
            or os.getenv("EXTERNAL_BASE_URL", "https://api.siliconflow.cn/v1")
        )

        self.llm = self._create_llm()

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

        logger.info(f"{get_request_id()}SQLAgent 初始化完成: model={self.model_name}")

    def _create_llm(self) -> ChatOpenAI:
        model_identifier = self.EXTERNAL_MODELS.get(self.model_name, self.model_name)

        return ChatOpenAI(
            model=model_identifier,
            api_key=SecretStr(self.api_key) if self.api_key else None,
            base_url=self.base_url,
            temperature=0.1,
            streaming=True,
        )

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
        builder.add_node("generate_query", self._generate_query_node)
        builder.add_node("check_query", self._check_query_node)
        builder.add_node("human_approval", self._human_approval_node)
        builder.add_node("run_query", self._run_query_node)

        builder.add_edge(START, "list_tables")
        builder.add_edge("list_tables", "call_get_schema")
        builder.add_edge("call_get_schema", "get_schema")
        builder.add_edge("get_schema", "generate_query")
        builder.add_conditional_edges(
            "generate_query",
            self._should_continue,
        )
        builder.add_edge("check_query", "human_approval")
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

        response_message = AIMessage(f"可用表: {', '.join(tables)}")

        return {
            "tables": tables,
            "messages": [tool_call_message, response_message],
        }

    async def _call_get_schema_node(self, state: SQLAgentState) -> Dict[str, Any]:
        question = state.get(
            "question", state["messages"][-1].content if state["messages"] else ""
        )

        get_schema_tool = next(
            (t for t in self._tools if t.name == "sql_db_schema"), None
        )

        if get_schema_tool:
            llm_with_tools = self.llm.bind_tools([get_schema_tool], tool_choice="any")
            prompt = f"用户问题: {question}\n\n请确定需要查询哪些表的 schema。"
            response = await llm_with_tools.ainvoke(
                [
                    SystemMessage(
                        content="你是数据库专家，需要确定哪些表与用户问题相关。"
                    ),
                    HumanMessage(content=prompt),
                ]
            )
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

        if not self._schema_cache:
            self._schema_cache = await self.db.get_schema_info()
        return {"messages": [AIMessage(content=self._schema_cache)]}

    async def _generate_query_node(self, state: SQLAgentState) -> Dict[str, Any]:
        question = state.get("question", "")
        if not question and state["messages"]:
            for msg in reversed(state["messages"]):
                if isinstance(msg, HumanMessage):
                    question = msg.content
                    break

        system_prompt = GENERATE_QUERY_SYSTEM_PROMPT.format(top_k=self.top_k)

        run_query_tool = next(
            (t for t in self._tools if t.name == "sql_db_query"), None
        )

        if run_query_tool:
            llm_with_tools = self.llm.bind_tools([run_query_tool])
        else:
            llm_with_tools = self.llm

        response = await llm_with_tools.ainvoke(
            [
                SystemMessage(content=system_prompt),
                *state["messages"],
            ]
        )

        sql = ""
        if isinstance(response, AIMessage) and response.tool_calls:
            sql = response.tool_calls[0].get("args", {}).get("query", "")
        elif response.content:
            sql = self._extract_sql(self._content_to_str(response.content))

        return {"sql": sql, "messages": [response]}

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

        response = await self.llm.ainvoke(
            [
                SystemMessage(content="你是 SQL 专家，负责检查 SQL 查询的正确性。"),
                HumanMessage(content=check_prompt),
            ]
        )

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
        last_message = state["messages"][-1]

        if not isinstance(last_message, AIMessage) or not last_message.tool_calls:
            return "__end__"

        if state.get("error"):
            return "__end__"

        return "check_query"

    @staticmethod
    def _content_to_str(content: str | list[str | dict[Any, Any]]) -> str:
        if isinstance(content, str):
            return content
        return "".join(item if isinstance(item, str) else str(item) for item in content)

    def _extract_sql(self, content: str) -> str:
        code_block_pattern = r"```(?:sql)?\s*([\s\S]*?)\s*```"
        match = re.search(code_block_pattern, content, re.IGNORECASE)
        if match:
            return match.group(1).strip()

        prefixes = [
            r"^输出[：:]\s*",
            r"^SQL[：:]\s*",
            r"^SQL语句[：:]\s*",
            r"^查询语句[：:]\s*",
        ]
        for prefix in prefixes:
            content = re.sub(prefix, "", content, flags=re.IGNORECASE)

        return content.strip()

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
            result["answer"] = f"查询过程中出现错误: {str(e)}"
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
            }

            assert self._graph is not None
            sql = ""
            data = []
            columns = []
            error = None

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

                    elif node_name == "generate_query":
                        sql = node_output.get("sql", "")
                        if sql:
                            yield {
                                "type": "thinking",
                                "content": f"已生成 SQL 查询：{sql[:100]}{'...' if len(sql) > 100 else ''}",
                                "model_used": self.model_name,
                            }
                            yield {
                                "type": "sql_generated",
                                "content": sql,
                                "model_used": self.model_name,
                            }

                    elif node_name == "check_query":
                        yield {
                            "type": "thinking",
                            "content": "已验证 SQL 查询的正确性",
                            "model_used": self.model_name,
                        }

                    elif node_name == "human_approval":
                        pending_sql = node_output.get("pending_sql", "")
                        approval_status = node_output.get("approval_status", "")
                        if approval_status == "pending":
                            yield {
                                "type": "sql_approval",
                                "content": pending_sql,
                                "sql": pending_sql,
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
                                "data": data[:10],
                                "row_count": len(data),
                                "model_used": self.model_name,
                            }

            if data and not error:
                answer = ""
                async for chunk in self._stream_explanation(question, sql, data):
                    yield chunk
                    if chunk.get("type") == "content":
                        answer += chunk.get("content", "")

                yield {
                    "type": "done",
                    "sql": sql,
                    "answer": answer,
                    "row_count": len(data),
                    "model_used": self.model_name,
                }
            elif error:
                yield {
                    "type": "done",
                    "sql": sql,
                    "answer": f"查询失败: {error}",
                    "error": error,
                    "model_used": self.model_name,
                }

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [sql.stream_query] | model={self.model_name}, "
                f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
            )
            yield {
                "type": "error",
                "content": str(e),
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
                "content": str(e),
            }

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
        await self._initialize_tools()

        if approved:
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
                    "data": rows[:10],
                    "row_count": len(rows),
                    "model_used": self.model_name,
                }
                if rows:
                    answer = ""
                    async for chunk in self._stream_explanation(question, sql, rows):
                        yield chunk
                        if chunk.get("type") == "content":
                            answer += chunk.get("content", "")
                    yield {
                        "type": "done",
                        "sql": sql,
                        "answer": answer,
                        "row_count": len(rows),
                        "model_used": self.model_name,
                    }
                else:
                    yield {
                        "type": "done",
                        "sql": sql,
                        "answer": "查询结果为空",
                        "row_count": 0,
                        "model_used": self.model_name,
                    }
            except Exception as e:
                logger.error(
                    f"{get_request_id()}第三方模型调用失败 [sql.continue_with_approval] | model={self.model_name}, "
                    f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
                )
                yield {
                    "type": "error",
                    "content": str(e),
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


_sql_agent_cache: Dict[str, SQLAgent] = {}


def get_sql_agent(
    model_type: str = "external",
    model_name: Optional[str] = None,
    force_new: bool = False,
    **kwargs,
) -> SQLAgent:
    db_name = kwargs.get("db_name", "")
    key = f"{model_type}/{model_name or ''}/{db_name}"
    if force_new or key not in _sql_agent_cache:
        _sql_agent_cache[key] = SQLAgent(
            model_type=model_type,
            model_name=model_name,
            **kwargs,
        )
        logger.info(
            f"{get_request_id()}SQLAgent 实例创建: key='{key}', "
            f"当前缓存数={len(_sql_agent_cache)}"
        )
    return _sql_agent_cache[key]
