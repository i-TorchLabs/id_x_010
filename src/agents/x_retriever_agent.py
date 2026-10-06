"""检索服务：从 table_comments / document_chunks 召回相关上下文。

本模块是 SQL Agent 的内部工具（见 x_sql_agent.py `_load_relevant_schema`），
不构成独立 Agent，不与 General/Code/VL Agent 联动，也不被其调用。
所有失败均 try/except 后返回空列表，调用方降级为原始全 schema 行为。
"""

from typing import Dict, List, Optional

from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.utils.x_vectorstore import search_tables


async def retrieve_relevant_tables(
    query: str,
    db_name: Optional[str],
    top_k: int = 5,
) -> List[Dict[str, object]]:
    """按用户问题召回相关表。

    Args:
        query: 用户原始问题（保留标点，向量模型自行切分）。
        db_name: 目标库名（agent_db_settings.db_name）；为空或查询为空时返回空列表。
        top_k: 召回表数上限，默认 5。

    Returns:
        ``[{table_name, comment, score}]`` 列表，按 score 降序；
        embedding 不可用或无 table_comments 数据时返回空列表（不抛错）。

    本函数只为 SQL Agent 服务，不向其它 Agent 暴露，也不调用任何其它 Agent。
    """
    if not query or not db_name:
        return []

    try:
        tables = await search_tables(query, db_name, top_k=top_k)
        logger.info(
            f"{get_request_id()}[retriever] query='{query[:50]}...{'..' if len(query) > 50 else ''}' "
            f"db='{db_name}' → tables={[t.get('table_name') for t in tables]} "
            f"score={[round(float(t.get('score') or 0.0), 3) for t in tables]}"
        )
        return tables
    except Exception as e:
        logger.warning(
            f"{get_request_id()}[retriever] retrieve 失败，降级全 schema: "
            f"{type(e).__name__}: {e}"
        )
        return []
