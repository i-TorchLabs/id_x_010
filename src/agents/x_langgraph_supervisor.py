import json
import os
import uuid
from enum import Enum
from typing import Annotated, Any, Dict, List, Optional, Tuple, TypedDict, cast

from langchain_core.messages import BaseMessage, HumanMessage
from langchain_core.tools import InjectedToolCallId, tool
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import InjectedState
from langgraph.types import Command, Send
from pydantic import BaseModel, Field, SecretStr
from semantic_router import Route
from semantic_router.encoders import OpenAIEncoder
from semantic_router.routers import SemanticRouter as _SemanticRouter
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.agents.x_general_agent import (
    DEFAULT_SYSTEM_PROMPT,
    GeneralAgent,
)
from x_models.id_x_010.src.agents.x_llm_error import (
    DEFAULT_EXTERNAL_MODEL,
    friendly_llm_error,
)
from x_models.id_x_010.src.agents.x_sql_agent import SQLAgent
from x_models.id_x_010.src.models.x_models import (
    get_external_model_config,
    get_local_model_config,
)


class CustomOpenAIEncoder(OpenAIEncoder):
    def __init__(self, name: str, **kwargs):
        openai_base_url = kwargs.pop("openai_base_url", None)
        openai_api_key = kwargs.pop("openai_api_key", None) or kwargs.pop(
            "api_key", None
        )

        super().__init__(
            name="gpt-4",
            openai_api_key=openai_api_key,
            openai_base_url=openai_base_url,
            **kwargs,
        )

        self.name = name

        logger.info(
            f"{get_request_id()}CustomOpenAIEncoder 初始化完成，模型: {name}, base_url: {openai_base_url}"
        )


GENERAL_ROUTE = Route(
    name="general",
    utterances=[
        "你好",
        "你好吗",
        "今天天气怎么样",
        "请帮我解释一下",
        "什么是",
        "如何理解",
        "给出建议",
        "你觉得",
        "你认为",
        "请解释",
        "简单说明",
        "详细介绍",
        "帮我解答",
        "问个问题",
        "帮我翻译",
        "写一篇文章",
        "帮我作文",
        "聊天",
        "闲聊",
        "讲个笑话",
    ],
)

SQL_ROUTE = Route(
    name="sql",
    utterances=[
        "查询数据库",
        "请查询数据库",
        "帮我查询数据库",
        "查询数据库中的数据",
        "从数据库查询",
        "数据库查询",
        "查询表中",
        "统计有多少",
        "统计数据库",
        "数据有多少条",
        "数据库中有多少",
        "有多少张表",
        "数据库有多少张表",
        "表中有多少数据",
        "表中有多少条记录",
        "列出所有表",
        "显示所有表",
        "查看表结构",
        "获取表信息",
        "表结构是什么",
        "有哪些表",
        "数据库里有什么表",
        "查询记录",
        "查询记录数",
        "统计记录",
        "查找用户",
        "查找数据",
        "搜索数据",
        "搜索记录",
        "获取数据",
        "列出所有",
        "显示记录",
        "查询结果",
        "查看数据",
        "执行 SQL",
        "执行查询",
        "运行 SQL",
        "SQL 查询",
        "SELECT 查询",
        "数据库操作",
        "数据统计",
        "统计分析",
        "帮我查一下数据库",
        "请问数据库中有多少数据",
        "我想查询数据库",
        "请告诉我数据库的情况",
        "查询并告诉我结果",
        "从数据库中找出",
        "帮我统计一下",
        "请查询并展示",
    ],
)

CODE_ROUTE = Route(
    name="code",
    utterances=[
        "写一个脚本",
        "帮我写代码",
        "生成代码",
        "编写程序",
        "实现功能",
        "写一个函数",
        "创建一个类",
        "帮我编程",
        "生成脚本",
        "代码实现",
        "编程解决",
        "用 Python 写",
        "写一段代码",
        "帮我写一段代码",
        "请帮我实现",
        "写一个程序",
        "编程实现",
        "代码生成",
        "如何编程",
        "写个脚本",
        "编写脚本",
    ],
)


