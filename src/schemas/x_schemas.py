from typing import List, Optional

import strawberry


@strawberry.type
class StreamChunkType:
    type: str = strawberry.field(
        description="块类型: thinking, content, sql_approval, sql_rejected, done, error"
    )
    content: Optional[str] = strawberry.field(default=None, description="内容")
    model_used: Optional[str] = strawberry.field(
        default=None, description="使用的模型名称"
    )
    conversation_id: Optional[str] = strawberry.field(
        default=None, description="会话 ID"
    )
    sql: Optional[str] = strawberry.field(
        default=None, description="SQL 查询语句（仅 sql_approval 类型）"
    )


@strawberry.type
class ModelInfoType:
    name: str = strawberry.field(description="模型名称")
    type: str = strawberry.field(description="模型类型: local 或 external")
    description: Optional[str] = strawberry.field(default=None, description="模型描述")


@strawberry.type
class ModelType:
    id: int = strawberry.field(description="模型ID")
    name: str = strawberry.field(description="模型名称")
    provider: str = strawberry.field(description="模型商")
    base_url: str = strawberry.field(description="访问地址")
    model_type: str = strawberry.field(description="模型类型: local 或 external")


@strawberry.type
class ModelListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    models: List["ModelType"] = strawberry.field(
        default_factory=list, description="模型列表"
    )


@strawberry.type
class DatabaseInfoType:
    key: str = strawberry.field(description="数据库键名（后端使用）")
    label: str = strawberry.field(description="数据库显示名称（前端展示）")


@strawberry.type
class DatabaseListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    databases: List[DatabaseInfoType] = strawberry.field(
        default_factory=list, description="数据库列表"
    )


@strawberry.type
class ChatResponseType:
    response: str = strawberry.field(description="模型的回答")
    thinking: Optional[str] = strawberry.field(default=None, description="思考过程")
    conversation_id: str = strawberry.field(description="会话 ID")
    model_used: str = strawberry.field(description="使用的模型名称")
    success: bool = strawberry.field(default=True, description="是否成功")


@strawberry.type
class HealthType:
    status: str = strawberry.field(description="状态")
    service: str = strawberry.field(description="服务名称")


@strawberry.type
class ErrorType:
    error: str = strawberry.field(description="错误信息")
    detail: Optional[str] = strawberry.field(default=None, description="详细错误信息")


@strawberry.input
class LoginInput:
    email: str = strawberry.field(description="邮箱")
    password: str = strawberry.field(description="密码")


@strawberry.input
class RegisterInput:
    email: str = strawberry.field(description="邮箱")
    password: str = strawberry.field(description="密码")
    confirm_password: str = strawberry.field(description="确认密码")
    phone: Optional[str] = strawberry.field(default=None, description="电话号码")


@strawberry.input
class ForgotPasswordInput:
    email: str = strawberry.field(description="邮箱")


@strawberry.type
class UserInfoType:
    id: int = strawberry.field(description="用户ID")
    email: str = strawberry.field(description="邮箱")
    phone: Optional[str] = strawberry.field(default=None, description="电话号码")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间")


@strawberry.type
class AuthResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    token: Optional[str] = strawberry.field(default=None, description="认证令牌")
    expires_at: Optional[str] = strawberry.field(
        default=None, description="令牌过期时间（ISO格式）"
    )
    user: Optional[UserInfoType] = strawberry.field(
        default=None, description="用户信息"
    )


@strawberry.type
class ForgotPasswordResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    reset_token: Optional[str] = strawberry.field(
        default=None, description="重置令牌（仅用于演示，生产环境应发送邮件）"
    )


@strawberry.input
class ModelSettingsInput:
    provider: str = strawberry.field(description="模型厂商，如 siliconflow/openai/deepseek")
    base_url: str = strawberry.field(description="OpenAI 兼容接口地址")
    api_key: str = strawberry.field(description="API-KEY")
    model_name: str = strawberry.field(description="模型名称")


@strawberry.type
class ModelSettingsType:
    provider: str = strawberry.field(description="模型厂商")
    base_url: str = strawberry.field(description="访问地址")
    api_key: str = strawberry.field(description="API-KEY（仅返回给属主本人）")
    model_name: str = strawberry.field(description="模型名称")
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间")


@strawberry.type
class ModelSettingsResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息（含连通性检测结果）")
    settings: Optional[ModelSettingsType] = strawberry.field(
        default=None, description="模型设置"
    )


@strawberry.input
class ChatInput:
    query: str = strawberry.field(description="用户输入的问题")
    model_type: str = strawberry.field(
        default="external", description="模型类型: local 或 external"
    )
    model_name: Optional[str] = strawberry.field(
        default=None, description="模型名称，如不指定则使用默认模型"
    )
    agent_type: Optional[str] = strawberry.field(
        default=None, description="Agent 类型: general/sql/code，如不指定则自动路由"
    )
    stream: bool = strawberry.field(
        default=False, description="是否使用流式响应（GraphQL 中建议使用 subscription）"
    )
    conversation_id: Optional[str] = strawberry.field(
        default=None, description="会话 ID，用于多轮对话"
    )
    context: Optional[List[str]] = strawberry.field(
        default=None, description="对话上下文（JSON 字符串列表）"
    )
    db_name: Optional[str] = strawberry.field(
        default=None, description="数据库名称，用于 SQL Agent 指定查询的数据库"
    )
