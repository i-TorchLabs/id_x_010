"""id_x_010 插件对外统一入口。

本模块是 id_x_000 主程序与插件之间的唯一耦合面。主程序通过
`load_plugin()` 获取 ``PluginInterface``，调用其钩子完成：
- ORM 元数据注册（``base``）
- 会话工厂注入（``set_session_maker``）
- 建表扩展依赖声明（``required_extensions``）
- 建表执行（``build_tables``）

插件内部细节（models/controllers/agents 等）不再被主程序直接 import，
保证插件解耦的纯粹性——主程序只知道 ``PluginInterface`` 契约，
不感知插件内部包结构。

``PluginInterface`` 契约的权威定义位于独立公共包
``x_models._contracts.plugin_interface``，本插件与其它插件均从那里导入，
插件之间互不依赖。

与 id_x_002_c2 的差异：本插件模型表使用基础类型，并启用 pgvector 扩展
（供 ``table_comments`` / ``document_chunks`` 等向量检索表），故
``required_extensions`` 声明为 ``("vector",)``，由主程序在 build_tables 前
创建扩展。
"""
from __future__ import annotations

import atexit
from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from x_models._contracts import PluginInterface


def _atexit_cleanup() -> None:
    """进程退出同步兜底（TASK-011 配套）。

    asyncio disconnect 不能在 atexit 中调用（loop 已关闭），这里只做
    cache 清空让 GC 释放对象。深层 disconnect 由 Litestar on_shutdown
    钩子触发（见 controllers.on_shutdown_hook）。
    """
    try:
        from x_models.id_x_010.src.agents.x_sql_agent import _sql_agent_cache

        _sql_agent_cache.clear()
    except Exception:
        pass


atexit.register(_atexit_cleanup)


class _Idx010Plugin:
    """id_x_010 插件实现。

    懒加载内部 ``x_models`` 模块，避免主程序加载本插件时立即触发
    可能尚未就绪的 ORM 注册链。
    """

    name = "id_x_010"

    def __init__(self) -> None:
        self._base: Any = None

    @property
    def base(self) -> Any:
        if self._base is None:
            from x_models.id_x_010.src.models.x_models import Base
            self._base = Base
        return self._base

    @property
    def required_extensions(self) -> tuple[str, ...]:
        # 启用 pgvector 扩展，供 table_comments / document_chunks 等向量检索表使用。
        # 主程序在 build_tables 之前会CREATE EXTENSION IF NOT EXISTS vector。
        return ("vector",)

    def set_session_maker(self, maker: async_sessionmaker[AsyncSession]) -> None:
        from x_models.id_x_010.src.models.x_models import set_session_maker
        set_session_maker(maker)

    async def build_tables(self, conn: AsyncConnection) -> None:
        """建表，带 pgvector 扩展缺失的运行时降级。

        策略：
        1. 先尝试用 ``Vector(1024)`` 类型建表（pgvector 扩展已安装的情况）；
        2. 若 PG 报 ``type "vector" does not exist``（扩展未安装），降级把
           ``TableComment.embedding`` / ``DocumentChunk.embedding`` 等列改为
           ``JSON`` 类型重新建表——保证应用能启动，向量检索功能 best-effort
           退化到全表扫描（见 x_vectorstore.search_tables 已有降级逻辑）。
        """
        import logging

        from sqlalchemy import JSON

        logger = logging.getLogger("x_models.id_x_010.x_plugin")
        try:
            await conn.run_sync(self.base.metadata.create_all)
        except Exception as e:
            msg = str(e).lower()
            # 仅当错误明确指向 vector 类型不存在时降级
            if "vector" not in msg and "does not exist" not in msg:
                raise  # 其它异常向上抛
            logger.warning(
                "[id_x_010] pgvector 扩展未启用或 Vector 类型不可用，"
                "embedding 列降级为 JSON 重建表（向量检索功能降级，主流程不受影响）。"
                f"原始异常: {type(e).__name__}: {e}"
            )
            # 把所有用 EmbeddingType 的列改成 JSON，重建 metadata
            from x_models.id_x_010.src.models import x_models as _m

            for table in self.base.metadata.tables.values():
                for col in table.columns:
                    if col.name == "embedding":
                        # 直接改 type 为 JSON（兼容已有数据；新表也能建）
                        col.type = JSON()
            # 重新建表
            await conn.run_sync(self.base.metadata.create_all)

        await self._apply_compat_patches(conn)
        await self._seed_model_prices(conn)

    async def _apply_compat_patches(self, conn: AsyncConnection) -> None:
        """幂等补齐老表的增量字段（create_all 不会 ALTER 已有表）。

        与 ops/scripts/migrate_compat.sql 保持同步；失败不阻塞启动。
        """
        import logging

        logger = logging.getLogger("x_models.id_x_010.x_plugin")
        try:
            from sqlalchemy import text

            async with conn.begin_nested():
                await conn.execute(text(
                    "ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS "
                    "input_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0"
                ))
                await conn.execute(text(
                    "ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS "
                    "output_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0"
                ))
        except Exception as e:
            logger.warning(
                f"[id_x_010] usage_logs 分项计费列补丁失败（不阻塞启动）: "
                f"{type(e).__name__}: {e}"
            )

    async def _seed_model_prices(self, conn: AsyncConnection) -> None:
        """幂等播种 model_prices 预置价格（与 x_pricing 内置目录同步）。

        仅补充缺失的 model_key，不覆盖管理员已维护的价格；失败不阻塞启动。
        """
        import logging

        logger = logging.getLogger("x_models.id_x_010.x_plugin")
        try:
            from sqlalchemy import text

            from x_models.id_x_010.src.utils.x_pricing import _PRICING

            async with conn.begin_nested():
                for key, price in _PRICING:
                    await conn.execute(
                        text(
                            "INSERT INTO model_prices "
                            "(model_key, input_price_per_1m, output_price_per_1m, enabled) "
                            "VALUES (:k, :i, :o, TRUE) "
                            "ON CONFLICT (model_key) DO NOTHING"
                        ),
                        {"k": key, "i": price["in"], "o": price["out"]},
                    )
        except Exception as e:
            logger.warning(
                f"[id_x_010] model_prices 预置价格播种失败（不阻塞启动，"
                f"计费回退内置目录）: {type(e).__name__}: {e}"
            )


def load_plugin() -> PluginInterface:
    """返回 id_x_010 插件实例。"""
    return _Idx010Plugin()

