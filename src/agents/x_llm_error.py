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

# 外部模型默认值（硅基流动可用模型，与 ops/init/05_models.sql 预置数据保持一致）。
# 注意：Pro/zai-org/GLM-5 已被平台下架（403 Model disabled），勿再使用。
DEFAULT_EXTERNAL_MODEL = "zai-org/GLM-5.2"

# 更换模型的操作指引，追加在模型类错误提示之后
_SETTINGS_HINT = "请在右上角「模型设置」中检查后更换为可用模型"


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

    # 连接失败
    if "connection" in cls or "connect" in lower or "name or service not known" in lower:
        return "无法连接模型服务，请检查访问地址（base_url）是否正确以及网络是否可达"

    # 兜底：保留原始错误文本
    return msg
