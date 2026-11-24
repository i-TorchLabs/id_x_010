import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.agents.x_llm_error import (
    DEFAULT_EXTERNAL_MODEL,
    friendly_llm_error,
    is_read_timeout,
    is_transient_llm_error,
    with_llm_retry,
)
from x_models.id_x_010.src.models.x_models import (
    get_external_model_config,
    get_local_model_config,
)

try:
    # langgraph.prebuilt.create_react_agent 提供 ReAct 工具调用循环。
    # 缺失（如 langgraph 未安装或版本过旧）时降级为直接 LLM 调用，
    # GeneralAgent 仍可用，仅失去 tool_call 能力。
    from langgraph.prebuilt import create_react_agent as _create_react_agent

    LANGGRAPH_REACT_AVAILABLE = True
except ImportError:  # pragma: no cover
    _create_react_agent = None  # type: ignore[assignment]
    LANGGRAPH_REACT_AVAILABLE = False


# 模块级共享 httpx client（_stream_llm_raw 使用）：
# 每请求新建 AsyncClient 会重复 TCP+TLS 握手（百毫秒级）。
# 共享实例 + 连接池复用消除该开销；进程退出时由 OS 回收。
_shared_http_client = None

# 【稳定性】流式读超时（相邻 SSE chunk 之间的最长等待）。
# 默认 120s 对 reasoning 模型（claude-opus-5 等）不够：思考阶段网关可能
# 整段缓冲 reasoning 内容不逐 token 下发，静默期 = 完整思考时长，
# 长问题思考 >2min 即触发 httpx.ReadTimeout（实测 6m33s 三层降级全灭）。
# 300s 覆盖绝大多数思考静默；可通过环境变量 STREAM_READ_TIMEOUT 调整。
_STREAM_READ_TIMEOUT = float(os.getenv("STREAM_READ_TIMEOUT", "300"))


def _get_shared_http_client():
    global _shared_http_client
    if _shared_http_client is None:
        import httpx

        _shared_http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(_STREAM_READ_TIMEOUT, connect=10.0),
            limits=httpx.Limits(
                max_connections=100, max_keepalive_connections=20
            ),
        )
    return _shared_http_client


class StreamingHandler(AsyncCallbackHandler):
    def __init__(self):
        self.tokens = []
        self.thinking_tokens = []
        self.in_thinking = False

    async def on_llm_new_token(self, token: str | list[str | dict[str, Any]], **kwargs):
        if isinstance(token, list):
            token = "".join(
                item if isinstance(item, str) else str(item) for item in token
            )

        if "<thinking>" in token:
            self.in_thinking = True
            token = token.replace("<thinking>", "")
        elif "</thinking>" in token:
            self.in_thinking = False
            token = token.replace("</thinking>", "")

        if self.in_thinking:
            self.thinking_tokens.append(token)
        else:
            self.tokens.append(token)


