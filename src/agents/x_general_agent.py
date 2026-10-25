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
    """

    _OPEN = "<thinking>"
    _CLOSE = "</thinking>"

    def __init__(self) -> None:
        self._buffer = ""
        self.in_thinking = False

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

    def feed(self, token: str) -> List[Tuple[str, str]]:
        self._buffer += token
        out: List[Tuple[str, str]] = []
        while self._buffer:
            tag = self._CLOSE if self.in_thinking else self._OPEN
            idx = self._buffer.find(tag)
            if idx != -1:
                text = self._buffer[:idx]
                if text:
                    out.append((self._channel(), text))
                self._buffer = self._buffer[idx + len(tag):]
                self.in_thinking = not self.in_thinking
                continue
            keep = self._partial_suffix_len()
            emit_end = len(self._buffer) - keep
            if emit_end > 0:
                out.append((self._channel(), self._buffer[:emit_end]))
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
                out.append((self._channel(), self._buffer))
            self._buffer = ""
        return out


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
            )

    @staticmethod
    def _is_temp_error(err: Exception) -> bool:
        """判断异常是否为 temperature 限制错误（reasoning 模型只允许 1）。"""
        lower = str(err).lower()
        return "temperature" in lower and (
            "only 1 is allowed" in lower or "invalid" in lower
        )

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

        import httpx

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

        raw_usage = None
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
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
                                "output_tokens": usage.get("completion_tokens", 0) or 0,
                                "total_tokens": usage.get("total_tokens", 0) or 0,
                            }
                        choices = chunk.get("choices") or []
                        if not choices:
                            continue
                        delta = choices[0].get("delta") or {}
                        reasoning = delta.get("reasoning_content")
                        content = delta.get("content")
                        if reasoning:
                            yield ("thinking", reasoning)
                        if content:
                            yield ("content", content)
                    except (_json.JSONDecodeError, KeyError, IndexError):
                        continue

        if raw_usage is not None:
            yield ("usage", _json.dumps(raw_usage))

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
                response = await self.agent.ainvoke({"messages": messages})
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
            response = await self.llm.ainvoke(messages)
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
                response = await self.llm.ainvoke(messages)
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
        # TASK-015: 跨 chunk 标签解析器——流式 token 会把 <thinking> 拆碎成
        # "<"+"th"+"inking>"，逐 token 的 `in` 检测匹配不到，导致标签和思考
        # 内容全部走 content 通道，前端解析后气泡空白。
        _react_parser = _ThinkingTagStreamParser()

        # ReAct 模式：通过 astream_events 拿到 token 级流 + tool_call 事件。
        # 先探测 v2（langgraph >=0.2.x 推荐）可用性——某些旧版本只支持 v1。
        # 探测失败降级 v1；运行时异常则降级走下方纯 LLM.astream 路径
        # （保留 thinking 解析契约）。
        if self._react_enabled and self.agent is not None:
            events_version = "v2"
            try:
                # 仅创建 aiter 探测，不消费——v2 不支持时构造会抛 TypeError/ValueError
                _ = self.agent.astream_events({"messages": messages}, version="v2")
            except (TypeError, ValueError, AttributeError) as _ve:
                logger.info(
                    f"{get_request_id()}astream_events v2 不可用,降级 v1: "
                    f"{type(_ve).__name__}: {_ve}"
                )
                events_version = "v1"

            try:
                _react_produced = False
                _react_usage = None
                async for evt in self.agent.astream_events(
                    {"messages": messages}, version=events_version
                ):
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
                    _observe_llm(
                        self.model_name, "general", "success", time.perf_counter() - _started
                    )
                    yield {
                        "type": "done",
                        "model_used": self.model_name,
                        "usage": _react_usage,
                    }
                    return
                else:
                    logger.warning(
                        f"{get_request_id()}ReAct path 产出 0 个 token"
                        f"（reasoning 模型 token 可能被 langchain 丢弃），"
                        f"降级 raw httpx 流式: model={self.model_name}"
                    )
            except Exception as e:
                _observe_llm(
                    self.model_name, "general", "error", time.perf_counter() - _started
                )
                logger.warning(
                    f"{get_request_id()}ReAct stream_chat 失败，降级纯 LLM 流式: "
                    f"{type(e).__name__}: {e}"
                )
                # 不 return，继续走下方原 LLM.astream 路径作为降级

        # TASK-015: 优先用 raw httpx 直接调用，手动解析 reasoning_content。
        # langchain_openai 1.6.7+ 不解析 reasoning_content（GLM-5.2 等 reasoning
        # 模型的 token 全在该字段），导致只有 done 没有 content。
        # raw 方法成功时直接 return；失败则降级到下方 langchain astream 路径。
        try:
            _raw_produced = False
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
                _observe_llm(
                    self.model_name,
                    "general",
                    "success",
                    time.perf_counter() - _started,
                )
                yield {
                    "type": "done",
                    "model_used": self.model_name,
                    "usage": _raw_usage,
                }
                return
        except Exception as _raw_e:
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
                        _observe_llm(
                            self.model_name,
                            "general",
                            "success",
                            time.perf_counter() - _started,
                        )
                        yield {
                            "type": "done",
                            "model_used": self.model_name,
                            "usage": _retry_usage,
                        }
                        return
                except Exception as _retry_e:
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

            _observe_llm(
                self.model_name, "general", "success", time.perf_counter() - _started
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