class SemanticRouter:
    def __init__(
        self,
        openai_api_key: Optional[str] = None,
        openai_base_url: Optional[str] = None,
        embedding_model: Optional[str] = None,
    ):
        # 初始化涉及 embedding 调用（route_layer.add 会立即计算语料向量），
        # 端点缺 key 或不支持 embeddings 时不应让构造抛错——降级为
        # "始终路由到 general"，保证聊天主链路可用。
        self._ready = False
        self.route_layer = None
        try:
            external_config = get_external_model_config()

            final_api_key = (
                openai_api_key
                or external_config.get("api_key")
                or os.getenv("EXTERNAL_API_KEY")
            )
            # embedding 端点优先取专用 EMBD 地址（external_provider 表 /
            # EXTERNAL_EMBD_BASE_URL），缺省时回退 LLM 地址
            final_base_url = (
                openai_base_url
                or external_config.get("embd_base_url")
                or external_config.get("base_url")
            )
            final_embedding_model = embedding_model or os.getenv(
                "EXTERNAL_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-8B"
            )

            self.encoder = CustomOpenAIEncoder(
                name=final_embedding_model,
                openai_api_key=final_api_key,
                openai_base_url=final_base_url,
            )

            self.route_layer = _SemanticRouter(
                encoder=self.encoder,
                routes=[],
            )
            self.route_layer.add([GENERAL_ROUTE, SQL_ROUTE, CODE_ROUTE])
            self._ready = True

            logger.info(f"{get_request_id()}SemanticRouter 初始化完成")
        except Exception as e:
            logger.warning(
                f"{get_request_id()}SemanticRouter 初始化失败，意图路由降级为 general: "
                f"{type(e).__name__}: {e}"
            )

    async def route(self, query: str) -> Tuple[str, float]:
        if not self._ready or self.route_layer is None:
            logger.info(
                f"{get_request_id()}路由器不可用，使用默认 general: query='{query[:50]}...'"
            )
            return "general", 0.0
        try:
            route_result = self.route_layer(query)

            if route_result:
                if isinstance(route_result, list) and route_result:
                    intent = getattr(route_result[0], "name", "general") or "general"
                else:
                    intent = getattr(route_result, "name", "general") or "general"
                confidence = 0.8
                logger.info(
                    f"{get_request_id()}路由成功: query='{query[:50]}...', intent='{intent}'"
                )
                return intent, confidence
            else:
                logger.info(
                    f"{get_request_id()}路由未匹配，使用默认 general: query='{query[:50]}...'"
                )
                return "general", 0.5

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [semantic_router] | 原因: {type(e).__name__}: {e}"
            )
            return "general", 0.0

    def get_route_info(self, intent: str) -> dict:
        route_info = {
            "general": {
                "description": "一般性问题和对话",
                "agent": "general_agent",
                "system_prompt": DEFAULT_SYSTEM_PROMPT,
            },
            "sql": {
                "description": "数据库查询相关",
                "agent": "sql_agent",
                "system_prompt": "你是一个数据库专家，帮助用户查询和分析数据。",
            },
            "code": {
                "description": "代码生成相关",
                "agent": "code_agent",
                "system_prompt": "你是一个编程专家，帮助用户编写和调试代码。",
            },
        }
        return route_info.get(intent, route_info["general"])


class IntentType(str, Enum):
    GENERAL = "general"
    SQL = "sql"
    CODE = "code"


class IntentResult(BaseModel):
    intent: IntentType = Field(description="识别的意图类型")
    confidence: float = Field(
        default=0.8, ge=0.0, le=1.0, description="置信度分数，0.0 到 1.0 之间"
    )
    reasoning: str = Field(default="", description="意图识别的推理过程")


