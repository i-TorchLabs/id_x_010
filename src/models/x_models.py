from datetime import datetime, timezone
from typing import List, Optional

import os
import uuid

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)

try:
    # pgvector 提供向量列类型，用于 RAG 召回 / Few-Shot 检索。
    # 缺失时退回 JSON，保证模型可在未启用扩展的环境下导入。
    from pgvector.sqlalchemy import Vector

    EMBEDDING_DIM = 1024  # Qwen3-Embedding-8B 维度
    EmbeddingType = Vector(EMBEDDING_DIM)
except ImportError:  # pragma: no cover - 仅在缺失依赖时触发
    EmbeddingType = JSON()
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    mapped_column,
    relationship,
)


class Base(DeclarativeBase):
    pass


# ==========================================
# 全局会话工厂，由 main.py 在 Litestar 启动后注入
# ==========================================
_session_maker: Optional[async_sessionmaker[AsyncSession]] = None


def set_session_maker(maker: async_sessionmaker[AsyncSession]) -> None:
    """由 main.py 调用，将 SQLAlchemyPlugin 提供的 session_maker 注入全局。"""
    global _session_maker
    _session_maker = maker


def get_session() -> async_sessionmaker[AsyncSession]:
    """获取全局 session_maker，供控制器和视图使用。"""
    if _session_maker is None:
        raise RuntimeError("数据库会话工厂未初始化，请先调用 set_session_maker()")
    return _session_maker


# ==========================================
# LLM 提供商配置缓存，由 views.load_llm_provider_config() 按
# LLM_PROVIDER 从 external_provider / local_provider 表读取后注入
# ==========================================
_llm_provider_config: Optional[dict] = None


def set_llm_provider_config(config: Optional[dict]) -> None:
    """由 views 层调用，将提供商表读取结果注入全局缓存，供各 Agent 同步读取。"""
    global _llm_provider_config
    _llm_provider_config = config


def get_external_model_config():
    """外部模型提供商配置：优先取 external_provider 表（经缓存），表无数据时回退环境变量。"""
    if _llm_provider_config and _llm_provider_config.get("provider") == "external":
        return {
            "model_name": os.getenv("EXTERNAL_LLM_MODEL"),
            "base_url": _llm_provider_config.get("llm_base_url"),
            "api_key": _llm_provider_config.get("api_key"),
            "embd_base_url": _llm_provider_config.get("embd_base_url"),
            "vl_base_url": _llm_provider_config.get("vl_base_url"),
        }
    return {
        "model_name": os.getenv("EXTERNAL_LLM_MODEL"),
        "base_url": os.getenv("EXTERNAL_BASE_URL")
        or os.getenv("EXTERNAL_LLM_BASE_URL", "https://api.siliconflow.cn/v1"),
        "api_key": os.getenv("EXTERNAL_API_KEY"),
        "embd_base_url": os.getenv("EXTERNAL_EMBD_BASE_URL"),
        "vl_base_url": os.getenv("EXTERNAL_VL_BASE_URL"),
    }


def get_local_model_config():
    """本地模型提供商配置：优先取 local_provider 表（经缓存），表无数据时回退环境变量。"""
    if _llm_provider_config and _llm_provider_config.get("provider") == "local":
        return {
            "model_name": os.getenv("LOCAL_LLM_MODEL"),
            "base_url": _llm_provider_config.get("llm_base_url"),
            "api_key": _llm_provider_config.get("api_key"),
            "embd_base_url": _llm_provider_config.get("embd_base_url"),
            "vl_base_url": _llm_provider_config.get("vl_base_url"),
        }
    return {
        "model_name": os.getenv("LOCAL_LLM_MODEL"),
        "base_url": os.getenv("LOCAL_MODEL_BASE_URL")
        or os.getenv("LOCAL_LLM_BASE_URL", "http://localhost:11434/v1"),
        "api_key": os.getenv("LOCAL_MODEL_API_KEY")
        or os.getenv("LOCAL_API_KEY")
        or "ollama",
        "embd_base_url": os.getenv("LOCAL_EMBD_BASE_URL"),
        "vl_base_url": os.getenv("LOCAL_VL_BASE_URL"),
    }


