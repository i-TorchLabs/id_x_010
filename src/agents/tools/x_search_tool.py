"""联网搜索工具（General Agent 专用，不暴露给其它 Agent）。

依赖环境变量 ``TAVILY_API_KEY``；未配置时返回提示字符串而非抛错，
让 ReAct Agent 把"无网络搜索能力"如实转告用户。
"""

import os

from langchain_core.tools import tool
from utils.log_util import get_request_id, logger


@tool
async def web_search_tool(query: str) -> str:
    """联网搜索最新信息。输入自然语言查询，返回前 5 条结果摘要。

    用于回答实时信息（GDP、新闻、汇率等）。如未配置 TAVILY_API_KEY
    会返回"未配置"提示，不会抛错。
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return "未配置 TAVILY_API_KEY，无法联网搜索"

    try:
        # 延迟导入避免冷启动加载 tavily（无 key 场景下也节省内存）
        from tavily import AsyncTavilyClient

        client = AsyncTavilyClient(api_key=api_key)
        res = await client.search(query, max_results=5)
        results = res.get("results", []) if isinstance(res, dict) else []
        if not results:
            return "未找到相关结果"
        return "\n".join(
            f"- {r.get('title', '')}: {(r.get('content') or '')[:200]}"
            for r in results
        )
    except Exception as e:
        logger.warning(
            f"{get_request_id()}web_search_tool 失败 query='{query[:50]}': "
            f"{type(e).__name__}: {e}"
        )
        return f"搜索失败: {type(e).__name__}: {e}"
