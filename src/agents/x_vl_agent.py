"""视觉多模态 Agent（TASK-015）。

**独立 Agent，不与 General/SQL/Code Agent 联动**——文件头注释明确这一点。
- 由 supervisor 在路由检测到 ``[image:ID]`` 占位时分发到此 Agent；
- 输出直接作为最终响应，不会传给其它 Agent。

LLM 调用：复用 external_provider.vl_base_url（无则降级 base_url），模型名走
``EXTERNAL_VL_MODEL`` 环境变量，默认 gpt-4o。任何失败 best-effort 降级到
``friendly_llm_error`` 的提示性错误。
"""

import os
from typing import Any, AsyncGenerator, Dict, Optional

from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from pydantic import SecretStr
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.agents.x_llm_error import friendly_llm_error
from x_models.id_x_010.src.models.x_models import get_external_model_config


class VLAgent:
    """视觉多模态 Agent。不与其它 Agent 联动，仅服务路由层分发。"""

    def __init__(
        self,
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        cfg = get_external_model_config()
        self.model_name = model_name or os.getenv("EXTERNAL_VL_MODEL", "gpt-4o")
        self.base_url = base_url or cfg.get("vl_base_url") or cfg.get("base_url")
        self.api_key = api_key or cfg.get("api_key")

        # api_key 缺失时不抛错——stream_analyze 在调用时降级提示
        self.llm = ChatOpenAI(
            model=self.model_name,
            api_key=SecretStr(self.api_key) if self.api_key else None,
            base_url=self.base_url,
            temperature=0.2,
            streaming=True,
        )
        logger.info(
            f"{get_request_id()}VLAgent 初始化完成: model={self.model_name}, "
            f"base_url={self.base_url}"
        )

    @staticmethod
    def _is_configured(api_key: Optional[str]) -> bool:
        return bool(api_key)

    async def stream_analyze(
        self, image_b64: str, query: str
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """对图片+问题流式生成分析。

        Args:
            image_b64: 图片的 base64 字符串（不含 data: 前缀）。
            query: 用户的自然语言问题。

        Yields:
            ``{"type": "content"/"done"/"error", ...}`` chunk；
            与 GeneralAgent.stream_chat 输出契约保持一致，便于前端复用渲染。
        """
        if not self._is_configured(self.api_key):
            yield {
                "type": "error",
                "content": "多模态未配置：external_provider 缺 api_key 或 vl_base_url",
                "model_used": self.model_name,
            }
            return

        # TASK-018：优先从 PromptTemplate 表加载 vl.system 注入到 query 前；
        # 失败回退默认行为（直接用 query），不阻塞主流程
        try:
            from x_models.id_x_010.src.utils.x_prompts import load_prompt

            system_prefix = await load_prompt("vl.system")
            effective_query = (
                f"{system_prefix}\n\n{query}" if system_prefix else query
            )
        except Exception:
            effective_query = query

        msg = HumanMessage(
            content=[
                {"type": "text", "text": effective_query or "请描述这张图片"},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"},
                },
            ]
        )
        try:
            async for chunk in self.llm.astream([msg]):
                token = chunk.content
                if isinstance(token, list):
                    token = "".join(
                        x if isinstance(x, str) else str(x) for x in token
                    )
                if token:
                    yield {
                        "type": "content",
                        "content": token,
                        "model_used": self.model_name,
                    }
            yield {"type": "done", "model_used": self.model_name}
        except Exception as e:
            logger.error(
                f"{get_request_id()}VLAgent stream_analyze 失败: {e}",
                exc_info=True,
            )
            yield {
                "type": "error",
                "content": friendly_llm_error(e, self.model_name),
                "model_used": self.model_name,
            }
