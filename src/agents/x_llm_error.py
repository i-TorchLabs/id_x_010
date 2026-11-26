"""第三方 LLM 调用错误的用户友好提示转换。

背景：各 Agent 的异常出口原先直接把 `str(e)` 透传给前端，
用户看到的是 `Error code: 403 - {'code': 30003, 'message': 'Model disabled.'}`
这类原始英文报错，无法判断该如何处理。

本模块提供两件事：
1. `DEFAULT_EXTERNAL_MODEL` — 外部模型默认值的唯一来源，
   避免各 Agent 各自硬编码导致默认值漂移（如 GLM-5 被平台下架后多处遗漏）。
2. `friendly_llm_error()` — 将 openai / langchain_openai 抛出的异常
   按 status_code、异常类名、错误消息三重判定，转换为可行动的中文提示。
   原始错误仍由调用处的 logger 完整记录，这里只面向用户展示。
"""

from __future__ import annotations

import asyncio
from typing import Awaitable, Callable, Optional, TypeVar

from utils.log_util import get_request_id, logger

# 外部模型默认值（与 ops/init/05_models.sql 预置数据保持一致，走 chinarouter 网关）。
# 注意：Pro/zai-org/GLM-5 已被平台下架（403 Model disabled）；
# zai-org/GLM-5.2 在 distributor 网关已无可用通道（503 model_not_found），勿再使用。
DEFAULT_EXTERNAL_MODEL = "deepseek-v4-flash"

# 更换模型的操作指引，追加在模型类错误提示之后
_SETTINGS_HINT = "请在左下角「模型设置」中检查后更换为可用模型"

T = TypeVar("T")


def is_read_timeout(e: Exception) -> bool:
    """判定是否为上游静默型读超时（ReadTimeout / StreamChunkTimeout）。

    reasoning 模型思考期网关可能长时间不吐 SSE；重试只会让模型从头再思考
    再超时一遍。此类错误必须快速失败，不可进入瞬时重试。
    """
    if isinstance(e, TimeoutError) or type(e).__name__ in (
        "ReadTimeout",
        "StreamChunkTimeoutError",
        "ReadTimeoutError",
    ):
        return True
    # httpx.ReadTimeout 经 langchain 包装后 isinstance 不可靠，按 MRO/文案匹配
    if "ReadTimeout" in type(e).__mro__.__repr__():
        return True
    lower = str(e).replace("\n", " ").strip().lower()
    return "read timeout" in lower or "stream chunk timeout" in lower


def is_transient_llm_error(e: Exception) -> bool:
    """判定是否为可重试的瞬时 LLM/网络错误。

    覆盖建连失败、429/502/503 及常见网关抖动报文。
    不重试：ReadTimeout（静默思考）、401/403/404、model disabled 等确定性错误。
    """
    # 静默读超时：绝不重试（与 GeneralAgent._is_read_timeout 同语义）
    if is_read_timeout(e):
        return False

    status = getattr(e, "status_code", None)
    if status in (429, 502, 503):
        return True
    # HTTPStatusError（httpx）挂在 response.status_code
    response = getattr(e, "response", None)
    resp_status = getattr(response, "status_code", None) if response is not None else None
    if resp_status in (429, 502, 503):
        return True

    cls = type(e).__name__.lower()
    lower = str(e).replace("\n", " ").strip().lower()

    # 确定性错误：绝不重试
    if status in (401, 403, 404) or resp_status in (401, 403, 404):
        return False
    if (
        "model disabled" in lower
        or "model_disabled" in lower
        or "invalid_api_key" in lower
        or "incorrect api key" in lower
        or "authentication" in cls
        or "permissiondenied" in cls
    ):
        return False

    # 仅建连/网关抖动类；不含笼统 "timeout"（避免把 ReadTimeout 再捞回来）
    transient_markers = (
        "connection reset",
        "connection aborted",
        "connection refused",
        "connecterror",
        "connect timeout",
        "connecttimeout",
        "temporarily unavailable",
        "service unavailable",
        "bad gateway",
        "gateway timeout",
        "rate limit",
        "ratelimit",
        "too many requests",
        "server disconnected",
        "remoteprotocolerror",
        "name or service not known",
        "no available channel",
        "apiconnectionerror",
    )
    if any(m in lower for m in transient_markers):
        return True
    if any(
        m in cls
        for m in (
            "connecterror",
            "connecttimeout",
            "connectionerror",
            "apiconnection",
            "ratelimit",
            "remoteprotocol",
        )
    ):
        return True
    return False


async def with_llm_retry(
    coro_factory: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay: float = 0.5,
    label: str = "llm",
) -> T:
    """对瞬时 LLM 错误做指数退避重试。

    ``coro_factory`` 每次调用应返回新的 awaitable（不可复用已消费的协程）。
    确定性错误立即抛出；耗尽重试后抛出最后一次异常。
    """
    last_err: Optional[Exception] = None
    total = max(1, attempts)
    for attempt in range(1, total + 1):
        try:
            return await coro_factory()
        except Exception as e:
            last_err = e
            if attempt >= total or not is_transient_llm_error(e):
                raise
            delay = base_delay * (2 ** (attempt - 1))
            logger.warning(
                f"{get_request_id()}[对话解析] LLM 瞬时错误重试 "
                f"label={label} attempt={attempt}/{total} "
                f"delay_s={delay:.1f} error={type(e).__name__}: {e}"
            )
            await asyncio.sleep(delay)
    assert last_err is not None
    raise last_err