class ConversationLog(Base):
    __tablename__ = "conversation_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[Optional[str]] = mapped_column(
        String(64), index=True, comment="会话 ID"
    )
    user_query: Mapped[str] = mapped_column(Text, nullable=False, comment="用户提问")
    model_response: Mapped[Optional[str]] = mapped_column(Text, comment="模型回答")
    thinking_process: Mapped[Optional[str]] = mapped_column(Text, comment="思考过程")
    model_type: Mapped[Optional[str]] = mapped_column(
        String(32), comment="模型类型: local 或 external"
    )
    model_name: Mapped[Optional[str]] = mapped_column(
        String(128), comment="使用的模型名称"
    )
    intent: Mapped[Optional[str]] = mapped_column(String(64), comment="识别的意图")
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    extra_metadata: Mapped[Optional[dict]] = mapped_column(JSON, comment="元数据")

    def to_dict(self):
        return {
            "id": self.id,
            "conversation_id": self.conversation_id,
            "user_query": self.user_query,
            "model_response": self.model_response,
            "thinking_process": self.thinking_process,
            "model_type": self.model_type,
            "model_name": self.model_name,
            "intent": self.intent,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "metadata": self.extra_metadata,
        }


class UsageLog(Base):
    """用量日志：每轮流式对话结束后写入一行，记录 token 消耗与估算花费。

    供前端“流量统计”面板按日聚合展示。user_id 在用户登录时填充，未登录时为
    None（匿名用量不纳入个人统计，但表中仍保留以便后续全局分析）。
    """

    __tablename__ = "usage_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, comment="用户ID（未登录时为 NULL）"
    )
    conversation_id: Mapped[Optional[str]] = mapped_column(
        String(64), comment="会话 ID"
    )
    model_name: Mapped[Optional[str]] = mapped_column(
        String(128), comment="调用的模型名称"
    )
    model_type: Mapped[Optional[str]] = mapped_column(
        String(32), comment="模型类型: local 或 external"
    )
    intent: Mapped[Optional[str]] = mapped_column(String(64), comment="识别的意图")
    input_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="输入 token 数"
    )
    output_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="输出 token 数"
    )
    total_tokens: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, comment="总 token 数"
    )
    cost_usd: Mapped[float] = mapped_column(
        Float, nullable=False, default=0.0, comment="估算花费（USD），本地模型为 0"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        index=True,
        comment="创建时间",
    )


class UserToken(Base):
    __tablename__ = "user_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, comment="用户ID"
    )
    token: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True, comment="认证令牌"
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, comment="过期时间"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )

    user: Mapped["User"] = relationship("User", back_populates="tokens")

    def is_valid(self) -> bool:
        if self.expires_at is None:
            return False
        return self.expires_at > datetime.now(timezone.utc)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "token": self.token,
            "expires_at": self.expires_at.isoformat()
            if self.expires_at is not None
            else None,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
        }


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True, comment="邮箱"
    )
    phone: Mapped[Optional[str]] = mapped_column(
        String(20), nullable=True, index=True, comment="电话号码"
    )
    password_hash: Mapped[str] = mapped_column(
        String(256), nullable=False, comment="密码哈希"
    )
    display_name: Mapped[Optional[str]] = mapped_column(
        String(64), nullable=True, comment="显示名称（可由用户自定义，空则回退到 email 本地名）"
    )
    avatar: Mapped[Optional[bytes]] = mapped_column(
        LargeBinary, nullable=True, comment="头像图片二进制（BYTEA）"
    )
    is_active: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=True, comment="是否激活"
    )
    # TASK-013：管理员标志位；create_all 在新库自动建字段，已有库需 init.sql ALTER 兼容
    is_admin: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False, comment="是否管理员（控制 /admin 路由与 admin mutation 访问）"
    )
    # TASK-019：密码哈希算法标识；老数据 null 视为 sha256，登录时自动升级为 bcrypt
    password_algo: Mapped[Optional[str]] = mapped_column(
        String(16), default="bcrypt", comment="密码哈希算法：bcrypt / sha256（老数据）"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )

    reset_tokens: Mapped[List["PasswordResetToken"]] = relationship(
        "PasswordResetToken", back_populates="user"
    )

    tokens: Mapped[List["UserToken"]] = relationship("UserToken", back_populates="user")

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "phone": self.phone,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "updated_at": self.updated_at.isoformat()
            if self.updated_at is not None
            else None,
        }


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, comment="用户ID"
    )
    token: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, index=True, comment="重置令牌"
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, comment="过期时间"
    )
    used: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=False, comment="是否已使用"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )

    user: Mapped["User"] = relationship("User", back_populates="reset_tokens")

    def is_valid(self) -> bool:
        if self.used:
            return False
        if self.expires_at is None:
            return False
        return self.expires_at > datetime.now(timezone.utc)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "token": self.token,
            "expires_at": self.expires_at.isoformat()
            if self.expires_at is not None
            else None,
            "used": self.used,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
        }


