"""数值计算工具（General Agent 专用，不暴露给其它 Agent）。

用 numexpr 求值（避免 Python eval 直接执行任意代码的安全风险）。
"""

from langchain_core.tools import tool


@tool
def calc_tool(expression: str) -> str:
    """数值计算器。输入数学表达式（支持 + - * / % ** 等），返回精确结果。

    示例:
        '23 * 45 * 1.07' → '1108.95'
        '(100 + 200) / 3' → '100.0'
    """
    try:
        import numexpr

        result = numexpr.evaluate(expression)
        # numexpr 返回 numpy 标量，.item() 退回 Python 原生类型
        return str(result.item() if hasattr(result, "item") else result)
    except Exception as e:
        return f"计算失败: {type(e).__name__}: {e}"
