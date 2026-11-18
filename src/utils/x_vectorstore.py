"""向量存储与检索封装。

提供 ``table_comments`` / ``document_chunks`` 两表的写入与召回，
供 SQL Agent 的 Retriever（TASK-002）与 General Agent 的 KB 工具（TASK-004）使用。

embedding 客户端端点优先取"用户在模型列表中选定的模型"（由 SQLAgent /
Supervisor 初始化时经 ``set_endpoint_override`` 登记），回退
``external_provider`` / ``local_provider`` 表配置；模型名默认与用户选定的
模型一致，未登记时回退环境变量 ``EXTERNAL_EMBEDDING_MODEL``（最后回退
``Qwen/Qwen3-Embedding-8B``，1024 维，与 EMBEDDING_DIM 对齐）。

外部第三方 PostgreSQL 部署：embedding 列为 JSON 列表存储（无 pgvector
扩展），召回统一在应用层计算余弦相似度（``_search_rows_json``）。

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

# 【修复】用户选定模型端点的登记（SQLAgent / Supervisor 初始化时写入）：
# embedding 调用优先使用用户在模型列表中选定的模型名与其端点，
# 而非硬编码默认值 Qwen/Qwen3-Embedding-8B——该默认名在网关上
# 无可用渠道时会 503（model_not_found），导致整套向量能力静默失效。
# OpenAI 兼容网关的 /v1/embeddings 与聊天端点同域同 key，直接复用即可。
# 模型名会随用户切换而变，_embeddings_cache 按 cache_key 天然隔离。
_endpoint_override: Dict[str, Optional[str]] = {
    "api_key": None,
    "base_url": None,
    "embedding_model": None,
}


def set_endpoint_override(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None,
    embedding_model: Optional[str] = None,
) -> None:
    """登记用户选定的模型端点，embedding 调用将优先使用（见 _endpoint_override 说明）。

    None 值不覆盖既有登记（避免某次未解析到端点的请求清掉有效配置）。
    """
    if api_key is not None:
        _endpoint_override["api_key"] = api_key
    if base_url is not None:
        _endpoint_override["base_url"] = base_url
    if embedding_model:
        _endpoint_override["embedding_model"] = embedding_model


# 【性能】查询向量短 TTL 缓存：同一问题在一次请求内会被两处独立嵌入
# （x_sql_agent._load_relevant_schema 的表召回 + retrieve_examples 的
# few-shot 召回），远程 embedding 单次 100-500ms，纯属重复推理。
# TTL 5s 只覆盖"同一请求内"的复用，不引入跨请求的陈旧向量。
_query_vec_cache: Dict[str, tuple] = {}
_QUERY_VEC_TTL = 5.0


def get_embeddings() -> OpenAIEmbeddings:
    """构造 embeddings 客户端，端点优先级（见 _endpoint_override 说明）：

    1. 用户在模型列表中选定的模型端点（set_endpoint_override 登记，
       模型名即用户选中的模型——网关对 /v1/embeddings 与聊天同 key 同域）；
    2. external_provider / local_provider 表的 embd_base_url → base_url；
    3. 模型名回退环境变量 EXTERNAL_EMBEDDING_MODEL。
    """
    external_cfg = get_external_model_config()
    local_cfg = get_local_model_config()

    base_url = (
        _endpoint_override.get("base_url")
        or external_cfg.get("embd_base_url")
        or external_cfg.get("base_url")
        or local_cfg.get("embd_base_url")
        or local_cfg.get("base_url")
    )
    api_key = (
        _endpoint_override.get("api_key")
        or external_cfg.get("api_key")
        or local_cfg.get("api_key")
        or "ollama"
    )
    model = (
        _endpoint_override.get("embedding_model")
        or os.getenv("EXTERNAL_EMBEDDING_MODEL")
        or "Qwen/Qwen3-Embedding-8B"
    )

    cache_key = f"{base_url}|{api_key}|{model}"
    cached = _embeddings_cache.get(cache_key)
    if cached is not None:
        return cached

    client = OpenAIEmbeddings(
        model=model,
        openai_api_key=api_key,
        openai_api_base=base_url,
        # 端点无 /v1/embeddings 能力（纯聊天模型/网关）时不要静默重试——
        # 调用方有降级路径，快速失败比双倍等待好
        max_retries=1,
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


async def embed_query_cached(text: str) -> List[float]:
    """同文本短 TTL 内复用查询向量（见 _query_vec_cache 说明）。

    缓存未命中或已过期时调用 embed 并回填。仅用于"用户问题"类短文本
    的查询侧嵌入；写入侧（upsert_*）不走本缓存。
    """
    import time as _time

    now = _time.time()
    cached = _query_vec_cache.get(text)
    if cached is not None and now - cached[0] < _QUERY_VEC_TTL:
        return cached[1]
    vec = await embed(text)
    # 简单容量控制：超 64 条清掉最旧的一半，避免长跑进程无界增长
    if len(_query_vec_cache) >= 64:
        for k in sorted(_query_vec_cache, key=lambda k: _query_vec_cache[k][0])[:32]:
            _query_vec_cache.pop(k, None)
    _query_vec_cache[text] = (now, vec)
    return vec


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


async def _search_rows_json(model, filters, top_k: int, label_fn):
    """应用层余弦相似度召回（外部第三方 PostgreSQL 部署的统一路径）。

    embedding 列为 JSON 列表（无 pgvector 扩展），先取满足过滤条件的行，
    再在 Python 内计算余弦相似度排序取 top_k。embedding 缺失的行
    score=0.0 保留在末尾（与降级路径行为一致）。
    """
    from x_models.id_x_010.src.utils.x_fewshot import _cosine

    async with get_session()() as session:
        rows = await session.execute(select(model).where(*filters))
        entities = rows.scalars().all()
    scored = []
    for r in entities:
        rvec = r.embedding if isinstance(r.embedding, list) else None
        scored.append((_cosine(label_fn(r), rvec) if rvec else 0.0, r))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:top_k]


async def search_tables(
    query: str, db_name: str, top_k: int = 5
) -> List[Dict[str, object]]:
    """从 table_comments 召回相关表。

    embedding 列为 JSON 存储（外部第三方 PostgreSQL，无 pgvector 扩展），
    召回在应用层计算余弦相似度；任一环节失败均降级返回
    top_k 行无 score 数据（score=0.0），保证调用方链路不中断。
    """
    if not query or not db_name:
        return []

    try:
        # 【性能】查询向量走短 TTL 缓存：同一问题在本次请求内已被
        # search_tables 嵌入过一次（或反之），这里直接复用
        qvec = await embed_query_cached(query)
    except Exception as e:
        logger.warning(
            f"{get_request_id()}search_tables embed 失败，降级全表返回: "
            f"{type(e).__name__}: {e}"
        )
        # 【准确性修复】embedding 不可用时不再返回"前 top_k 行无 score 数据"——
        # 无关表的假召回会把 LLM 选表带偏，返回空让上层走全 schema 兜底更稳
        return []

    try:
        scored = await _search_rows_json(
            TableComment,
            [TableComment.db_name == db_name],
            top_k,
            lambda _r: qvec,
        )
        return [
            {"table_name": r.table_name, "comment": r.comment, "score": score}
            for score, r in scored
        ]
    except Exception as e:
        logger.warning(
            f"{get_request_id()}search_tables 向量检索失败，降级取前 N 行: "
            f"{type(e).__name__}: {e}"
        )
        async with get_session()() as session:
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

    try:
        from sqlalchemy import or_

        scored = await _search_rows_json(
            DocumentChunk,
            [
                or_(
                    DocumentChunk.user_id.is_(None),
                    DocumentChunk.user_id == user_id,
                )
            ],
            top_k,
            lambda _r: qvec,
        )
        return [
            {"doc_name": r.doc_name, "content": r.content, "score": score}
            for score, r in scored
        ]
    except Exception as e:
        logger.warning(
            f"{get_request_id()}search_documents 向量检索失败,返回空: "
            f"{type(e).__name__}: {e}"
        )
        return []
