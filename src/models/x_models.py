from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
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


def get_external_model_config():
    import os

    return {
        "model_name": os.getenv("EXTERNAL_LLM_MODEL"),
        "base_url": os.getenv("EXTERNAL_BASE_URL", "https://api.siliconflow.cn/v1"),
        "api_key": os.getenv("EXTERNAL_API_KEY"),
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
    is_active: Mapped[Optional[bool]] = mapped_column(
        Boolean, default=True, comment="是否激活"
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
