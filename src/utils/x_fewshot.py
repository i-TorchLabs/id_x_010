"""SQL Few-Shot 例子召回（TASK-009）。

**仅 SQL Agent 使用，不暴露给其它 Agent。** 模块文件头注释明确指出这一点，
任何 General / Code / VL Agent 不应 import 本模块。

向量召回策略：
- 取 ``sql_examples`` 表中 ``enabled=True`` 且 ``db_name`` 匹配的全部行；
- 计算每行 embedding（写入时由 ``embed_example`` 生成并落库）与 query 向量
  的余弦相似度；
- 取 top_k 条。embedding 缺失或调用失败时降级为取前 top_k 条任意数据。
"""

import math
from typing import Dict, List, Optional

from sqlalchemy import select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import SqlExample, get_session
from x_models.id_x_010.src.utils.x_vectorstore import embed


def _cosine(a: List[float], b: List[float]) -> float:
    """标准余弦相似度。a/b 长度不一致或空时返回 0.0（保守不召回）。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (math.sqrt(na) * math.sqrt(nb))


async def embed_example(question: str) -> Optional[List[float]]:
    """生成例子的 embedding。CRUD mutation 调用以在写入 sql_examples 时填充。

    失败返回 None；调用方决定是否仍写入（embedding 为 NULL 时召回降级取前 N 条）。
    """
    try:
        return await embed(question)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}embed_example 失败 question='{question[:50]}': "
            f"{type(e).__name__}: {e}"
        )
        return None


async def retrieve_examples(
    question: str, db_name: str, top_k: int = 3
) -> List[Dict[str, Optional[str]]]:
    """向量召回 top-k 相关 SQL 例子。

    Args:
        question: 用户原始问题。
        db_name: 目标库名。
        top_k: 召回数量上限，默认 3。

    Returns:
        ``[{question, sql, explanation}]`` 列表，按相似度降序；
        表中无数据时返回空列表；embedding 不可用时降级取前 top_k 条。
    """
    if not question or not db_name:
        return []

    try:
        async with get_session()() as session:
            rows = (
                await session.execute(
                    select(SqlExample).where(
                        SqlExample.db_name == db_name,
                        SqlExample.enabled.is_(True),
                    )
                )
            ).scalars().all()
        if not rows:
            return []

        try:
            qvec = await embed(question)
        except Exception as e:
            logger.warning(
                f"{get_request_id()}retrieve_examples embed 失败,降级取前 N 条: "
                f"{type(e).__name__}: {e}"
            )
            return [
                {
                    "question": r.question,
                    "sql": r.sql,
                    "explanation": r.explanation,
                }
                for r in rows[:top_k]
            ]

        scored = []
        for r in rows:
            rvec = r.embedding if isinstance(r.embedding, list) else None
            score = _cosine(qvec, rvec) if rvec else 0.0
            scored.append((score, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [
            {
                "question": r.question,
                "sql": r.sql,
                "explanation": r.explanation,
            }
            for _, r in scored[:top_k]
        ]
    except Exception as e:
        logger.warning(
            f"{get_request_id()}retrieve_examples 失败,返回空列表: "
            f"{type(e).__name__}: {e}"
        )
        return []
