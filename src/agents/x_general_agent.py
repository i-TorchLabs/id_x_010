import os
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from langchain_core.callbacks import AsyncCallbackHandler
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from utils.log_util import get_request_id, logger
from x_models.id_x_010..models.x_models import get_external_model_config


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
            api_key or external_config.get("api_key") or os.getenv("EXTERNAL_API_KEY")
        )
        self.base_url = (
            base_url
            or external_config.get("base_url")
            or os.getenv("EXTERNAL_BASE_URL", "https://api.siliconflow.cn/v1")
        )

        self.llm = self._create_llm()
        logger.info(
            f"{get_request_id()}GeneralAgent 初始化完成: model_type={model_type}, model_name={self.model_name}"
        )

    def _get_default_model(self, model_type: str) -> str:
        if model_type == "external":
            return "Pro/zai-org/GLM-5"
        else:
            return "qwen2.5"

    def _create_llm(self) -> ChatOpenAI:
        if self.model_type == "external":
            model_identifier = self.EXTERNAL_MODELS.get(
                self.model_name, self.model_name
            )
            return ChatOpenAI(
                model=model_identifier,
                api_key=SecretStr(self.api_key) if self.api_key else None,
                base_url=self.base_url,
                temperature=0.7,
                streaming=True,
            )
        else:
            local_base_url = os.getenv(
                "LOCAL_MODEL_BASE_URL", "http://localhost:11434/v1"
            )
            local_api_key = os.getenv("LOCAL_MODEL_API_KEY", "ollama")

            return ChatOpenAI(
                model=self.LOCAL_MODELS.get(self.model_name, self.model_name),
                api_key=SecretStr(local_api_key),
                base_url=local_base_url,
                temperature=0.7,
                streaming=True,
            )

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

        try:
            response = await self.llm.ainvoke(messages)
        except Exception as e:
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

        return content, thinking

    async def stream_chat(
        self,
        query: str,
        context: Optional[List[Dict[str, str]]] = None,
        system_prompt: Optional[str] = None,
    ) -> AsyncGenerator[Dict[str, str], None]:
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

        thinking_buffer = []
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
                    if in_thinking:
                        thinking_buffer.append(token)
                        yield {
                            "type": "thinking",
                            "content": token,
                            "model_used": self.model_name,
                        }
                    else:
                        yield {
                            "type": "content",
                            "content": token,
                            "model_used": self.model_name,
                        }

            yield {
                "type": "done",
                "model_used": self.model_name,
            }

        except Exception as e:
            logger.error(
                f"{get_request_id()}第三方模型调用失败 [stream_chat] | model={self.model_name}, model_type={self.model_type}, "
                f"base_url={self.base_url} | 原因: {type(e).__name__}: {e}"
            )
            yield {
                "type": "error",
                "content": str(e),
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