class _ThinkingTagStreamParser:
    """跨 chunk 解析 <thinking></thinking> 标签的流式分流器。

    流式 token 会把标签拆碎（实测如 "<" + "th" + "inking>\\n用"），逐 token 的
    `if "<thinking>" in token` 检测永远匹配不到，导致标签原文和思考内容
    全部以 content 下发，前端解析后正文为空、气泡空白。

    本类维护一个小缓冲：完整标签出现时立即切换分流状态；缓冲尾部疑似
    标签前缀（如 "<"、"</think"）时先扣住，等后续 token 拼接后再判定；
    其余文本原样放行，保证流式低延迟。流结束时调用 flush() 吐出残留。

    标签开/关各只打一条 info 日志，避免按 token 刷屏，便于追踪思考分流是否生效。
    """

    _OPEN = "<thinking>"
    _CLOSE = "</thinking>"

    def __init__(self) -> None:
        self._buffer = ""
        self.in_thinking = False
        self._open_logged = False
        self._close_logged = False
        self.thinking_chars = 0
        self.content_chars = 0

    def _channel(self) -> str:
        return "thinking" if self.in_thinking else "content"

    def _partial_suffix_len(self) -> int:
        """缓冲尾部与标签前缀的最长匹配长度（需扣住等待后续 token）。"""
        max_len = min(len(self._buffer), len(self._CLOSE) - 1)
        for length in range(max_len, 0, -1):
            suffix = self._buffer[-length:]
            if self._OPEN.startswith(suffix) or self._CLOSE.startswith(suffix):
                return length
        return 0

    def _track(self, channel: str, text: str) -> None:
        if channel == "thinking":
            self.thinking_chars += len(text)
        else:
            self.content_chars += len(text)

    def feed(self, token: str) -> List[Tuple[str, str]]:
        self._buffer += token
        out: List[Tuple[str, str]] = []
        while self._buffer:
            tag = self._CLOSE if self.in_thinking else self._OPEN
            idx = self._buffer.find(tag)
            if idx != -1:
                text = self._buffer[:idx]
                if text:
                    channel = self._channel()
                    self._track(channel, text)
                    out.append((channel, text))
                self._buffer = self._buffer[idx + len(tag):]
                entering = not self.in_thinking
                self.in_thinking = not self.in_thinking
                if entering and not self._open_logged:
                    self._open_logged = True
                    logger.info(
                        f"{get_request_id()}[对话解析] thinking 标签开启，"
                        f"后续 token 分流到 thinking 通道"
                    )
                elif not entering and not self._close_logged:
                    self._close_logged = True
                    logger.info(
                        f"{get_request_id()}[对话解析] thinking 标签关闭，"
                        f"后续 token 分流到 content 通道"
                    )
                continue
            keep = self._partial_suffix_len()
            emit_end = len(self._buffer) - keep
            if emit_end > 0:
                channel = self._channel()
                text = self._buffer[:emit_end]
                self._track(channel, text)
                out.append((channel, text))
                self._buffer = self._buffer[emit_end:]
            break
        return out

    def flush(self) -> List[Tuple[str, str]]:
        out: List[Tuple[str, str]] = []
        if self._buffer:
            # 流被上游截断时，暂扣的残留可能是纯标签前缀（如 "<thin"、"</think"）。
            # 这类残片是标签语法而非正文，下发会在前端渲染成乱码——丢弃。
            # 仅保留单个 "<"（可能是正文中的小于号，误杀代价更高）。
            is_tag_fragment = len(self._buffer) >= 2 and (
                self._OPEN.startswith(self._buffer)
                or self._CLOSE.startswith(self._buffer)
            )
            if not is_tag_fragment:
                channel = self._channel()
                self._track(channel, self._buffer)
                out.append((channel, self._buffer))
            elif self._buffer:
                logger.debug(
                    f"{get_request_id()}[对话解析] flush 丢弃标签残片: "
                    f"{self._buffer!r}"
                )
            self._buffer = ""
        return out

    def summary(self) -> str:
        return (
            f"thinking_tag_seen={self._open_logged} "
            f"thinking_chars={self.thinking_chars} content_chars={self.content_chars}"
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


def _extract_reasoning(chunk: Any) -> str:
    """TASK-015: 从 LLM 流式 chunk 中提取 reasoning_content。

    reasoning 模型（GLM-5.2 / DeepSeek-R1 / o1 等）通过 SiliconFlow 等 OpenAI
    兼容端点流式响应时,思考过程的 token 在 `reasoning_content` 字段而非 `content`。
    langchain_openai 的 ChatOpenAI 默认不解析该字段——这里手动探测多个可能位置:
      1. chunk.reasoning_content（部分自定义 chunk 类型直接挂该属性）
      2. chunk.additional_kwargs['reasoning_content']（langchain_openai 常见存放点）
      3. chunk.response_metadata['reasoning_content']（部分版本放这里）

    返回空串表示无 reasoning 内容,调用方按无 token 处理。
    """
    try:
        # 1. 直接属性
        reasoning = getattr(chunk, "reasoning_content", None)
        if reasoning:
            return reasoning if isinstance(reasoning, str) else str(reasoning)
        # 2. additional_kwargs
        additional = getattr(chunk, "additional_kwargs", None)
        if isinstance(additional, dict):
            reasoning = additional.get("reasoning_content") or additional.get(
                "reasoning"
            )
            if reasoning:
                return reasoning if isinstance(reasoning, str) else str(reasoning)
        # 3. response_metadata
        metadata = getattr(chunk, "response_metadata", None)
        if isinstance(metadata, dict):
            reasoning = metadata.get("reasoning_content") or metadata.get(
                "reasoning"
            )
            if reasoning:
                return reasoning if isinstance(reasoning, str) else str(reasoning)
    except Exception:
        pass
    return ""


class GeneralAgent:
    EXTERNAL_MODELS = {
        "gpt-4o": "openai/gpt-4o",
        "gpt-4o-mini": "openai/gpt-4o-mini",
        "claude-3.5-sonnet": "anthropic/claude-3.5-sonnet",
        "deepseek-chat": "deepseek/deepseek-chat",
        "llama-3.1-70b": "meta-llama/llama-3.1-70b-instruct",
    }

    LOCAL_MODELS = {
        "qwen2.5": "qwen2.5",
        "llama3.1": "llama3.1",
        "deepseek-r1": "deepseek-r1",
    }

    def __init__(
        self,
        model_type: str = "external",
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        self.model_type = model_type

        external_config = get_external_model_config()

        self.model_name = (
            model_name
            or external_config.get("model_name")
            or os.getenv("EXTERNAL_LLM_MODEL")
            or self._get_default_model(model_type)
        )
        self.api_key = (
            api_key or external_config.get("api_key")
        )
        self.base_url = (
            base_url
            or external_config.get("base_url")
        )

        self.llm = self._create_llm()
        # ReAct Agent：绑定工具集；LANGGRAPH_REACT_AVAILABLE=False 时降级 None，
        # chat/stream_chat 自动回退到直接 LLM 调用，保持原有 thinking 标签解析
        self.agent = None
        self._react_enabled = False
        # 【性能】ReAct 流式可用性记忆（None=未探测，True=可用，False=不可用）：
        # reasoning 模型（claude-fable-5 / GLM 等）token 全在 reasoning_content
        # 时 langchain 丢弃 → ReAct 路径产出 0 token。首次探测失败后记住，
        # 后续请求直接走 raw httpx，不再每次白付一次注定失败的 LLM 调用
        # （实例经 supervisor 缓存按 模型+端点 复用，记忆随之生效）。
        self._react_stream_ok: Optional[bool] = None
        try:
            if LANGGRAPH_REACT_AVAILABLE:
                from x_models.id_x_010.src.agents.tools import ALL_TOOLS

                if ALL_TOOLS:
                    self.agent = _create_react_agent(self.llm, ALL_TOOLS)
                    self._react_enabled = True
                    logger.info(
                        f"{get_request_id()}GeneralAgent ReAct 模式启用，工具数={len(ALL_TOOLS)}"
                    )
        except Exception as e:
            # 工具加载失败不阻塞 Agent 实例化，降级为纯 LLM 模式
            logger.warning(
                f"{get_request_id()}GeneralAgent ReAct 启用失败，降级纯 LLM: "
                f"{type(e).__name__}: {e}"
            )
            self.agent = None
            self._react_enabled = False

        logger.info(
            f"{get_request_id()}GeneralAgent 初始化完成: model_type={model_type}, model_name={self.model_name}, react={self._react_enabled}"
        )

    def _get_default_model(self, model_type: str) -> str:
        if model_type == "external":
            return DEFAULT_EXTERNAL_MODEL
        else:
            return "qwen2.5"

    def _create_llm(self, temperature: float = 0.7) -> ChatOpenAI:
        if self.model_type == "external":
            model_identifier = self.EXTERNAL_MODELS.get(
                self.model_name, self.model_name
            )
            return ChatOpenAI(
                model=model_identifier,
                api_key=SecretStr(self.api_key) if self.api_key else None,
                base_url=self.base_url,
                temperature=temperature,
                streaming=True,
                # 让 OpenAI 兼容端点在流式末块返回 token 用量；
                # 不支持的端点会忽略该参数，捕获逻辑降级为 0（非致命）
                stream_usage=True,
                # 性能/稳定性：限定超时与重试，避免默认 2 次静默重试
                # 把瞬时错误放大成双倍延迟、以及无超时的卡死。
                # timeout 同时约束请求超时与 per-chunk 空闲
                # （langchain_openai 1.7.x 默认 stream_chunk_timeout=120s，
                # reasoning 模型思考静默 >2min 会 ReadTimeout，见
                # _STREAM_READ_TIMEOUT 说明），统一放宽到 300s
                # max_retries=0：瞬时重试统一交给 with_llm_retry，避免叠乘
                timeout=_STREAM_READ_TIMEOUT,
                stream_chunk_timeout=_STREAM_READ_TIMEOUT,
                max_retries=0,
            )
        else:
            local_config = get_local_model_config()
            local_base_url = local_config.get("base_url")
            local_api_key = local_config.get("api_key") or "ollama"

            return ChatOpenAI(
                model=self.LOCAL_MODELS.get(self.model_name, self.model_name),
                api_key=SecretStr(local_api_key),
                base_url=local_base_url,
                temperature=temperature,
                streaming=True,
                # 本地模型不计费，但 token 用量仍需统计/展示；
                # 端点不支持时会忽略该参数，降级为无用量（非致命）
                stream_usage=True,
                timeout=_STREAM_READ_TIMEOUT,
                stream_chunk_timeout=_STREAM_READ_TIMEOUT,
                max_retries=0,
            )

    @staticmethod
    def _is_temp_error(err: Exception) -> bool:
        """判断异常是否为 temperature 限制错误（reasoning 模型只允许 1）。"""
        lower = str(err).lower()
        return "temperature" in lower and (
            "only 1 is allowed" in lower or "invalid" in lower
        )

    @staticmethod
    def _is_read_timeout(err: Exception) -> bool:
        """【稳定性】判断是否为"上游静默"型超时（ReadTimeout/StreamChunkTimeout）。

        reasoning 模型思考阶段网关可能长时间不吐任何 SSE 字节，各条降级
        路径（ReAct / raw httpx / langchain）撞的都是同一堵墙——重试只会
        让模型从头再思考一遍再超时一次（实测 6m33s 三层全灭、0 token）。
        该类错误应快速失败报错给用户，不再串行重试。
        """
        return is_read_timeout(err)

    async def _stream_llm_raw(
        self, messages: List[Any], temperature: float = 0.7
    ) -> AsyncGenerator[Tuple[str, str], None]:
        """TASK-015: 绕过 langchain 直接调用 OpenAI 兼容端点。

        langchain_openai 1.6.7+ 明确不解析 reasoning_content 字段（官方文档说明
        "Non-standard response fields added by third-party providers are not
        extracted"）。SiliconFlow + GLM-5.2 等 reasoning 模型的流式 token 全在
        reasoning_content，被 langchain 丢弃导致只有 done 没有 content。

        本方法用 httpx 直接调 /v1/chat/completions stream，手动解析 SSE：
          - delta.reasoning_content → yield ("thinking", token)
          - delta.content           → yield ("content", token)

        保留了 temperature 重试（reasoning 模型只允许 1）的能力由调用方处理。
        """
        import json as _json

        payload_messages = []
        for msg in messages:
            if isinstance(msg, SystemMessage):
                payload_messages.append({"role": "system", "content": msg.content})
            elif isinstance(msg, HumanMessage):
                payload_messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                payload_messages.append(
                    {"role": "assistant", "content": msg.content}
                )

        url = f"{self.base_url}/chat/completions"
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": self.EXTERNAL_MODELS.get(self.model_name, self.model_name),
            "messages": payload_messages,
            "stream": True,
            "temperature": temperature,
            # OpenAI 兼容端点的标准用量参数：流式末块附带 usage。
            # 之前误用 langchain 专属的 stream_usage 参数，端点不识别导致
            # usage 永远为空 → 气泡 token 展示与 usage_logs 计费全部为 0。
            "stream_options": {"include_usage": True},
        }

        # 建连级瞬时失败可重试；一旦已向下游产出 token 则不再重试，避免重复内容
        _attempts = 3
        _base_delay = 0.5
        last_err: Optional[Exception] = None
        for attempt in range(1, _attempts + 1):
            raw_usage = None
            produced = False
            try:
                # 复用模块级共享 client：每请求新建 AsyncClient 会重复 TCP+TLS 握手
                # （百毫秒级），连接池复用后消除该开销
                client = _get_shared_http_client()
                async with client.stream(
                    "POST", url, json=body, headers=headers
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line or not line.startswith("data: "):
                            continue
                        data = line[6:]
                        if data.strip() == "[DONE]":
                            break
                        try:
                            chunk = _json.loads(data)
                            # 用量必须在 choices 判空之前读取：include_usage 的末块
                            # choices 为空数组，之前先 continue 导致 usage 永远读不到
                            usage = chunk.get("usage")
                            if isinstance(usage, dict):
                                raw_usage = {
                                    "input_tokens": usage.get("prompt_tokens", 0) or 0,
                                    "output_tokens": usage.get(
                                        "completion_tokens", 0
                                    )
                                    or 0,
                                    "total_tokens": usage.get("total_tokens", 0) or 0,
                                }
                            choices = chunk.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta") or {}
                            # 【修复】reasoning 字段兼容：不同网关对思考流的翻译不一——
                            # SiliconFlow/DeepSeek 用 reasoning_content，部分 one-api
                            # 渠道翻译 Anthropic 协议（claude 系模型）时用 reasoning
                            # 或 thinking。三个名字都接，避免 claude-fable-5 这类模型
                            # 的 token 在 raw 路径也被丢弃。
                            reasoning = (
                                delta.get("reasoning_content")
                                or delta.get("reasoning")
                                or delta.get("thinking")
                            )
                            content = delta.get("content")
                            if reasoning:
                                produced = True
                                yield (
                                    "thinking",
                                    reasoning
                                    if isinstance(reasoning, str)
                                    else str(reasoning),
                                )
                            if content:
                                # content 可能是字符串，也可能是 Claude 风格的内容块
                                # 列表 [{"type":"thinking","thinking":...},
                                # {"type":"text","text":...}]——按块类型分流
                                if isinstance(content, list):
                                    for block in content:
                                        if not isinstance(block, dict):
                                            if str(block):
                                                produced = True
                                                yield ("content", str(block))
                                            continue
                                        btype = block.get("type")
                                        if btype == "thinking":
                                            t = block.get("thinking") or ""
                                            if t:
                                                produced = True
                                                yield ("thinking", t)
                                        else:
                                            t = block.get("text")
                                            if t:
                                                produced = True
                                                yield ("content", t)
                                elif isinstance(content, str):
                                    produced = True
                                    yield ("content", content)
                        except (_json.JSONDecodeError, KeyError, IndexError):
                            continue

                if raw_usage is not None:
                    yield ("usage", _json.dumps(raw_usage))
                return
            except Exception as e:
                last_err = e
                if (
                    produced
                    or attempt >= _attempts
                    or not is_transient_llm_error(e)
                ):
                    raise
                delay = _base_delay * (2 ** (attempt - 1))
                logger.warning(
                    f"{get_request_id()}[对话解析] raw stream 建连重试 "
                    f"attempt={attempt}/{_attempts} delay_s={delay:.1f} "
                    f"model={self.model_name} error={type(e).__name__}: {e}"
                )
                await asyncio.sleep(delay)
        if last_err is not None:
            raise last_err

    async def chat(
        self,
        query: str,
        context: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Tuple[str, str]:
        messages = []

        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))

        if context:
            for msg in context:
                if msg.get("role") == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                elif msg.get("role") == "assistant":
                    messages.append(AIMessage(content=msg["content"]))

        messages.append(HumanMessage(content=query))

        _started = time.perf_counter()

        # ReAct 模式：交给自带的工具调用循环。失败时降级走纯 LLM 路径
        if self._react_enabled and self.agent is not None:
            try:
                response = await with_llm_retry(
                    lambda: self.agent.ainvoke({"messages": messages}),
                    attempts=3,
                    label=f"general.react:{self.model_name}",
                )
                final_msg = response["messages"][-1] if response.get("messages") else None
                if isinstance(final_msg, AIMessage):
                    content = final_msg.content
                    if isinstance(content, list):
                        content = "".join(
                            item if isinstance(item, str) else str(item)
                            for item in content
                        )
                    thinking = ""
                    if "<thinking>" in content and "</thinking>" in content:
                        start = content.find("<thinking>") + len("<thinking>")
                        end = content.find("</thinking>")
                        thinking = content[start:end].strip()
                        content = content.replace(
                            content[start - len("<thinking>") : end + len("</thinking>")],
                            "",
                        ).strip()
                    _observe_llm(
                        self.model_name, "general", "success", time.perf_counter() - _started
                    )
                    return content, thinking
            except Exception as e:
                logger.warning(
                    f"{get_request_id()}ReAct chat 失败，降级纯 LLM: "
                    f"{type(e).__name__}: {e}"
                )

        try:
            response = await with_llm_retry(
                lambda: self.llm.ainvoke(messages),
                attempts=3,
                label=f"general.chat:{self.model_name}",
            )
        except Exception as e:
            _observe_llm(
                self.model_name, "general", "error", time.perf_counter() - _started
            )
            # reasoning 模型只允许 temperature=1，回退重试一次
            if self._is_temp_error(e):
                logger.info(
                    f"{get_request_id()}模型限制 temperature=1，回退重试 [chat]: model={self.model_name}"
                )
                self.llm = self._create_llm(temperature=1.0)
                response = await with_llm_retry(
                    lambda: self.llm.ainvoke(messages),
                    attempts=3,
                    label=f"general.chat_temp1:{self.model_name}",
                )
            else:
                logger.error(
                    f"{get_request_id()}第三方模型调用失败 [chat] | model={self.model_name}, model_type={self.model_type}, "
                    f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
                )
                raise

        content = response.content

        if isinstance(content, list):
            content = "".join(
                item if isinstance(item, str) else str(item) for item in content
            )

        thinking = ""
        if "<thinking>" in content and "</thinking>" in content:
            start = content.find("<thinking>") + len("<thinking>")
            end = content.find("</thinking>")
            thinking = content[start:end].strip()
            content = content.replace(
                content[start - len("<thinking>") : end + len("</thinking>")], ""
            ).strip()

        _observe_llm(
            self.model_name, "general", "success", time.perf_counter() - _started
        )
        return content, thinking

    async def stream_chat(
        self,
        query: str,
        context: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        messages = []

        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))

        if context:
            for msg in context:
                if msg.get("role") == "user":
                    messages.append(HumanMessage(content=msg["content"]))
                elif msg.get("role") == "assistant":
                    messages.append(AIMessage(content=msg["content"]))

        messages.append(HumanMessage(content=query))

        _started = time.perf_counter()
        logger.info(
            f"{get_request_id()}[对话解析] GeneralAgent.stream_chat 开始 "
            f"model={self.model_name} ctx_msgs={len(context or [])} "
            f"prompt_chars={len(system_prompt or '')} "
            f"query_chars={len(query or '')} react={bool(self._react_enabled and self.agent)}"
        )
        # TASK-015: 跨 chunk 标签解析器——流式 token 会把 <thinking> 拆碎成
        # "<"+"th"+"inking>"，逐 token 的 `in` 检测匹配不到，导致标签和思考
        # 内容全部走 content 通道，前端解析后气泡空白。
        _react_parser = _ThinkingTagStreamParser()

        # ReAct 模式：通过 astream_events 拿到 token 级流 + tool_call 事件。
        # 先探测 v2（langgraph >=0.2.x 推荐）可用性——某些旧版本只支持 v1。
        # 探测失败降级 v1；运行时异常则降级走下方纯 LLM.astream 路径
        # （保留 thinking 解析契约）。
        # 【性能】_react_stream_ok=False（曾探测到该模型 token 全被 langchain
        # 丢弃）时直接跳过 ReAct 流式，省掉一次注定 0 token 的 LLM 调用。
        if (
            self._react_enabled
            and self.agent is not None
            and self._react_stream_ok is not False
        ):
            events_version = "v2"
            try:
                # 仅创建 aiter 探测，不消费——v2 不支持时构造会抛 TypeError/ValueError
                _probe = self.agent.astream_events({"messages": messages}, version="v2")
                # 探测用生成器须显式关闭，避免悬挂的底层资源
                try:
                    await _probe.aclose()
                except Exception:
                    pass
            except (TypeError, ValueError, AttributeError) as _ve:
                logger.info(
                    f"{get_request_id()}astream_events v2 不可用,降级 v1: "
                    f"{type(_ve).__name__}: {_ve}"
                )
                events_version = "v1"

            try:
                _react_produced = False
                _react_usage = None
                # 性能关键（TASK-016）：reasoning 模型的 token 可能全在
                # reasoning_content 且无法从 langchain chunk 提取——旧逻辑会
                # 白白消费完【整次生成】（秒级~十秒级）后才降级 raw 路径，
                # 造成串行两次完整 LLM 调用（直连 5s → 经程序 20s 的主因）。
                # 现在：连续 N 个"既无 content、无 reasoning、也非 tool_call"
                # 的流 chunk 即判定不可提取，立刻中断第一次流转入 raw 路径。
                _REACT_EMPTY_CHUNK_LIMIT = 24
                _react_empty_chunks = 0
                _evt_stream = self.agent.astream_events(
                    {"messages": messages}, version=events_version
                )
                async for evt in _evt_stream:
                    kind = evt.get("event", "")
                    name = evt.get("name", "")
                    chunk = evt.get("chunk")

                    # Tool 开始：通知前端"正在调用 XX 工具"
                    if kind == "on_tool_start":
                        yield {
                            "type": "tool_call",
                            "content": f"正在调用 {name} 工具",
                            "tool_name": name,
                            "model_used": self.model_name,
                        }
                        continue

                    # Tool 结束：把工具返回摘要也透出，便于前端展示状态
                    if kind == "on_tool_end":
                        try:
                            tool_output = (
                                str(getattr(chunk, "content", chunk))[:200]
                                if chunk is not None
                                else ""
                            )
                        except Exception:
                            tool_output = ""
                        yield {
                            "type": "tool_call",
                            "content": f"{name} 完成",
                            "tool_name": name,
                            "tool_output": tool_output,
                            "model_used": self.model_name,
                        }
                        continue

                    # LLM token 流：v2 用 on_chat_model_stream；
                    # v1 可能用 on_llm_stream 或 on_chat_model_stream，两者都接受
                    if (
                        kind in ("on_chat_model_stream", "on_llm_stream")
                        and chunk is not None
                    ):
                        # 捕获 token 用量：stream_usage=True 时末块携带 usage_metadata
                        _meta = getattr(chunk, "usage_metadata", None)
                        if isinstance(_meta, dict):
                            _react_usage = _meta
                        token = getattr(chunk, "content", "")
                        if isinstance(token, list):
                            token = "".join(
                                item if isinstance(item, str) else str(item)
                                for item in token
                            )

                        # TASK-015: reasoning 模型（GLM-5.2 / DeepSeek-R1 / o1 等）
                        # 流式 token 在 reasoning_content 字段，不在 content。
                        # langchain_openai 不解析该字段——这里手动提取，
                        # 把 reasoning 内容作为 thinking chunk 输出，避免被静默丢弃导致
                        # "只有 done 没有 content" 的前端卡死。
                        if not token:
                            token = _extract_reasoning(chunk)
                            if token:
                                _react_produced = True
                                # reasoning 内容统一走 thinking 通道
                                yield {
                                    "type": "thinking",
                                    "content": token,
                                    "model_used": self.model_name,
                                }
                                continue

                        if not token:
                            # 工具调用期间 content 为空属正常（增量在
                            # tool_call_chunks）——不计入"不可提取"
                            _tc = getattr(chunk, "tool_call_chunks", None) or getattr(
                                chunk, "tool_calls", None
                            )
                            if _tc:
                                _react_empty_chunks = 0
                                continue
                            if not _react_produced:
                                _react_empty_chunks += 1
                                if _react_empty_chunks >= _REACT_EMPTY_CHUNK_LIMIT:
                                    logger.warning(
                                        f"{get_request_id()}ReAct 流连续 "
                                        f"{_react_empty_chunks} 个 chunk 无可提取内容"
                                        f"（疑似 reasoning 模型 token 被 langchain 丢弃），"
                                        f"提前中断转 raw httpx: model={self.model_name}"
                                    )
                                    try:
                                        await _evt_stream.aclose()
                                    except Exception:
                                        pass
                                    break
                            continue

                        for _ch, _text in _react_parser.feed(token):
                            _react_produced = True
                            yield {
                                "type": _ch,
                                "content": _text,
                                "model_used": self.model_name,
                            }
                        continue

                # TASK-015: ReAct path 循环结束。吐出解析器残留（末尾疑似标签
                # 前缀的文本），再判断是否产出过 token。
                # 正常 done + return；否则降级到下方 raw httpx 方法重新调用 LLM。
                # 这处理 reasoning 模型 token 全被 langchain 丢弃的场景。
                for _ch, _text in _react_parser.flush():
                    _react_produced = True
                    yield {
                        "type": _ch,
                        "content": _text,
                        "model_used": self.model_name,
                    }
                if _react_produced:
                    # 流式可用：记住，后续请求不再走 raw 探测兜底
                    self._react_stream_ok = True
                    _elapsed = time.perf_counter() - _started
                    _observe_llm(
                        self.model_name, "general", "success", _elapsed
                    )
                    _in = int((_react_usage or {}).get("input_tokens", 0) or 0)
                    _out = int((_react_usage or {}).get("output_tokens", 0) or 0)
                    logger.info(
                        f"{get_request_id()}[对话解析] GeneralAgent.stream_chat 完成 "
                        f"path=react model={self.model_name} "
                        f"elapsed_ms={int(_elapsed * 1000)} "
                        f"usage=in:{_in}/out:{_out} {_react_parser.summary()}"
                    )
                    yield {
                        "type": "done",
                        "model_used": self.model_name,
                        "usage": _react_usage,
                    }
                    return
                else:
                    # 【性能】0 token：token 疑似全被 langchain 丢弃（reasoning
                    # 模型走 reasoning_content）。记住失败，本实例后续请求直接
                    # 走 raw httpx 路径——不再每轮白付一次完整 LLM 调用
                    self._react_stream_ok = False
                    logger.warning(
                        f"{get_request_id()}ReAct path 产出 0 个 token"
                        f"（reasoning 模型 token 可能被 langchain 丢弃），"
                        f"降级 raw httpx 流式: model={self.model_name}"
                    )
            except Exception as e:
                _observe_llm(
                    self.model_name, "general", "error", time.perf_counter() - _started
                )
                # 事件流本身的异常（网络/协议）不代表流式解析不可用，
                # 不标记 _react_stream_ok=False——下轮仍可尝试 ReAct
                logger.warning(
                    f"{get_request_id()}ReAct stream_chat 失败，降级纯 LLM 流式: "
                    f"{type(e).__name__}: {e}"
                )
                # 【稳定性】上游静默型超时（ReadTimeout）：所有降级路径撞同一堵
                # 墙（模型思考期网关不出字节），继续重试只会把等待时间再乘 N。
                # 直接快速失败，把明确的错误信息交给用户
                if self._is_read_timeout(e):
                    logger.error(
                        f"{get_request_id()}ReAct 路径 ReadTimeout（上游长时间无"
                        f"响应，疑似模型思考静默），跳过降级重试快速失败: "
                        f"model={self.model_name}"
                    )
                    yield {
                        "type": "error",
                        "content": friendly_llm_error(e, self.model_name),
                    }
                    return
                # 不 return，继续走下方原 LLM.astream 路径作为降级

        # TASK-015: 优先用 raw httpx 直接调用，手动解析 reasoning_content。
        # langchain_openai 1.6.7+ 不解析 reasoning_content（GLM-5.2 等 reasoning
        # 模型的 token 全在该字段），导致只有 done 没有 content。
        # raw 方法成功时直接 return；仅在「尚未向客户端产出任何 token」时
        # 才允许降级到下方 langchain astream，避免半截后重复输出。
        _raw_produced = False
        try:
            _raw_parser = _ThinkingTagStreamParser()
            _raw_usage = None
            async for chunk_type, token in self._stream_llm_raw(messages):
                if chunk_type == "usage":
                    try:
                        _raw_usage = json.loads(token)
                    except (json.JSONDecodeError, TypeError):
                        pass
                    continue
                _raw_produced = True
                if chunk_type == "thinking":
                    yield {
                        "type": "thinking",
                        "content": token,
                        "model_used": self.model_name,
                    }
                else:
                    # content 通道可能内嵌被拆碎的 <thinking> 标签，走跨 chunk 解析
                    for _ch, _text in _raw_parser.feed(token):
                        yield {
                            "type": _ch,
                            "content": _text,
                            "model_used": self.model_name,
                        }
            for _ch, _text in _raw_parser.flush():
                _raw_produced = True
                yield {
                    "type": _ch,
                    "content": _text,
                    "model_used": self.model_name,
                }
            if _raw_produced:
                _elapsed = time.perf_counter() - _started
                _observe_llm(
                    self.model_name,
                    "general",
                    "success",
                    _elapsed,
                )
                _in = int((_raw_usage or {}).get("input_tokens", 0) or 0)
                _out = int((_raw_usage or {}).get("output_tokens", 0) or 0)
                logger.info(
                    f"{get_request_id()}[对话解析] GeneralAgent.stream_chat 完成 "
                    f"path=raw_httpx model={self.model_name} "
                    f"elapsed_ms={int(_elapsed * 1000)} "
                    f"usage=in:{_in}/out:{_out} {_raw_parser.summary()}"
                )
                yield {
                    "type": "done",
                    "model_used": self.model_name,
                    "usage": _raw_usage,
                }
                return
        except Exception as _raw_e:
            # 【稳定性】上游静默型超时：raw 路径已等满 _STREAM_READ_TIMEOUT，
            # 降级 langchain astream 只会用同一个端点再等一遍（同样超时）。
            # 直接失败，不再串联第三层重试
            if self._is_read_timeout(_raw_e) and not self._is_temp_error(_raw_e):
                logger.error(
                    f"{get_request_id()}raw httpx 流式 ReadTimeout（上游长时间"
                    f"无响应，疑似模型思考静默），跳过 langchain 降级快速失败: "
                    f"model={self.model_name}"
                )
                _observe_llm(
                    self.model_name, "general", "error", time.perf_counter() - _started
                )
                yield {
                    "type": "error",
                    "content": friendly_llm_error(_raw_e, self.model_name),
                }
                return
            # 已向客户端推过 token：禁止降级 astream，否则会从头再生成导致重复
            if _raw_produced:
                logger.error(
                    f"{get_request_id()}raw 流半截失败且已产出内容，"
                    f"跳过 langchain 降级避免重复输出: "
                    f"model={self.model_name} error={type(_raw_e).__name__}: {_raw_e}"
                )
                _observe_llm(
                    self.model_name, "general", "error", time.perf_counter() - _started
                )
                yield {
                    "type": "error",
                    "content": friendly_llm_error(_raw_e, self.model_name),
                }
                return
            if self._is_temp_error(_raw_e):
                # reasoning 模型 temperature 限制，用 temp=1 重试 raw
                logger.info(
                    f"{get_request_id()}模型限制 temperature=1，raw 重试 [stream_chat]: model={self.model_name}"
                )
                _retry_produced = False
                _retry_parser = _ThinkingTagStreamParser()
                _retry_usage = None
                try:
                    async for chunk_type, token in self._stream_llm_raw(
                        messages, temperature=1.0
                    ):
                        if chunk_type == "usage":
                            try:
                                _retry_usage = json.loads(token)
                            except (json.JSONDecodeError, TypeError):
                                pass
                            continue
                        _retry_produced = True
                        if chunk_type == "thinking":
                            yield {
                                "type": "thinking",
                                "content": token,
                                "model_used": self.model_name,
                            }
                        else:
                            for _ch, _text in _retry_parser.feed(token):
                                yield {
                                    "type": _ch,
                                    "content": _text,
                                    "model_used": self.model_name,
                                }
                    for _ch, _text in _retry_parser.flush():
                        _retry_produced = True
                        yield {
                            "type": _ch,
                            "content": _text,
                            "model_used": self.model_name,
                        }
                    if _retry_produced:
                        _elapsed = time.perf_counter() - _started
                        _observe_llm(
                            self.model_name,
                            "general",
                            "success",
                            _elapsed,
                        )
                        _in = int((_retry_usage or {}).get("input_tokens", 0) or 0)
                        _out = int((_retry_usage or {}).get("output_tokens", 0) or 0)
                        logger.info(
                            f"{get_request_id()}[对话解析] GeneralAgent.stream_chat 完成 "
                            f"path=raw_httpx_retry model={self.model_name} "
                            f"elapsed_ms={int(_elapsed * 1000)} "
                            f"usage=in:{_in}/out:{_out} {_retry_parser.summary()}"
                        )
                        yield {
                            "type": "done",
                            "model_used": self.model_name,
                            "usage": _retry_usage,
                        }
                        return
                except Exception as _retry_e:
                    # 【稳定性】静默型超时 / 已产出内容：快速失败，不再降级第三层
                    if self._is_read_timeout(_retry_e) or _retry_produced:
                        logger.error(
                            f"{get_request_id()}raw 重试失败"
                            f"{'（ReadTimeout）' if self._is_read_timeout(_retry_e) else '（已产出内容）'}"
                            f"，快速失败: model={self.model_name}"
                        )
                        _observe_llm(
                            self.model_name,
                            "general",
                            "error",
                            time.perf_counter() - _started,
                        )
                        yield {
                            "type": "error",
                            "content": friendly_llm_error(_retry_e, self.model_name),
                        }
                        return
                    logger.warning(
                        f"{get_request_id()}raw 重试失败,降级 langchain: "
                        f"{type(_retry_e).__name__}: {_retry_e}"
                    )
            else:
                logger.warning(
                    f"{get_request_id()}raw stream 失败,降级 langchain astream: "
                    f"{type(_raw_e).__name__}: {_raw_e}"
                )

        _lc_parser = _ThinkingTagStreamParser()
        usage_meta = None

        try:
            async for chunk in self.llm.astream(messages):
                token = chunk.content

                if isinstance(token, list):
                    token = "".join(
                        item if isinstance(item, str) else str(item) for item in token
                    )

                # TASK-015: reasoning 模型流式 token 在 reasoning_content 字段。
                # content 为空时提取 reasoning_content 作为 thinking 输出，
                # 避免整流被 if token: 跳过导致只有 done 没有 content。
                if not token:
                    token = _extract_reasoning(chunk)
                    if token:
                        yield {
                            "type": "thinking",
                            "content": token,
                            "model_used": self.model_name,
                        }
                        continue

                # 捕获 token 用量：OpenAI 兼容端点（stream_usage=True）在末块携带
                # usage_metadata；不支持时该属性为 None，降级为 0
                meta = getattr(chunk, "usage_metadata", None)
                if isinstance(meta, dict):
                    usage_meta = meta

                if not token:
                    continue

                for _ch, _text in _lc_parser.feed(token):
                    yield {
                        "type": _ch,
                        "content": _text,
                        "model_used": self.model_name,
                    }

            for _ch, _text in _lc_parser.flush():
                yield {
                    "type": _ch,
                    "content": _text,
                    "model_used": self.model_name,
                }

            _elapsed = time.perf_counter() - _started
            _observe_llm(
                self.model_name, "general", "success", _elapsed
            )
            _in = int((usage_meta or {}).get("input_tokens", 0) or 0)
            _out = int((usage_meta or {}).get("output_tokens", 0) or 0)
            logger.info(
                f"{get_request_id()}[对话解析] GeneralAgent.stream_chat 完成 "
                f"path=langchain_astream model={self.model_name} "
                f"elapsed_ms={int(_elapsed * 1000)} "
                f"usage=in:{_in}/out:{_out} {_lc_parser.summary()}"
            )
            yield {
                "type": "done",
                "model_used": self.model_name,
                "usage": usage_meta,
            }

        except Exception as e:
            # reasoning 模型只允许 temperature=1，重建 LLM 后整个流重试一次
            if self._is_temp_error(e):
                logger.info(
                    f"{get_request_id()}模型限制 temperature=1，回退重试 [stream_chat]: model={self.model_name}"
                )
                self.llm = self._create_llm(temperature=1.0)
                # 重置解析器，重新开始流式生成
                _lc_parser = _ThinkingTagStreamParser()
                usage_meta = None
                async for chunk in self.llm.astream(messages):
                    token = chunk.content

                    if isinstance(token, list):
                        token = "".join(
                            item if isinstance(item, str) else str(item)
                            for item in token
                        )

                    meta = getattr(chunk, "usage_metadata", None)
                    if isinstance(meta, dict):
                        usage_meta = meta

                    if not token:
                        continue

                    for _ch, _text in _lc_parser.feed(token):
                        yield {
                            "type": _ch,
                            "content": _text,
                            "model_used": self.model_name,
                        }

                for _ch, _text in _lc_parser.flush():
                    yield {
                        "type": _ch,
                        "content": _text,
                        "model_used": self.model_name,
                    }

                _observe_llm(
                    self.model_name,
                    "general",
                    "success",
                    time.perf_counter() - _started,
                )
                yield {
                    "type": "done",
                    "model_used": self.model_name,
                    "usage": usage_meta,
                }
            else:
                logger.error(
                    f"{get_request_id()}第三方模型调用失败 [stream_chat] | model={self.model_name}, model_type={self.model_type}, "
                    f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
                )
                _observe_llm(
                    self.model_name, "general", "error", time.perf_counter() - _started
                )
                yield {
                    "type": "error",
                    "content": friendly_llm_error(e, self.model_name),
                }


DEFAULT_SYSTEM_PROMPT = """你是一个智能助手，专注于帮助用户解决问题。

在回答问题时，请先在 <thinking></thinking> 标签中思考和分析问题，然后再给出最终答案。

思考过程应包括：
1. 理解用户的真实需求
2. 分析问题的关键点
3. 考虑可能的解决方案
4. 选择最佳的回答方式

然后给出清晰、准确、有帮助的回答。
"""
