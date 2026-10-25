"""模型用量计价目录

按模型名称估算单轮对话的花费（USD）。价格以“每 1,000,000 token”计。

价格来源（优先级从高到低）：
1. 数据库 ``model_prices`` 表（管理员可维护，``model_key`` 小写子串匹配，
   取匹配串最长的一条，即最特异者优先）；
2. 本模块内置目录 ``_PRICING``（参考各厂商 2026 年公开报价）；
3. 未命中时的保守默认价 ``_DEFAULT_PRICING``。

本地模型（Ollama 等）运行在用户自有硬件上，调用方应直接记 0 花费，
无需经过本模块（见 x_views.save_usage_log）。
"""

from typing import Dict, Optional, Tuple

# 每条记录：{ "in": 输入价, "out": 输出价 }，单位 USD / 1M tokens
# 键为小写匹配串，按特异性从高到低排列，_lookup 取首个命中
# 与 ops/init/08_model_prices.sql 预置目录同步（网关实际可用模型）
_PRICING: list[tuple[str, Dict[str, float]]] = [
    # —— Anthropic ——
    ("claude-fable-5", {"in": 9.0, "out": 45.0}),
    ("claude-haiku-5-5", {"in": 0.09, "out": 0.45}),
    ("claude-opus-5", {"in": 4.5, "out": 22.5}),
    # —— DeepSeek ——
    ("deepseek-v4-pro", {"in": 0.35296, "out": 0.70592}),
    ("deepseek-v4-flash", {"in": 0.1176, "out": 0.2352}),
    # —— OpenAI ——
    ("gpt-5.5", {"in": 4.0, "out": 24.0}),
    ("gpt-6-astra", {"in": 8.0, "out": 40.0}),
    # —— Google Gemini ——
    ("gemini-3.1-flash-image", {"in": 0.4, "out": 48.0}),
    ("gemini-3-pro-image", {"in": 1.6, "out": 96.0}),
    # —— 月之暗面 Kimi ——
    ("kimi-k3", {"in": 2.6471, "out": 13.2353}),
    ("kimi-k2.7-code", {"in": 0.86031, "out": 3.5735}),
    # —— 智谱 GLM ——
    ("glm-5.3", {"in": 1.062, "out": 3.708}),
]

# 未命中时的保守默认价
_DEFAULT_PRICING: Dict[str, float] = {"in": 0.50, "out": 1.50}


def _lookup(model_name_lower: str) -> Dict[str, float]:
    for key, price in _PRICING:
        if key in model_name_lower:
            return price
    return _DEFAULT_PRICING


async def _lookup_db(model_name_lower: str) -> Optional[Dict[str, float]]:
    """从 ``model_prices`` 表查价。

    对启用行做小写子串匹配，命中多条时取 ``model_key`` 最长（最特异）的
    一条。查询失败或未命中时返回 None，由调用方回退内置目录。
    """
    try:
        from sqlalchemy import select

        from x_models.id_x_010.src.models.x_models import ModelPrice, get_session

        async with get_session()() as session:
            rows = (
                await session.execute(
                    select(ModelPrice).where(ModelPrice.enabled.is_(True))
                )
            ).scalars().all()

        best: Optional[ModelPrice] = None
        for row in rows:
            key = (row.model_key or "").lower().strip()
            if key and key in model_name_lower:
                if best is None or len(key) > len(best.model_key):
                    best = row
        if best is None:
            return None
        return {
            "in": float(best.input_price_per_1m or 0.0),
            "out": float(best.output_price_per_1m or 0.0),
        }
    except Exception:
        # best-effort：价格表不可用时静默回退内置目录，不阻塞计费主链路
        return None


def _split_cost(
    price: Dict[str, float], input_tokens: int, output_tokens: int
) -> Tuple[float, float]:
    inp = (input_tokens or 0) / 1_000_000 * price["in"]
    out = (output_tokens or 0) / 1_000_000 * price["out"]
    return round(inp, 6), round(out, 6)


async def compute_cost_detail(
    model_name: Optional[str],
    input_tokens: int,
    output_tokens: int,
) -> Tuple[float, float, float]:
    """估算单次调用的花费（USD），按 input / output 拆分。

    价格优先取数据库 ``model_prices`` 表，未命中回退内置目录。

    Args:
        model_name: 模型名称（如 ``deepseek/deepseek-chat``、``gpt-4o-mini``）
        input_tokens: 输入 token 数
        output_tokens: 输出 token 数

    Returns:
        (input_cost, output_cost, total_cost)，美元，各保留 6 位小数。
        model_name 为空或无法识别时按默认价估算。
    """
    if not model_name:
        price = _DEFAULT_PRICING
    else:
        lower = model_name.lower()
        price = await _lookup_db(lower) or _lookup(lower)

    in_cost, out_cost = _split_cost(price, input_tokens, output_tokens)
    return in_cost, out_cost, round(in_cost + out_cost, 6)


def compute_cost(
    model_name: Optional[str],
    input_tokens: int,
    output_tokens: int,
) -> float:
    """估算单次调用的总花费（USD），仅用内置目录（同步、不查库）。

    保留以兼容旧调用方；新代码请使用 :func:`compute_cost_detail`。
    """
    if not model_name:
        price = _DEFAULT_PRICING
    else:
        price = _lookup(model_name.lower())

    in_cost, out_cost = _split_cost(price, input_tokens, output_tokens)
    return round(in_cost + out_cost, 6)