class LLMRouter:
    INTENT_DESCRIPTIONS = {
        IntentType.GENERAL: {
            "name": "general",
            "description": """
一般性问题、日常对话和通用知识咨询。

核心特征：用户寻求的是信息获取、知识解答、建议指导或友好交流，不涉及具体的技术操作。

典型场景：
- 知识问答："什么是机器学习？"
- 概念解释："解释一下分布式系统的原理"
- 日常问候："你好！" "今天天气怎么样？"
- 文本处理："帮我把这段话翻译成英文"
- 建议咨询："你推荐我学什么编程语言？"
- 闲聊情感："我有点难过，能聊聊吗？"

注意：如果用户的问题需要访问数据库、查询数据、操作表结构或统计分析数据内容，
则应归类为 SQL 类型；如果需要生成、修改或调试代码，则应归类为 CODE 类型。
""",
            "agent": "general_agent",
            "system_prompt": "你是一个智能助手，专注于帮助用户解决问题。",
        },
        IntentType.SQL: {
            "name": "sql",
            "description": """
数据库相关操作，涉及对数据存储系统的访问、查询、统计或分析。

核心特征：用户需要了解、获取、统计或操作数据库中的数据内容。
这类问题通常暗示存在一个数据存储系统需要被访问。

典型场景：
- 数据获取："查询最近一周的订单" "获取所有学生的成绩"
- 统计分析："每个部门有多少员工？" "计算本月的销售额总和"
- 元数据查询："当前连接的数据库名称是什么？" "有多少张表？"
- 表结构探索："显示用户表的所有字段" "列出所有表的名称"
- 记录统计："每张表中分别有多少条记录？" "这个表有多少行数据"
- 数据分析："哪个产品的销量最高？" "分析用户行为趋势"

语义提示：即使用户没有明确使用"SQL""数据库""查询"等技术术语，
只要问题暗示需要访问或统计数据存储系统中的内容，也应识别为 SQL 类型。
例如："咱们系统里现在有多少用户？" "能告诉我今天的订单量吗？"
""",
            "agent": "sql_agent",
            "system_prompt": "你是一个数据库专家，帮助用户查询和分析数据。",
        },
        IntentType.CODE: {
            "name": "code",
            "description": """
程序开发相关，涉及代码编写、脚本实现或技术方案生成。

核心特征：用户需要获得可执行的代码、脚本、程序或技术实现方案。

典型场景：
- 代码生成："写一个排序算法" "帮我实现一个登录功能"
- 脚本编写："写一个自动化部署脚本" "创建定时任务脚本"
- 功能实现："用 Python 实现爬虫" "编写一个 REST API"
- Bug 修复："这段代码哪里有问题？" "帮我调试这个函数"
- 代码优化："重构这段代码" "优化这个算法的性能"
- 技术方案："设计一个微服务架构" "如何实现消息队列"

语义提示：用户关注的是代码层面的实现，而非数据层面的查询或统计。
""",
            "agent": "code_agent",
            "system_prompt": "你是一个编程专家，帮助用户编写和调试代码。",
        },
    }

    def __init__(
        self,
        model_type: str = "external",
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        use_structured_output: bool = True,
    ):
        self.model_type = model_type
        self.use_structured_output = use_structured_output

        external_config = get_external_model_config()

        self.model_name = (
            model_name
            or external_config.get("model_name")
            or os.getenv("EXTERNAL_LLM_MODEL")
            or DEFAULT_EXTERNAL_MODEL
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

        if self.use_structured_output:
            try:
                self.structured_llm = self.llm.with_structured_output(IntentResult)
                logger.info(f"{get_request_id()}LLM Router 使用结构化输出模式")
            except Exception as e:
                logger.warning(
                    f"{get_request_id()}结构化输出不支持，回退到普通模式: {e}"
                )
                self.structured_llm = None
                self.use_structured_output = False
        else:
            self.structured_llm = None

        logger.info(
            f"{get_request_id()}LLMRouter 初始化完成: model={self.model_name}, structured_output={self.use_structured_output}"
        )

    def _create_llm(self) -> ChatOpenAI:
        if self.model_type == "external":
            return ChatOpenAI(
                model=self.model_name,
                api_key=SecretStr(self.api_key) if self.api_key else None,
                base_url=self.base_url,
                temperature=0,
                streaming=False,
            )
        else:
            local_config = get_local_model_config()
            local_base_url = local_config.get("base_url")
            local_api_key = local_config.get("api_key") or "ollama"
            return ChatOpenAI(
                model=self.model_name,
                api_key=SecretStr(local_api_key),
                base_url=local_base_url,
                temperature=0,
                streaming=False,
            )

    def _build_classification_prompt(self) -> str:
        intent_desc = "\n\n".join(
            [
                f"## {info['name']}\n{info['description'].strip()}"
                for info in self.INTENT_DESCRIPTIONS.values()
            ]
        )

        return f"""你是意图识别专家。请基于深入的语义理解和上下文分析，判断用户意图。不要依赖关键词匹配。

# 可选的意图类型

{intent_desc}

# 判断原则（重要）

1. **语义优先**：关注用户问题的本质需求，而非表面的词汇。
   - 例如"咱们系统里有多少用户？"虽然没提"数据库"，但实际上是在查询数据存储系统，应归类为 SQL。
   - 例如"每张表有多少记录？"是在统计元数据，属于数据库操作，归类为 SQL。

2. **上下文理解**：分析问题背后的实际场景。
   - "今天天气怎么样？" -> general（日常生活咨询）
   - "今天的订单量是多少？" -> sql（业务数据统计）

3. **边界判断**：
   - 如果问题涉及访问数据存储系统（表、记录、数据库、数据统计等），归类为 SQL
   - 如果问题需要生成或修改代码，归类为 CODE
   - 其他情况归类为 GENERAL

4. **避免关键词依赖**：不要因为包含某个词就机械判断，要理解问题的真实意图。

# 输出格式

请以 JSON 格式输出，包含以下字段：
- intent: 意图类型（general/sql/code）
- confidence: 置信度（0.0-1.0，表示判断的确信程度）
- reasoning: 简要说明判断理由（基于语义理解而非关键词）

# 用户输入

{{query}}
"""

    async def route(self, query: str) -> Tuple[str, float]:
        if not query or not query.strip():
            return "general", 0.0

        try:
            if self.use_structured_output and self.structured_llm:
                return await self._route_structured(query)
            else:
                return await self._route_normal(query)

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [router] | model={self.model_name}, "
                f"base_url={self.base_url} | "
                f"原因: {type(e).__name__}: {e}"
            )
            return "general", 0.0

    async def _route_structured(self, query: str) -> Tuple[str, float]:
        assert self.structured_llm is not None, "structured_llm must not be None"
        prompt = self._build_classification_prompt().format(query=query)

        result: IntentResult = cast(
            IntentResult, await self.structured_llm.ainvoke(prompt)
        )

        intent_name = result.intent.value
        confidence = result.confidence

        logger.info(
            f"{get_request_id()}[LLM路由] 用户输入: '{query[:50]}...' "
            f"-> 意图: '{intent_name}' (置信度: {confidence:.2f}) "
            f"理由: {result.reasoning[:100] if result.reasoning else 'N/A'}"
        )

        return intent_name, confidence

    async def _route_normal(self, query: str) -> Tuple[str, float]:
        prompt = self._build_classification_prompt().format(query=query)

        response = await self.llm.ainvoke([HumanMessage(content=prompt)])
        content = response.content

        content_str: str
        if isinstance(content, list):
            content_str = " ".join(
                item if isinstance(item, str) else json.dumps(item) for item in content
            )
        else:
            content_str = str(content)

        try:
            if "```json" in content_str:
                json_str = content_str.split("```json")[1].split("```")[0].strip()
            elif "```" in content_str:
                json_str = content_str.split("```")[1].split("```")[0].strip()
            else:
                json_str = content_str.strip()

            result = json.loads(json_str)
            intent = result.get("intent", "general")
            confidence = float(result.get("confidence", 0.8))
            reasoning = result.get("reasoning", "")

            if intent not in ["general", "sql", "code"]:
                intent = "general"

            logger.info(
                f"{get_request_id()}[LLM路由] 用户输入: '{query[:50]}...' "
                f"-> 意图: '{intent}' (置信度: {confidence:.2f}) "
                f"理由: {reasoning[:100] if reasoning else 'N/A'}"
            )

            return intent, confidence

        except json.JSONDecodeError as e:
            logger.warning(
                f"{get_request_id()}JSON 解析失败: {e}, 原始响应: {content_str[:200]}"
            )
            content_lower = content_str.lower()
            if "sql" in content_lower:
                return "sql", 0.6
            elif "code" in content_lower:
                return "code", 0.6
            return "general", 0.5

    def get_route_info(self, intent: str) -> dict:
        intent_enum = (
            IntentType(intent)
            if intent in [i.value for i in IntentType]
            else IntentType.GENERAL
        )
        return self.INTENT_DESCRIPTIONS.get(
            intent_enum, self.INTENT_DESCRIPTIONS[IntentType.GENERAL]
        )


