"""向量存储与检索封装。

提供 ``table_comments`` / ``document_chunks`` 两表的写入与召回，
供 SQL Agent 的 Retriever（TASK-002）与 General Agent 的 KB 工具（TASK-004）使用。

embedding 客户端复用 ``external_provider`` / ``local_provider`` 表中已配置的
embd_base_url 与 api_key；模型名走环境变量 ``EXTERNAL_EMBEDDING_MODEL``，
默认 ``Qwen/Qwen3-Embedding-8B``（1024 维，匹配 TableComment.EmbeddingType）。

模块对外只暴露极少数异步 API，所有失败均 try/except 后降级，
不向上抛错——调用方决策"降级返回空还是回退全表"。
"""

import os
from datetime import datetime, timezone
from typing import Dict, List, Optional

from langchain_openai import OpenAIEmbeddings
from sqlalchemy import select
from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.models.x_models import (
    DocumentChunk,
    TableComment,
    get_external_model_config,
    get_local_model_config,
    get_session,
)

# 同一套 base_url+api_key+model 复用 embeddings 客户端，避免每条记录重建连接。
_embeddings_cache: Dict[str, OpenAIEmbeddings] = {}


def get_embeddings() -> OpenAIEmbeddings:
    """复用 external_provider / local_provider 表配置，缓存 embeddings 客户端。

    走与 LLM 相同的 provider 选择逻辑：external_config 优先，否则回退
    local_config（与 views.load_llm_provider_config 行为对齐）。
    """
    external_cfg = get_external_model_config()
    local_cfg = get_local_model_config()

    base_url = (
        external_cfg.get("embd_base_url")
        or external_cfg.get("base_url")
        or local_cfg.get("embd_base_url")
        or local_cfg.get("base_url")
    )
    api_key = (
        external_cfg.get("api_key")
        or local_cfg.get("api_key")
        or "ollama"
    )
    model = os.getenv("EXTERNAL_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-8B")

    cache_key = f"{base_url}|{api_key}|{model}"
    cached = _embeddings_cache.get(cache_key)
    if cached is not None:
        return cached

    client = OpenAIEmbeddings(
        model=model,
        openai_api_key=api_key,
        openai_api_base=base_url,
    )
    _embeddings_cache[cache_key] = client
    logger.info(
        f"{get_request_id()}OpenAIEmbeddings 初始化完成，model={model}, base_url={base_url}"
    )
    return client


async def embed(text: str) -> List[float]:
    """文本→向量。失败抛错由调用方降级（见 search_tables / retrieve_examples）。"""
    emb = get_embeddings()
    return await emb.aembed_query(text)


async def upsert_table_comment(
    db_name: str,
    schema_name: str,
    table_name: str,
    comment: str,
    columns_desc: Dict[str, str],
) -> None:
    """写入/更新一行 table_comments，自动生成 embedding。

    幂等：db_name + table_name 既有行则更新，没有则插入。
    embedding 计算失败时仍写入文本数据，embedding 字段保持 NULL。
    """
    text_for_emb = f"{table_name} {comment or ''} {' '.join(columns_desc.values())}".strip()
    vec: Optional[List[float]] = None
    try:
        vec = await embed(text_for_emb)
    except Exception as e:  # embedding 不可用时仅 warn，文本仍写入
        logger.warning(
            f"{get_request_id()}upsert_table_comment embed 失败 table={table_name}: "
            f"{type(e).__name__}: {e}"
        )

    async with get_session()() as session:
        existing = await session.execute(
            select(TableComment).where(
                TableComment.db_name == db_name,
                TableComment.table_name == table_name,
            )
        )
        row = existing.scalar_one_or_none()
        if row is None:
            row = TableComment(
                db_name=db_name,
                schema_name=schema_name,
                table_name=table_name,
            )
            session.add(row)
        row.comment = comment
        row.columns_desc = columns_desc
        if vec is not None:
            row.embedding = vec
        row.last_indexed_at = datetime.now(timezone.utc)
        await session.commit()


