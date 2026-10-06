"""多语言 Prompt 加载器（TASK-016）。

按 Accept-Language 头选择对应语言版本，三个 Agent 各自独立调用——
不引入 Agent 间联动。

支持的语言：zh（默认） / en。
key 标识 prompt 用途（如 ``general.system``），与 x_prompts.py 的 DEFAULTS 字典对齐。
当请求的语言版本缺失时回退到 zh。
"""

from typing import Optional

from x_models.id_x_010.src.prompts.en import PROMPTS as EN_PROMPTS
from x_models.id_x_010.src.prompts.zh import PROMPTS as ZH_PROMPTS


def _parse_accept_language(header: Optional[str]) -> str:
    """解析 Accept-Language 头返回主要语言代码（小写）。

    示例：
        "zh-CN,zh;q=0.9,en;q=0.8" → "zh-cn"
        "en-US,en;q=0.9" → "en-us"
        None / "" → "zh"
    """
    if not header:
        return "zh"
    # 取第一项（最高优先级），剥 q 参数
    first = header.split(",")[0].strip().split(";")[0].strip().lower()
    return first or "zh"


def load_prompt_lang(key: str, accept_language: Optional[str]) -> str:
    """按 Accept-Language 选择对应语言的 prompt 文本。

    Args:
        key: prompt key，如 "general.system" / "sql.generate_query"
        accept_language: HTTP Accept-Language 头字符串

    Returns:
        对应语言的 prompt；缺失时回退中文；中文也缺失时返回空串。
    """
    if not key:
        return ""
    lang = _parse_accept_language(accept_language)
    # en-* 系列统一走 EN_PROMPTS，其余（zh-*、未知）走 ZH_PROMPTS
    if lang.startswith("en"):
        return EN_PROMPTS.get(key) or ZH_PROMPTS.get(key) or ""
    return ZH_PROMPTS.get(key) or EN_PROMPTS.get(key) or ""