class SupervisorState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    query: str
    intent: Optional[str]
    confidence: Optional[float]
    response: Optional[str]
    thinking: Optional[str]
    error: Optional[str]
    conversation_id: Optional[str]
    model_type: Optional[str]
    model_name: Optional[str]
    context: Optional[List[Dict[str, str]]]
    system_prompt: Optional[str]


def create_handoff_tool(*, agent_name: str, description: Optional[str] = None):
    name = f"transfer_to_{agent_name}"
    description = description or f"Transfer control to {agent_name}."

    @tool(name, description=description)
    def handoff_tool(
        state: Annotated[SupervisorState, InjectedState],
        tool_call_id: Annotated[str, InjectedToolCallId],
    ) -> Command:
        tool_message = {
            "role": "tool",
            "content": f"Successfully transferred to {agent_name}",
            "name": name,
            "tool_call_id": tool_call_id,
        }
        return Command(
            goto=agent_name,
            update={**state, "messages": state["messages"] + [tool_message]},
            graph=Command.PARENT,
        )

    return handoff_tool


def create_task_handoff_tool(*, agent_name: str, description: Optional[str] = None):
    name = f"transfer_to_{agent_name}"
    description = description or f"Assign task to {agent_name}."

    @tool(name, description=description)
    def handoff_tool(
        task_description: Annotated[
            str,
            "Description of what the next agent should do, including all relevant context.",
        ],
        state: Annotated[SupervisorState, InjectedState],
    ) -> Command:
        task_message = {"role": "user", "content": task_description}
        agent_input = {**state, "messages": [task_message]}
        return Command(
            goto=[Send(agent_name, agent_input)],
            graph=Command.PARENT,
        )

    return handoff_tool