class ExternalModel(Base):
    __tablename__ = "external_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="模型名称")
    provider: Mapped[str] = mapped_column(String(128), nullable=False, comment="模型商")
    base_url: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="访问地址"
    )
    api_key: Mapped[str] = mapped_column(String(128), nullable=False, comment="API-KEY")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "base_url": self.base_url,
            "api_key": self.api_key,
        }


class UserModelSettings(Base):
    """用户级模型设置（每用户一行），由 /home 设置弹窗保存。

    api_key 按项目既有约定明文存储（与 external_models 一致），
    接口仅返回给令牌属主本人。
    """

    __tablename__ = "user_model_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), unique=True, nullable=False, comment="用户ID"
    )
    provider: Mapped[str] = mapped_column(String(64), nullable=False, comment="模型厂商")
    base_url: Mapped[str] = mapped_column(
        String(256), nullable=False, comment="访问地址"
    )
    api_key: Mapped[str] = mapped_column(String(512), nullable=False, comment="API-KEY")
    model_name: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="模型名称"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "provider": self.provider,
            "base_url": self.base_url,
            "api_key": self.api_key,
            "model_name": self.model_name,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "updated_at": self.updated_at.isoformat()
            if self.updated_at is not None
            else None,
        }


class AgentDBSettings(Base):
    """SQL Agent 目标库连接配置（每行一个可选数据库）。

    取代原 .env 中的 AGENT_DB_* 配置项；db_password 按项目既有约定
    明文存储（与 external_models.api_key 一致）。表无数据时运行侧
    仍回退环境变量 AGENT_DB_*（含 _ENC 加密值）。
    """

    __tablename__ = "agent_db_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_name: Mapped[str] = mapped_column(
        String(128), unique=True, nullable=False, comment="目标库名"
    )
    db_label: Mapped[Optional[str]] = mapped_column(String(128), comment="展示名称")
    db_host: Mapped[str] = mapped_column(String(128), nullable=False, comment="主机地址")
    db_port: Mapped[int] = mapped_column(
        Integer, nullable=False, default=5432, comment="端口"
    )
    db_username: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="用户名"
    )
    db_password: Mapped[str] = mapped_column(
        String(256), nullable=False, comment="密码"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "db_name": self.db_name,
            "db_label": self.db_label,
            "db_host": self.db_host,
            "db_port": self.db_port,
            "db_username": self.db_username,
            "db_password": self.db_password,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "updated_at": self.updated_at.isoformat()
            if self.updated_at is not None
            else None,
        }


class ExternalProvider(Base):
    """外部云端模型提供商配置（取 id 最小行作为当前生效配置）。

    取代原 .env 的 EXTERNAL_API_KEY / EXTERNAL_*_BASE_URL 配置项；
    LLM_PROVIDER=external 时由 views 层读入缓存。api_key 按项目
    既有约定明文存储（与 external_models 一致）。
    """

    __tablename__ = "external_provider"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key: Mapped[str] = mapped_column(String(512), nullable=False, comment="API-KEY")
    llm_base_url: Mapped[str] = mapped_column(
        String(256), nullable=False, comment="LLM 访问地址"
    )
    embd_base_url: Mapped[Optional[str]] = mapped_column(
        String(256), comment="Embedding 访问地址"
    )
    vl_base_url: Mapped[Optional[str]] = mapped_column(
        String(256), comment="视觉模型访问地址"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "api_key": self.api_key,
            "llm_base_url": self.llm_base_url,
            "embd_base_url": self.embd_base_url,
            "vl_base_url": self.vl_base_url,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "updated_at": self.updated_at.isoformat()
            if self.updated_at is not None
            else None,
        }


class LocalProvider(Base):
    """本地 Ollama 模型提供商配置（取 id 最小行作为当前生效配置）。

    取代原 .env 的 LOCAL_API_KEY / LOCAL_*_BASE_URL 配置项；
    LLM_PROVIDER=local 时由 views 层读入缓存。
    """

    __tablename__ = "local_provider"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    api_key: Mapped[str] = mapped_column(String(512), nullable=False, comment="API-KEY")
    llm_base_url: Mapped[str] = mapped_column(
        String(256), nullable=False, comment="LLM 访问地址"
    )
    embd_base_url: Mapped[Optional[str]] = mapped_column(
        String(256), comment="Embedding 访问地址"
    )
    vl_base_url: Mapped[Optional[str]] = mapped_column(
        String(256), comment="视觉模型访问地址"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "api_key": self.api_key,
            "llm_base_url": self.llm_base_url,
            "embd_base_url": self.embd_base_url,
            "vl_base_url": self.vl_base_url,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "updated_at": self.updated_at.isoformat()
            if self.updated_at is not None
            else None,
        }


