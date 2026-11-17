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

与 id_x_007 的部署模式对齐：连接外部第三方 PostgreSQL（连接参数见
``x_models/id_x_010/.env`` 的 ``DB_*``），不再内置 db 容器 / pgvector
镜像。因此：

- ``required_extensions`` 返回空元组——建表不再依赖任何 PG 扩展；
- 向量检索全部走应用层余弦相似度（embedding 列恒为 JSON 类型，
  ``x_vectorstore`` / ``x_fewshot`` 已有降级路径本就支持纯 Python 召回），
  外部库无须安装 pgvector 扩展；
- 预置数据（提供商 / 目标库 / 系统模型 / SSO / 初始管理员）由
  ``build_tables`` 建表后经 ``x_seed`` 幂等播种（等价于原
  ops/init/02~09 的能力），外部库无须手动执行 init SQL。
"""
from __future__ import annotations

import atexit
import logging
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
        # 外部第三方 PostgreSQL 部署：不依赖任何 PG 扩展（含 pgvector）。
        # embedding 列恒为 JSON 类型，向量召回在应用层计算余弦相似度
        #（见 x_vectorstore.search_tables / x_fewshot 的既有降级路径），
        # 建表无须 superuser 权限。
        return ()

    def set_session_maker(self, maker: async_sessionmaker[AsyncSession]) -> None:
        from x_models.id_x_010.src.models.x_models import set_session_maker
        set_session_maker(maker)

    async def build_tables(self, conn: AsyncConnection) -> None:
        """建表 + 幂等播种（外部第三方 PostgreSQL，无扩展依赖）。

        1. embedding 列恒用 JSON 类型（``x_models.EmbeddingType`` 在缺失
           pgvector 依赖时自动退回 JSON，requirements 已移除 pgvector），
           建表不依赖 vector 扩展；
        2. ``create_all`` 建表（幂等，已有表跳过）；
        3. ``_apply_compat_patches`` 补齐老表增量字段；
        4. ``_seed_model_prices`` / ``x_seed`` 幂等播种预置数据——取代原
           db 容器 docker-entrypoint-initdb.d 自动执行的 ops/init/02~09，
           外部库无须手动跑 init SQL。
        """
        logger = logging.getLogger("x_models.id_x_010.x_plugin")

        await conn.run_sync(self.base.metadata.create_all)

        await self._apply_compat_patches(conn)
        await self._seed_model_prices(conn)
        # 预置数据播种（取代原 db 容器 docker-entrypoint-initdb.d 的
        # ops/init/02~09）；延迟导入保持插件懒加载约定
        from x_models.id_x_010.src.utils.x_seed import (
            seed_initial_admin,
            seed_reference_data,
        )

        for seed_name, seeder in (
            ("reference_data", seed_reference_data),
            ("initial_admin", seed_initial_admin),
        ):
            try:
                async with conn.begin_nested():
                    await seeder(conn)
            except Exception as e:
                logger.warning(
                    f"[id_x_010] 预置数据播种失败（{seed_name}，不阻塞启动）: "
                    f"{type(e).__name__}: {e}"
                )

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

