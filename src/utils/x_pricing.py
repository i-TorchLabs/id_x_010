"""模型用量计价目录

按模型名称估算单轮对话的花费（USD）。价格以“每 1,000,000 token”计，
参考各厂商 2026 年公开报价；未命中模型回退到保守默认价。

本地模型（Ollama 等）运行在用户自有硬件上，调用方应直接记 0 花费，
无需经过本模块（见 x_views.save_usage_log）。
"""

from typing import Dict, Optional

# 每条记录：{ "in": 输入价, "out": 输出价 }，单位 USD / 1M tokens
# 键为小写匹配串，按特异性从高到低排列，_lookup 取首个命中
_PRICING: list[tuple[str, Dict[str, float]]] = [
    # —— OpenAI ——
    ("gpt-4o-mini", {"in": 0.15, "out": 0.60}),
    ("gpt-4o", {"in": 2.50, "out": 10.00}),
    ("gpt-4.1-mini", {"in": 0.40, "out": 1.60}),
    ("gpt-4.1", {"in": 2.00, "out": 8.00}),
    ("gpt-4-turbo", {"in": 10.00, "out": 30.00}),
    ("o1-mini", {"in": 1.10, "out": 4.40}),
    ("o1", {"in": 15.00, "out": 60.00}),
    # —— Anthropic ——
    ("claude-3-5-haiku", {"in": 0.80, "out": 4.00}),
    ("claude-3-5-sonnet", {"in": 3.00, "out": 15.00}),
    ("claude-3-opus", {"in": 15.00, "out": 75.00}),
    ("claude-3-haiku", {"in": 0.25, "out": 1.25}),
    # —— DeepSeek ——
    ("deepseek-reasoner", {"in": 0.55, "out": 2.19}),
    ("deepseek-chat", {"in": 0.14, "out": 0.28}),
    ("deepseek-coder", {"in": 0.14, "out": 0.28}),
    # —— 智谱 GLM ——
    ("glm-4v", {"in": 0.50, "out": 0.50}),
    ("glm-4-air", {"in": 0.10, "out": 0.10}),
    ("glm-4-flash", {"in": 0.10, "out": 0.10}),
    ("glm-4-plus", {"in": 3.50, "out": 10.50}),
    ("glm-4", {"in": 0.50, "out": 0.50}),
    ("glm-5", {"in": 0.50, "out": 1.50}),
    # —— 阿里通义千问 ——
    ("qwen-max", {"in": 2.50, "out": 10.00}),
    ("qwen-plus", {"in": 0.40, "out": 1.20}),
    ("qwen-turbo", {"in": 0.05, "out": 0.20}),
    # —— meta-llama / Mistral ——
    ("llama-3.1-405b", {"in": 0.90, "out": 0.90}),
    ("llama-3.1-70b", {"in": 0.40, "out": 0.40}),
    ("llama-3.1-8b", {"in": 0.05, "out": 0.05}),
    ("mistral-large", {"in": 2.00, "out": 6.00}),
    ("mistral-small", {"in": 0.15, "out": 0.30}),
]

# 未命中时的保守默认价
_DEFAULT_PRICING: Dict[str, float] = {"in": 0.50, "out": 1.50}


def _lookup(model_name_lower: str) -> Dict[str, float]:
    for key, price in _PRICING:
        if key in model_name_lower:
            return price
    return _DEFAULT_PRICING


def compute_cost(
    model_name: Optional[str],
    input_tokens: int,
    output_tokens: int,
) -> float:
    """估算单次调用的花费（USD）。

    Args:
        model_name: 模型名称（如 ``deepseek/deepseek-chat``、``gpt-4o-mini``）
        input_tokens: 输入 token 数
        output_tokens: 输出 token 数

    Returns:
        花费（美元，保留 6 位小数）。model_name 为空或无法识别时按默认价估算。
    """
    if not model_name:
        price = _DEFAULT_PRICING
    else:
        price = _lookup(model_name.lower())

    inp = (input_tokens or 0) / 1_000_000 * price["in"]
    out = (output_tokens or 0) / 1_000_000 * price["out"]
    return round(inp + out, 6)