class LocalModel(Base):
    __tablename__ = "local_models"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="模型名称")
    provider: Mapped[str] = mapped_column(String(128), nullable=False, comment="模型商")
    base_url: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="访问地址"
    )
    api_key: Mapped[str] = mapped_column(String(128), nullable=False, comment="API-KEY")

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "provider": self.provider,
            "base_url": self.base_url,
            "api_key": self.api_key,
        }


class UserMarkdownPrompt(Base):
    """用户级 Markdown 提示词库。

    每用户可保存多条 Markdown 文件内容；同一用户同时仅有一条 is_active=True，
    该条目的 content 会在每轮对话中作为系统提示词注入模型调用。

    filename 保留原始文件名作溯源，note_name 是用户自定义的备注名（如"SQL 规范"），
    为空时前端展示回退到 filename。
    """

    __tablename__ = "user_markdown_prompts"
    __table_args__ = (
        UniqueConstraint("user_id", "filename", name="uq_user_markdown_filename"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), nullable=False, index=True, comment="用户ID"
    )
    filename: Mapped[str] = mapped_column(
        String(256), nullable=False, comment="原始文件名"
    )
    note_name: Mapped[Optional[str]] = mapped_column(
        String(256), nullable=True, default=None, comment="备注名称，空则回退 filename"
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="Markdown 文本内容")
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, comment="是否为当前选中的提示词"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "filename": self.filename,
            "note_name": self.note_name,
            "content": self.content,
            "is_active": self.is_active,
            "char_count": len(self.content) if self.content else 0,
            "created_at": self.created_at.isoformat()
            if self.created_at is not None
            else None,
            "updated_at": self.updated_at.isoformat()
            if self.updated_at is not None
            else None,
        }


class TableComment(Base):
    """表注释索引：为每张表存储中文描述、列描述与 embedding 向量。

    由 ``src/utils/x_indexer.py`` 调用 ``x_vectorstore.upsert_table_comment`` 写入，
    供 SQL Agent 在生成 SQL 前按用户问题向量化召回 top-N 相关表（TASK-002）。
    db_name + table_name 组合唯一标识一行；reindex 幂等。
    """

    __tablename__ = "table_comments"
    __table_args__ = (
        UniqueConstraint(
            "db_name", "table_name", name="uq_table_comments_db_table"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_name: Mapped[str] = mapped_column(
        String(128), nullable=False, index=True, comment="目标库名（agent_db_settings.db_name）"
    )
    schema_name: Mapped[str] = mapped_column(
        String(64), nullable=False, default="public", comment="PG schema 名"
    )
    table_name: Mapped[str] = mapped_column(
        String(128), nullable=False, comment="表名（不含 schema 前缀）"
    )
    comment: Mapped[Optional[str]] = mapped_column(Text, comment="表注释，人工或 pg_description 抽取")
    columns_desc: Mapped[Optional[dict]] = mapped_column(
        JSON, comment="列名→列描述的字典"
    )
    embedding = mapped_column(EmbeddingType, nullable=True, comment="表描述向量（pgvector）")
    last_indexed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), comment="最后一次索引时间"
    )


class DocumentChunk(Base):
    """用户文档分片：供 General Agent 的 KB 检索工具召回。

    user_id 为 NULL 时表示全局文档。embedding 缺失时不参与向量召回，
    工具层降级返回"知识库未索引"（见 TASK-004 x_kb_tool）。
    """

    __tablename__ = "document_chunks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, comment="用户ID（NULL 表示全局）"
    )
    doc_name: Mapped[str] = mapped_column(String(256), nullable=False, comment="文档名（含扩展名）")
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False, comment="文档内分片序号")
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="分片文本内容")
    embedding = mapped_column(EmbeddingType, nullable=True, comment="分片向量（pgvector）")
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class ConversationSummary(Base):
    """会话滚动摘要 + 实体记忆：长期记忆的核心存储。

    每个 conversation_id 一行。summary 为历史对话压缩后的中文摘要，
    entity_memory 是关键实体→值的字典（用作 system prompt 注入），
    message_count 是已纳入摘要的 ConversationLog id 上限。
    新消息超过 SUMMARY_TRIGGER 后 maybe_summarize 触发新一轮摘要。
    """

    __tablename__ = "conversation_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(
        String(64), index=True, nullable=False, comment="会话 ID"
    )
    summary: Mapped[str] = mapped_column(Text, nullable=False, comment="对话历史滚动摘要")
    entity_memory: Mapped[Optional[dict]] = mapped_column(
        JSON, comment="实体→值映射（如 {'order_id': '12345'}）"
    )
    message_count: Mapped[int] = mapped_column(
        Integer, default=0, comment="已纳入摘要的 ConversationLog 数量"
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        comment="更新时间",
    )


