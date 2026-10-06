"""知识库检索工具（General Agent 专用，不暴露给其它 Agent）。

封装 ``x_vectorstore.search_documents``，从 document_chunks 表向量化召回用户
私有/全局文档分片。表无数据或 embedding 不可用时降级返回"知识库未索引"。
"""

from typing import Optional

from langchain_core.tools import tool
from utils.log_util import get_request_id, logger


@tool
async def kb_search_tool(query: str, user_id: Optional[int] = None) -> str:
    """在用户知识库（document_chunks 表）中检索相关文档分片。

    Args:
        query: 自然语言查询语句。
        user_id: 当前用户 ID；为 None 时仅检索全局文档。

    Returns:
        召回分片拼接的字符串；无数据或检索失败时返回降级提示。
    """
    try:
        from x_models.id_x_010.src.utils.x_vectorstore import search_documents

        chunks = await search_documents(query, user_id, top_k=3)
        if not chunks:
            return "知识库未索引或无相关文档"
        return "\n\n".join(
            f"【{c.get('doc_name')}】(score={round(float(c.get('score') or 0.0), 3)})\n"
            f"{c.get('content')}"
            for c in chunks
        )
    except Exception as e:
        logger.warning(
            f"{get_request_id()}kb_search_tool 失败 query='{query[:50]}': "
            f"{type(e).__name__}: {e}"
        )
        return f"知识库检索失败: {type(e).__name__}: {e}"