async def search_tables(
    query: str, db_name: str, top_k: int = 5
) -> List[Dict[str, object]]:
    """从 table_comments 召回相关表。

    优先使用 pgvector cosine_distance 向量召回；任一环节失败均降级返回
    top_k 行无 score 数据（score=0.0），保证调用方链路不中断。
    """
    if not query or not db_name:
        return []

    try:
        qvec = await embed(query)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}search_tables embed 失败，降级全表返回: "
            f"{type(e).__name__}: {e}"
        )
        async with get_session()() as session:
            rows = await session.execute(
                select(TableComment.table_name, TableComment.comment)
                .where(TableComment.db_name == db_name)
                .limit(top_k * 2)
            )
            return [
                {"table_name": r[0], "comment": r[1], "score": 0.0}
                for r in rows.all()
            ]

    async with get_session()() as session:
        try:
            stmt = (
                select(
                    TableComment,
                    TableComment.embedding.cosine_distance(qvec).label("dist"),
                )
                .where(TableComment.db_name == db_name)
                .order_by("dist")
                .limit(top_k)
            )
            rows = await session.execute(stmt)
            return [
                {
                    "table_name": r[0].table_name,
                    "comment": r[0].comment,
                    "score": 1.0 - r[1],
                }
                for r in rows.all()
            ]
        except Exception as e:
            logger.warning(
                f"{get_request_id()}search_tables 向量检索失败，降级取前 N 行: "
                f"{type(e).__name__}: {e}"
            )
            rows = await session.execute(
                select(TableComment).where(TableComment.db_name == db_name)
            )
            scalars = rows.scalars().all()[:top_k]
            return [
                {"table_name": r.table_name, "comment": r.comment, "score": 0.0}
                for r in scalars
            ]


async def upsert_document_chunk(
    user_id: Optional[int],
    doc_name: str,
    chunk_index: int,
    content: str,
) -> DocumentChunk:
    """写入一条 document_chunks 记录，自动生成 embedding。返回新建模型实例。"""
    vec: Optional[List[float]] = None
    try:
        vec = await embed(content)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}upsert_document_chunk embed 失败 doc={doc_name}: "
            f"{type(e).__name__}: {e}"
        )

    async with get_session()() as session:
        chunk = DocumentChunk(
            user_id=user_id,
            doc_name=doc_name,
            chunk_index=chunk_index,
            content=content,
            embedding=vec,
        )
        session.add(chunk)
        await session.commit()
        await session.refresh(chunk)
        return chunk


async def search_documents(
    query: str, user_id: Optional[int], top_k: int = 3
) -> List[Dict[str, object]]:
    """从 document_chunks 召回相关分片。

    user_id 非 None 时仅检索该用户的全局+私有文档；None 时仅全局。
    embedding 不可用时返回空列表（KB 工具会降级提示"知识库未索引"）。
    """
    if not query:
        return []

    try:
        qvec = await embed(query)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}search_documents embed 失败,返回空: "
            f"{type(e).__name__}: {e}"
        )
        return []

    async with get_session()() as session:
        try:
            from sqlalchemy import or_

            stmt = (
                select(
                    DocumentChunk,
                    DocumentChunk.embedding.cosine_distance(qvec).label("dist"),
                )
                .where(
                    or_(
                        DocumentChunk.user_id.is_(None),
                        DocumentChunk.user_id == user_id,
                    )
                )
                .order_by("dist")
                .limit(top_k)
            )
            rows = await session.execute(stmt)
            return [
                {
                    "doc_name": r[0].doc_name,
                    "content": r[0].content,
                    "score": 1.0 - r[1],
                }
                for r in rows.all()
            ]
        except Exception as e:
            logger.warning(
                f"{get_request_id()}search_documents 向量检索失败,返回空: "
                f"{type(e).__name__}: {e}"
            )
            return []
