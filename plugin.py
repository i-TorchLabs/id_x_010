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

与 id_x_002_c2 的差异：本插件模型表仅使用基础类型（Integer/String/Text/
DateTime/JSON/Boolean），不依赖 pgcrypto 的 gen_random_uuid 也不依赖
pgvector，故 ``required_extensions`` 为空元组。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, async_sessionmaker

from x_models._contracts import PluginInterface


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
        # 010 模型表仅用基础类型，不依赖 pgcrypto / pgvector。
        return ()

    def set_session_maker(self, maker: async_sessionmaker[AsyncSession]) -> None:
        from x_models.id_x_010.src.models.x_models import set_session_maker
        set_session_maker(maker)

    async def build_tables(self, conn: AsyncConnection) -> None:
        await conn.run_sync(self.base.metadata.create_all)


def load_plugin() -> PluginInterface:
    """返回 id_x_010 插件实例。"""
    return _Idx010Plugin()