class LangGraphSupervisor:
    def __init__(
        self,
        model_type: str = "external",
        model_name: Optional[str] = None,
        use_llm_router: bool = False,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        self.use_llm_router = use_llm_router
        self.model_type = model_type
        self.model_name = model_name

        if use_llm_router:
            self.router = LLMRouter(
                model_type=model_type,
                model_name=model_name,
            )
            logger.info(f"{get_request_id()}使用 LLM 路由器进行意图识别")
        else:
            # 用户自定义配置存在时，路由器的 embedding 客户端同样使用之，
            # 避免环境变量缺 key 时构造 OpenAI 客户端直接抛错
            self.router = SemanticRouter(
                openai_api_key=api_key,
                openai_base_url=base_url,
            )
            logger.info(f"{get_request_id()}使用语义路由器（关键词匹配）进行意图识别")

        self.general_agent = GeneralAgent(
            model_type=model_type,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
        )
        self.sql_agent = SQLAgent(
            model_type=model_type,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
        )
        self.code_agent = GeneralAgent(
            model_type=model_type,
            model_name=model_name,
            api_key=api_key,
            base_url=base_url,
        )
        self.workflow = self._build_workflow()
        logger.info(f"{get_request_id()}LangGraphSupervisor 初始化完成")

    def _build_workflow(self) -> CompiledStateGraph:
        workflow = StateGraph(SupervisorState)

        workflow.add_node("router", self._router_node)
        workflow.add_node("general_agent", self._general_agent_node)
        workflow.add_node("sql_agent", self._sql_agent_node)
        workflow.add_node("code_agent", self._code_agent_node)

        workflow.set_entry_point("router")

        workflow.add_conditional_edges(
            "router",
            self._decide_next_agent,
            {
                "general": "general_agent",
                "sql": "sql_agent",
                "code": "code_agent",
                "end": END,
            },
        )

        workflow.add_edge("general_agent", END)
        workflow.add_edge("sql_agent", END)
        workflow.add_edge("code_agent", END)

        return workflow.compile()

    async def _router_node(self, state: SupervisorState) -> dict:
        query = state.get("query", "")

        if not query:
            return {"error": "用户问题为空", "intent": "end"}

        try:
            intent, confidence = await self.router.route(query)
            route_info = self.router.get_route_info(intent)
            target_agent = route_info.get("agent", "general_agent")

            logger.info(
                f"{get_request_id()}[语义路由] 用户输入: '{query[:100]}{'...' if len(query) > 100 else ''}' "
                f"-> 意图: '{intent}' -> 命中 Agent: '{target_agent}' (置信度: {confidence})"
            )

            return {
                "intent": intent,
                "confidence": confidence,
                "system_prompt": route_info.get("system_prompt", DEFAULT_SYSTEM_PROMPT),
            }
        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [supervisor._router_node] | "
                f"原因: {type(e).__name__}: {e}"
            )
            return {
                "error": f"路由失败: {str(e)}",
                "intent": "general",
                "confidence": 0.0,
            }

    async def _general_agent_node(self, state: SupervisorState) -> dict:
        query = state.get("query", "")
        context = state.get("context", [])
        system_prompt = state.get("system_prompt", DEFAULT_SYSTEM_PROMPT)

        try:
            response, thinking = await self.general_agent.chat(
                query=query,
                context=context,
                system_prompt=system_prompt,
            )

            return {
                "response": response,
                "thinking": thinking,
                "model_name": self.general_agent.model_name,
            }
        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [supervisor._general_agent_node] | "
                f"model={self.general_agent.model_name}, "
                f"base_url={self.general_agent.base_url} | "
                f"原因: {type(e).__name__}: {e}"
            )
            return {
                "error": f"处理失败: {str(e)}",
                "response": friendly_llm_error(e, self.general_agent.model_name),
            }

    async def _sql_agent_node(self, state: SupervisorState) -> dict:
        query = state.get("query", "")

        try:
            result = await self.sql_agent.query(question=query)

            if result.get("success"):
                return {
                    "response": result.get("answer", ""),
                    "thinking": result.get("thinking", ""),
                    "model_name": self.sql_agent.model_name,
                }
            else:
                return {
                    "error": result.get("error", "SQL 查询失败"),
                    "response": result.get("answer", "抱歉，无法完成数据库查询。"),
                }

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [supervisor._sql_agent_node] | "
                f"model={self.sql_agent.model_name}, "
                f"base_url={self.sql_agent.base_url} | "
                f"原因: {type(e).__name__}: {e}"
            )
            return {
                "error": f"SQL 处理失败: {str(e)}",
                "response": friendly_llm_error(e, self.sql_agent.model_name),
            }

    async def _code_agent_node(self, state: SupervisorState) -> dict:
        query = state.get("query", "")
        context = state.get("context", [])

        code_system_prompt = state.get(
            "system_prompt",
            """你是一个专业的编程专家，专注于帮助用户编写高质量的代码。

你的职责包括：
1. 理解用户的编程需求
2. 编写清晰、高效、可维护的代码
3. 提供必要的代码注释和解释
4. 考虑边界情况和错误处理
5. 遵循最佳实践和设计模式

请在 <thinking></thinking> 标签中先思考：
- 用户想要实现什么功能？
- 需要使用什么技术栈？
- 有哪些需要注意的问题？
- 如何组织代码结构？

然后提供完整的代码实现。""",
        )

        try:
            response, thinking = await self.code_agent.chat(
                query=query,
                context=context,
                system_prompt=code_system_prompt,
            )

            return {
                "response": response,
                "thinking": thinking,
                "model_name": self.code_agent.model_name,
            }
        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [supervisor._code_agent_node] | "
                f"model={self.code_agent.model_name}, "
                f"base_url={self.code_agent.base_url} | "
                f"原因: {type(e).__name__}: {e}"
            )
            return {
                "error": f"代码生成失败: {str(e)}",
                "response": friendly_llm_error(e, self.code_agent.model_name),
            }

    def _decide_next_agent(self, state: SupervisorState) -> str:
        intent = state.get("intent", "general") or "general"
        error = state.get("error")

        if error and intent == "end":
            return "end"

        return intent

    @staticmethod
    def _build_injected_prompt(prompt_content: Optional[str]) -> Optional[str]:
        """用户上传的 Markdown 文件作为系统提示词注入；仅文本前缀，不破坏既有路由逻辑。"""
        if not prompt_content or not prompt_content.strip():
            return None
        return (
            "以下是用户上传的 Markdown 提示词文件内容，请在回答时严格遵循其中的指令与约束：\n\n"
            "----- BEGIN UPLOADED PROMPT -----\n"
            f"{prompt_content}\n"
            "----- END UPLOADED PROMPT -----\n"
        )

    async def process(
        self,
        query: str,
        model_type: Optional[str] = None,
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        conversation_id: Optional[str] = None,
        context: Optional[List[Dict[str, str]]] = None,
        db_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        prompt_content: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not conversation_id:
            conversation_id = str(uuid.uuid4())

        model_type = model_type or self.model_type
        model_name = model_name or self.model_name

        injected_system_prompt = self._build_injected_prompt(prompt_content)

        if agent_type and agent_type in ["general", "sql", "code"]:
            logger.info(f"{get_request_id()}[直接调用] 用户指定 Agent: '{agent_type}'")

            if agent_type == "sql":
                sql_agent = SQLAgent(
                    model_type=model_type,
                    model_name=model_name,
                    api_key=api_key,
                    base_url=base_url,
                    db_name=db_name,
                )
                sql_question = query
                if injected_system_prompt:
                    # SQL Agent 使用固定系统提示词，将上传的 Markdown 作为问题上下文前缀注入
                    sql_question = (
                        f"【参考提示词】\n{prompt_content}\n\n【用户问题】\n{query}"
                    )
                try:
                    result = await sql_agent.query(question=sql_question)
                    return {
                        "success": True,
                        "response": result.get("response", ""),
                        "thinking": result.get("thinking", ""),
                        "intent": "sql",
                        "confidence": 1.0,
                        "conversation_id": conversation_id,
                        "model_used": model_name or "sql_agent",
                        "error": None,
                    }
                except Exception as e:
                    logger.error(
                        f"{get_request_id()}SQL Agent 处理失败: {e}", exc_info=True
                    )
                    return {
                        "success": False,
                        "response": friendly_llm_error(e, model_name or ""),
                        "thinking": "",
                        "intent": "sql",
                        "confidence": 1.0,
                        "conversation_id": conversation_id,
                        "model_used": model_name or "sql_agent",
                        "error": str(e),
                    }
            elif agent_type == "code":
                code_agent = GeneralAgent(
                    model_type=model_type,
                    model_name=model_name,
                    api_key=api_key,
                    base_url=base_url,
                )
                code_system_prompt = """你是一个专业的编程专家，专注于帮助用户编写高质量的代码。

你的职责包括：
1. 理解用户的编程需求
2. 编写清晰、高效、可维护的代码
3. 提供必要的代码注释和解释
4. 考虑边界情况和错误处理
5. 遵循最佳实践和设计模式

请在 <thinking></thinking> 标签中先思考，然后提供完整的代码实现。"""
                if injected_system_prompt:
                    code_system_prompt = f"{injected_system_prompt}\n{code_system_prompt}"
                try:
                    response, thinking = await code_agent.chat(
                        query=query,
                        context=context,
                        system_prompt=code_system_prompt,
                    )
                    return {
                        "success": True,
                        "response": response,
                        "thinking": thinking,
                        "intent": "code",
                        "confidence": 1.0,
                        "conversation_id": conversation_id,
                        "model_used": model_name or "code_agent",
                        "error": None,
                    }
                except Exception as e:
                    logger.error(
                        f"{get_request_id()}Code Agent 处理失败: {e}", exc_info=True
                    )
                    return {
                        "success": False,
                        "response": friendly_llm_error(e, model_name or ""),
                        "thinking": "",
                        "intent": "code",
                        "confidence": 1.0,
                        "conversation_id": conversation_id,
                        "model_used": model_name or "code_agent",
                        "error": str(e),
                    }
            else:
                general_agent = GeneralAgent(
                    model_type=model_type,
                    model_name=model_name,
                    api_key=api_key,
                    base_url=base_url,
                )
                general_system_prompt = DEFAULT_SYSTEM_PROMPT
                if injected_system_prompt:
                    general_system_prompt = f"{injected_system_prompt}\n{general_system_prompt}"
                try:
                    response, thinking = await general_agent.chat(
                        query=query,
                        context=context,
                        system_prompt=general_system_prompt,
                    )
                    return {
                        "success": True,
                        "response": response,
                        "thinking": thinking,
                        "intent": "general",
                        "confidence": 1.0,
                        "conversation_id": conversation_id,
                        "model_used": model_name or "general_agent",
                        "error": None,
                    }
                except Exception as e:
                    logger.error(
                        f"{get_request_id()}General Agent 处理失败: {e}", exc_info=True
                    )
                    return {
                        "success": False,
                        "response": friendly_llm_error(e, model_name or ""),
                        "thinking": "",
                        "intent": "general",
                        "confidence": 1.0,
                        "conversation_id": conversation_id,
                        "model_used": model_name or "general_agent",
                        "error": str(e),
                    }

        initial_state: SupervisorState = {
            "messages": [],
            "query": query,
            "intent": None,
            "confidence": None,
            "response": None,
            "thinking": None,
            "error": None,
            "conversation_id": conversation_id,
            "model_type": model_type,
            "model_name": model_name,
            "context": context or [],
            "system_prompt": DEFAULT_SYSTEM_PROMPT,
        }

        try:
            result = await self.workflow.ainvoke(initial_state)

            return {
                "success": result.get("error") is None,
                "response": result.get("response", ""),
                "thinking": result.get("thinking", ""),
                "intent": result.get("intent", ""),
                "confidence": result.get("confidence", 0.0),
                "conversation_id": conversation_id,
                "model_used": result.get("model_name", ""),
                "error": result.get("error"),
            }
        except Exception as e:
            logger.error(f"{get_request_id()}Supervisor 处理失败: {e}", exc_info=True)
            return {
                "success": False,
                "response": f"抱歉，处理您的请求时出现错误: {str(e)}",
                "thinking": "",
                "intent": "",
                "confidence": 0.0,
                "conversation_id": conversation_id,
                "model_used": "",
                "error": str(e),
            }

    async def stream_process(
        self,
        query: str,
        model_type: Optional[str] = None,
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        conversation_id: Optional[str] = None,
        context: Optional[List[Dict[str, str]]] = None,
        db_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        prompt_content: Optional[str] = None,
    ):
        if not conversation_id:
            conversation_id = str(uuid.uuid4())

        model_type = model_type or self.model_type
        model_name = model_name or self.model_name

        # 用户上传的 Markdown 文件作为系统提示词注入；仅文本前缀，不破坏既有路由逻辑
        injected_system_prompt = self._build_injected_prompt(prompt_content)

        if agent_type and agent_type in ["general", "sql", "code"]:
            intent = agent_type
            confidence = 1.0
            route_info = (
                self.router.get_route_info(intent)
                if hasattr(self.router, "get_route_info")
                else {}
            )
            target_agent = f"{agent_type}_agent"

            logger.info(
                f"{get_request_id()}[直接调用-流式] 用户指定 Agent: '{agent_type}'"
            )
        else:
            intent, confidence = await self.router.route(query)

            route_info = self.router.get_route_info(intent)
            target_agent = route_info.get("agent", "general_agent")

            logger.info(
                f"{get_request_id()}[{('LLM路由' if self.use_llm_router else '语义路由')}-流式] 用户输入: '{query[:100]}{'...' if len(query) > 100 else ''}' "
                f"-> 意图: '{intent}' -> 命中 Agent: '{target_agent}' (置信度: {confidence})"
            )

        yield {
            "type": "intent",
            "content": intent,
            "confidence": confidence,
            "conversation_id": conversation_id,
        }

        if intent == "sql":
            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
                db_name=db_name,
            )

            sql_question = query
            if injected_system_prompt:
                # SQL Agent 使用固定系统提示词，将上传的 Markdown 作为问题上下文前缀注入
                sql_question = (
                    f"【参考提示词】\n{prompt_content}\n\n【用户问题】\n{query}"
                )
            async for chunk in sql_agent.stream_query(question=sql_question):
                chunk["conversation_id"] = conversation_id
                yield chunk
        elif intent == "code":
            code_agent = GeneralAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
            )
            code_system_prompt = route_info.get(
                "system_prompt",
                """你是一个专业的编程专家，专注于帮助用户编写高质量的代码。

你的职责包括：
1. 理解用户的编程需求
2. 编写清晰、高效、可维护的代码
3. 提供必要的代码注释和解释
4. 考虑边界情况和错误处理
5. 遵循最佳实践和设计模式

请在 <thinking></thinking> 标签中先思考，然后提供完整的代码实现。""",
            )
            if injected_system_prompt:
                code_system_prompt = f"{injected_system_prompt}\n{code_system_prompt}"
            async for chunk in code_agent.stream_chat(
                query=query,
                context=context,
                system_prompt=code_system_prompt,
            ):
                chunk["conversation_id"] = conversation_id
                yield chunk
        else:
            agent = GeneralAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=api_key,
                base_url=base_url,
            )

            base_system_prompt = route_info.get("system_prompt", DEFAULT_SYSTEM_PROMPT)
            if injected_system_prompt:
                base_system_prompt = f"{injected_system_prompt}\n{base_system_prompt}"
            async for chunk in agent.stream_chat(
                query=query,
                context=context,
                system_prompt=base_system_prompt,
            ):
                chunk["conversation_id"] = conversation_id
                yield chunk


