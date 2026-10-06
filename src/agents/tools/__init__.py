"""General Agent 工具集。

仅 General Agent 使用，不暴露给 SQL/Code/VL Agent——本目录文件头注释均显式说明
"不构成 Agent 间联动"。ALL_TOOLS 列表是 General Agent 在 create_react_agent 调用
时绑定的工具集合。
"""

from typing import List

from langchain_core.tools import BaseTool

from .x_calc_tool import calc_tool
from .x_kb_tool import kb_search_tool
from .x_notify_tool import notify_tool
from .x_search_tool import web_search_tool

# 顺序影响 ReAct prompt 中的展示顺序，calc 放最前（最常用、最便宜）
ALL_TOOLS: List[BaseTool] = [
    calc_tool,
    web_search_tool,
    kb_search_tool,
    notify_tool,
]

__all__ = ["ALL_TOOLS", "calc_tool", "web_search_tool", "kb_search_tool", "notify_tool"]