def friendly_max_tokens_exhausted(model_name: str = "", max_tokens: int = 0) -> str:
    """输出长度上限打满且无正文时的用户提示。

    reasoning 模型长文档场景常见：思考占用几乎全部 completion_tokens，
    finish_reason=length，SSE 侧 content 为空。
    """
    model = f' "{model_name}"' if model_name else ""
    limit = f"（当前上限约 {max_tokens} tokens）" if max_tokens > 0 else ""
    return (
        f"模型{model}输出长度上限已用尽{limit}，多为思考过程占用，"
        f"未留下有效正文。请缩短注入文档、更换模型，"
        f"或提高环境变量 LLM_MAX_TOKENS 后重试"
    )


def friendly_llm_error(e: Exception, model_name: str = "") -> str:
    """将 LLM API 异常转换为用户可读懂、可行动的中文提示。

    判定顺序优先具体原因，最后兜底返回原始错误文本。
    覆盖 openai 原生异常（带 status_code）与 langchain_openai
    包装异常（OpenAIPermissionDeniedError 等，仅靠类名区分）。
    """
    status = getattr(e, "status_code", None)
    cls = type(e).__name__.lower()
    msg = str(e).replace("\n", " ").strip()
    lower = msg.lower()
    model = f' "{model_name}"' if model_name else ""

    # 模型被平台禁用/下架（如硅基流动 30003 Model disabled）
    if "model disabled" in lower or "model_disabled" in lower:
        return (
            f"模型{model}已被平台禁用或下架，{_SETTINGS_HINT}"
            f"（如 {DEFAULT_EXTERNAL_MODEL}）"
        )

    # 中转网关兼容性问题：当前模型通道不支持请求中的某些特性
    # （强制 tool_choice / assistant 消息结尾等），属于模型与功能不匹配，
    # 提示用户换模型而不是透传原始英文 400
    if (
        "tool_choice" in lower
        or "assistant message prefill" in lower
        or "must end with a user message" in lower
    ):
        return (
            f"模型{model}的接入通道不支持当前功能所需的调用方式"
            f"（工具调用/消息格式限制），{_SETTINGS_HINT}"
        )

    # 503 / 网关无可用通道：中转网关（distributor）对该模型已无上游通道，
    # 典型报文 "No available channel for model xxx under group auto"
    if (
        status == 503
        or "model_not_found" in lower
        or "no available channel" in lower
    ):
        return (
            f"模型{model}在网关侧已无可用通道（可能已下线或暂时不可用），"
            f"{_SETTINGS_HINT}（如 {DEFAULT_EXTERNAL_MODEL}）"
        )

    # 403 无权限：常见于模型下架、未开通或 key 无该模型权限
    if status == 403 or "permissiondenied" in cls:
        return f"模型{model}访问被拒绝（可能已下架或当前 API-KEY 无权限），{_SETTINGS_HINT}"

    # 401 认证失败
    if (
        status == 401
        or "authentication" in cls
        or "invalid_api_key" in lower
        or "invalid api key" in lower
        or "incorrect api key" in lower
    ):
        return "API-KEY 无效或已过期，请重新填写有效的 API-KEY"

    # 404 模型不存在/名称错误
    if (
        status == 404
        or "notfound" in cls
        or "model not found" in lower
        or "does not exist" in lower
    ):
        return f"模型{model}不存在或名称有误，{_SETTINGS_HINT}"

    # 429 限流/欠费
    if (
        status == 429
        or "ratelimit" in cls
        or "rate limit" in lower
        or "insufficient" in lower
        or "quota" in lower
        or "balance" in lower
    ):
        return "模型请求频率超限或账户额度不足，请稍后重试或检查平台账户余额"

    # 超时
    if "timeout" in cls or "timed out" in lower or "timeout" in lower:
        return "模型请求超时，请稍后重试"

    # TLS 后对端空回复 / 无 HTTP 状态码即断连：多为网关线路或出口 IP 策略，
    # 与「Key 无效 / 模型名错误」不同（后者通常会返回 4xx JSON）。
    if (
        "server disconnected" in lower
        or "remoteprotocol" in cls
        or "remoteprotocolerror" in lower
        or "empty reply" in lower
        or "without sending a response" in lower
        or "remotely closed" in lower
        or "remote end closed" in lower
    ):
        return (
            "模型网关在建立连接后未返回任何响应即断开（常见于出口 IP 未放行或"
            "网关线路异常）。请向网关方确认本机出口 IP 白名单，或在「模型设置」"
            "中更换可用的 base_url / 提供商后重试"
        )

    # 连接失败
    if "connection" in cls or "connect" in lower or "name or service not known" in lower:
        return "无法连接模型服务，请检查访问地址（base_url）是否正确以及网络是否可达"

    # 兜底：保留原始错误文本
    return msg