_supervisor_cache: Dict[str, LangGraphSupervisor] = {}
_router_cache: Dict[str, SemanticRouter] = {}


def _make_cache_key(*args: str) -> str:
    """根据参数生成缓存键，确保相同参数复用实例，不同参数创建新实例。"""
    return "/".join(args) if args else "default"


def get_supervisor(
    model_type: str = "external",
    model_name: Optional[str] = None,
    use_llm_router: bool = False,
    force_new: bool = False,
) -> LangGraphSupervisor:
    key = _make_cache_key(model_type, model_name or "", str(use_llm_router))
    if force_new or key not in _supervisor_cache:
        _supervisor_cache[key] = LangGraphSupervisor(
            model_type=model_type,
            model_name=model_name,
            use_llm_router=use_llm_router,
        )
        logger.info(
            f"{get_request_id()}Supervisor 实例创建: key='{key}', "
            f"当前缓存数={len(_supervisor_cache)}"
        )
    return _supervisor_cache[key]


def get_router(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    embedding_model: Optional[str] = None,
    force_new: bool = False,
) -> SemanticRouter:
    key = _make_cache_key(api_key or "", base_url or "", embedding_model or "")
    if force_new or key not in _router_cache:
        _router_cache[key] = SemanticRouter(
            openai_api_key=api_key,
            openai_base_url=base_url,
            embedding_model=embedding_model,
        )
        logger.info(
            f"{get_request_id()}Router 实例创建: key='{key[:20]}...', "
            f"当前缓存数={len(_router_cache)}"
        )
    return _router_cache[key]


Orchestrator = LangGraphSupervisor
SemanticRouterAgent = SemanticRouter


def get_orchestrator(
    model_type: str = "external",
    model_name: Optional[str] = None,
) -> Orchestrator:
    return get_supervisor(model_type=model_type, model_name=model_name)