class SqlExample(Base):
    """SQL Few-Shot 例子库（TASK-009）：仅 SQL Agent 召回使用，不暴露给其它 Agent。

    db_name 与目标库一一对应（agent_db_settings.db_name），question 为自然语言
    问题，sql 为正确 SQL，explanation 为可选说明。embedding 由 x_fewshot 写入时
    生成（用 x_vectorstore.embed）， retrieval 时计算 query 向量后做余弦相似度排序。
    """

    __tablename__ = "sql_examples"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    db_name: Mapped[str] = mapped_column(
        String(128), nullable=False, index=True, comment="目标库名"
    )
    question: Mapped[str] = mapped_column(Text, nullable=False, comment="自然语言问题")
    sql: Mapped[str] = mapped_column(Text, nullable=False, comment="正确 SQL 语句")
    explanation: Mapped[Optional[str]] = mapped_column(Text, comment="SQL 说明（可选）")
    embedding = mapped_column(JSON, nullable=True, comment="问题向量（JSON 列表）")
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, comment="是否启用（admin 可禁用个别例子）"
    )
    created_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class ApprovalTask(Base):
    """SQL 审批任务持久化（TASK-012）：让审批可跨浏览器/进程恢复。

    状态机：pending → approved / rejected / cancelled / timeout。
    创建时落库 + 发布到 ``/ws/approval``；审批 mutation 更新状态后 publish，
    LangGraph supervisor 通过 conversation_id 作为 thread_id 从 checkpoint 恢复执行。
    timeout_at 默认 30 分钟；后台 cleanup_expired_tasks 扫描改状态为 timeout。
    """

    __tablename__ = "approval_tasks"

    id: Mapped[str] = mapped_column(
        String(64),
        primary_key=True,
        comment="任务 ID（UUID）",
    )
    conversation_id: Mapped[str] = mapped_column(
        String(64), index=True, nullable=False, comment="会话 ID"
    )
    sql: Mapped[str] = mapped_column(Text, nullable=False, comment="待审批 SQL")
    sql_meaning: Mapped[Optional[str]] = mapped_column(Text, comment="SQL 自然语言含义")
    question: Mapped[str] = mapped_column(Text, nullable=False, comment="用户原始问题")
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), comment="发起用户 ID"
    )
    status: Mapped[str] = mapped_column(
        String(32), default="pending", comment="pending/approved/rejected/cancelled/timeout"
    )
    assigned_to: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), comment="审批管理员 ID"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), comment="审批完成时间"
    )
    timeout_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, comment="超时时间（默认 +30min）"
    )


