"""数据库 schema 索引构建器。

遍历目标库 public schema 下的 information_schema.columns 与 pg_description，
为每张表聚合中文列描述，调用 ``x_vectorstore.upsert_table_comment`` 写入
``table_comments`` 表（含 embedding）。

仅由 ``controllers.reindex_schema`` mutation 调用，属于 SQL Agent 的内部
基础设施增强，不引入 Agent 间联动，也不被其它 Agent 直接调用。
"""

from typing import Any, Dict

from utils.log_util import get_request_id, logger
from x_models.id_x_010.src.utils.x_vectorstore import upsert_table_comment

# 查询 public schema 下每张表每列的列名、列注释、数据类型与表注释。
# c.table_name::regclass 转 regclass 后才能拿 col_description；为防止
# 视图/外部表导致 ::regclass 报错，使用 st.relid（pg_statio_all_tables）
# 作为关联键。pgd.objsubid=0 表示表注释（非列注释）。
SCHEMA_QUERY = """
SELECT
    c.table_name,
    pgd.description AS table_comment,
    c.column_name,
    pg_catalog.col_description(st.relid, c.ordinal_position) AS col_comment,
    c.data_type
FROM information_schema.columns c
LEFT JOIN pg_catalog.pg_statio_all_tables st
    ON st.relname = c.table_name AND st.schemaname = c.table_schema
LEFT JOIN pg_catalog.pg_description pgd
    ON pgd.objoid = st.relid AND pgd.objsubid = 0
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;
"""


async def index_database(db_name: str, db_conn: Any) -> int:
    """遍历目标库 information_schema，为每张表生成描述并 upsert 到 table_comments。

    Args:
        db_name: 目标库逻辑名（agent_db_settings.db_name）。仅用作 table_comments
            表的 db_name 索引键，不参与实际查询（实际查的是 db_conn 所连库）。
        db_conn: 已连接的 SQLAgent DatabaseConnection。通过 execute_query(..., internal=True)
            跳过受保护 schema 检查，能查 information_schema。

    Returns:
        本次实际写入/更新的表数（不含被 PROTECTED_TABLES 屏蔽的表）。

    异常处理：每张表独立 try/except，单个表失败不阻塞整体索引。
    """
    rows, _ = await db_conn.execute_query(SCHEMA_QUERY, internal=True)

    # 按表聚合列描述：{ table_name: {"comment": str, "cols": {col_name: desc}} }
    grouped: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        tname = r.get("table_name") or ""
        if not tname:
            continue
        bucket = grouped.setdefault(
            tname, {"comment": r.get("table_comment") or "", "cols": {}}
        )
        col_name = r.get("column_name") or ""
        col_desc = r.get("col_comment") or col_name
        data_type = r.get("data_type") or ""
        bucket["cols"][col_name] = f"{col_desc} ({data_type})"

    # 延迟导入避免与 SQLAgent 的 import cycle（SQLAgent 内有 PROTECTED_TABLES）
    from x_models.id_x_010.src.agents.x_sql_agent import PROTECTED_TABLES

    count = 0
    for tname, info in grouped.items():
        if tname.lower() in PROTECTED_TABLES:
            # 受保护表不参与向量召回，避免在 prompt 里被 LLM 看到列结构
            continue
        comment = info["comment"] or tname
        try:
            await upsert_table_comment(db_name, "public", tname, comment, info["cols"])
            count += 1
        except Exception as e:
            logger.warning(
                f"{get_request_id()}index_table 失败 table={tname}: "
                f"{type(e).__name__}: {e}"
            )

    logger.info(
        f"{get_request_id()}index_database 完成 db={db_name} "
        f"indexed={count}/{len(grouped)} (屏蔽 {len(grouped) - count} 张)"
    )
    return count