class ReportSubscription(Base):
    """报告订阅（TASK-014）：定时执行 SQL，结果存 ``reports/`` 目录。

    由系统 cron 调用 ``ops/scripts/run_reports.sh`` →
    ``x_report_runner.run_due_subscriptions`` 触发。本期不引入异步队列（已排除）。
    cron 字段为标准 5 段 cron 表达式，run_due_subscriptions 用 croniter 库判断
    是否到期（croniter 为可选依赖，缺失时所有订阅都不会被执行）。
    """

    __tablename__ = "report_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id"), comment="订阅属主"
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False, comment="订阅名")
    cron: Mapped[str] = mapped_column(
        String(64), nullable=False, comment="cron 表达式，如 '0 9 * * 1'"
    )
    query_template: Mapped[str] = mapped_column(
        Text, nullable=False, comment="SQL 查询模板（可直接执行）"
    )
    format: Mapped[str] = mapped_column(
        String(16), default="xlsx", comment="导出格式：xlsx / csv / json"
    )
    recipients: Mapped[Optional[dict]] = mapped_column(
        JSON, comment="邮箱列表，如 {'emails': ['a@b.com']}"
    )
    db_name: Mapped[Optional[str]] = mapped_column(
        String(128), comment="目标库名（agent_db_settings.db_name）"
    )
    last_run_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), comment="上次执行时间"
    )
    last_run_status: Mapped[Optional[str]] = mapped_column(
        String(32), comment="上次执行状态：success / failed"
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, comment="是否启用"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class UploadedImage(Base):
    """用户上传的图片（TASK-015）：供 VL Agent 视觉多模态分析。

    存原始二进制而非 base64/磁盘文件——避免 GC 复杂；avatar 也是 BYTEA 存储，
    保持一致。VL Agent 取图时按 id 查 → base64 → 注入 LLM。
    """

    __tablename__ = "uploaded_images"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, comment="上传者 ID"
    )
    filename: Mapped[str] = mapped_column(String(256), nullable=False, comment="原始文件名")
    mime: Mapped[str] = mapped_column(String(64), nullable=False, comment="MIME 类型")
    data: Mapped[bytes] = mapped_column(
        LargeBinary, nullable=False, comment="图片二进制"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class PromptTemplate(Base):
    """Prompt 模板（TASK-018）：让 admin 在 UI 改 prompt 后无需发版即可生效。

    三个 Agent 各自独立调用 load_prompt(key, **vars)；未配置时回退到
    DEFAULTS 字典中硬编码的默认值（与改造前行为一致）。模块头注释（x_prompts.py）
    明确指出"三个 Agent 各自独立调用，不引入联动"。
    """

    __tablename__ = "prompt_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(
        String(64), index=True, nullable=False, comment="prompt key，如 general.system"
    )
    version: Mapped[int] = mapped_column(
        Integer, default=1, comment="版本号，新版本自动 +1"
    )
    content: Mapped[str] = mapped_column(Text, nullable=False, comment="prompt 正文")
    variables: Mapped[Optional[dict]] = mapped_column(
        JSON, comment="变量声明，如 {'top_k': 'int'}"
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, default=False, comment="是否为该 key 当前激活版本"
    )
    created_by: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), comment="创建人 ID"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class UserFeedback(Base):
    """用户反馈（TASK-017）：每条 assistant 消息的 👍/👎 + 备注。

    rating=1 表示赞，-1 表示踩；feedback_text 为可选详细说明。
    conversation_id + message_index 组合定位某条消息（与前端 message.id 对齐）。
    """

    __tablename__ = "user_feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("users.id"), index=True, comment="反馈提交者 ID"
    )
    conversation_id: Mapped[str] = mapped_column(
        String(64), index=True, nullable=False, comment="会话 ID"
    )
    message_index: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="消息在会话中的序号（0-based）"
    )
    rating: Mapped[int] = mapped_column(
        Integer, nullable=False, comment="1=赞，-1=踩"
    )
    feedback_text: Mapped[Optional[str]] = mapped_column(Text, comment="详细反馈")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class SqlEvalCase(Base):
    """SQL 评估用例（TASK-017）：admin 维护的测试集，评估 NL2SQL 准确率。

    expected_sql 可选（部分场景只需检查 SQL 可执行性即可），tags 用于
    分组统计（如 ["trend", "aggregate"]）。
    """

    __tablename__ = "sql_eval_cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question: Mapped[str] = mapped_column(Text, nullable=False, comment="自然语言问题")
    expected_sql: Mapped[Optional[str]] = mapped_column(Text, comment="期望 SQL（可选）")
    db_name: Mapped[str] = mapped_column(String(128), nullable=False, comment="目标库名")
    tags: Mapped[Optional[dict]] = mapped_column(JSON, comment="标签列表，如 ['trend']")
    enabled: Mapped[bool] = mapped_column(
        Boolean, default=True, comment="是否启用"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )


class SqlEvalResult(Base):
    """SQL 评估结果（TASK-017）：每次 runSqlEval 对每个 case 写一行。

    executable=False 时 error 字段填充错误信息；True 时表示 SQL 可执行
    （不一定与 expected_sql 完全一致——一致性需要 admin 人工评估）。
    """

    __tablename__ = "sql_eval_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    case_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sql_eval_cases.id"), index=True, nullable=False
    )
    generated_sql: Mapped[Optional[str]] = mapped_column(Text, comment="Agent 生成的 SQL")
    executable: Mapped[bool] = mapped_column(
        Boolean, default=False, comment="SQL 是否可执行（语法+权限通过）"
    )
    error: Mapped[Optional[str]] = mapped_column(Text, comment="执行错误信息")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        comment="创建时间",
    )
