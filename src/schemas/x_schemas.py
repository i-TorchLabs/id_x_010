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
    display_name: Optional[str] = strawberry.field(
        default=None, description="显示名称（用户可自定义，空则回退到 email 本地名）"
    )
    avatar_url: Optional[str] = strawberry.field(
        default=None, description="头像 URL（已设置头像时为 /b/id_x_010/avatar/<user_id>?v=<ts>）"
    )
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间")


@strawberry.input
class UpdateProfileInput:
    display_name: Optional[str] = strawberry.field(
        default=None, description="新的显示名称；传空串清空，回退到 email 本地名"
    )


@strawberry.type
class UpdateProfileResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    user: Optional[UserInfoType] = strawberry.field(
        default=None, description="更新后的用户信息"
    )


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
class OauthInput:
    """SSO 登录入参：ADFS 授权码授予流。

    - code：ADFS 授权码（response_type=code 回调获得），服务端用
      client_secret 换 id_token，最安全；
    - state：CSRF 防护随机串，由前端生成并在回调时原样回传；
    """

    code: str = strawberry.field(
        default="", description="ADFS 授权码（response_type=code 回调获得）"
    )
    state: str = strawberry.field(
        default="", description="CSRF 防护随机串（与授权请求一致）"
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
class TestConnectionInput:
    """连通性测试入参：仅测试不落库。"""
    base_url: str = strawberry.field(description="OpenAI 兼容接口地址")
    api_key: str = strawberry.field(description="API-KEY")
    model_name: str = strawberry.field(description="模型名称")


@strawberry.type
class TestConnectionResponseType:
    success: bool = strawberry.field(description="连通性是否通过")
    message: str = strawberry.field(description="人类可读的检测结果")


# ---------------------------------------------------------------------------
# 外部模型管理（external_models 表的 CRUD，支持多模型 + Provider 自定义）
# ---------------------------------------------------------------------------


@strawberry.type
class ExternalModelType:
    """external_models 表的完整记录（含 api_key，供弹窗编辑回填）。"""
    id: int = strawberry.field(description="模型记录ID")
    name: str = strawberry.field(description="模型名称")
    provider: str = strawberry.field(description="模型厂商（用户自定义）")
    base_url: str = strawberry.field(description="访问地址")
    api_key: str = strawberry.field(description="API-KEY")


@strawberry.type
class ExternalModelListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    models: List[ExternalModelType] = strawberry.field(
        default_factory=list, description="外部模型列表"
    )


@strawberry.input
class ExternalModelInput:
    """新增 / 更新外部模型入参。id 为 None 时新增，非 None 时更新对应行。"""
    id: Optional[int] = strawberry.field(default=None, description="已有记录ID（更新时传）")
    provider: str = strawberry.field(description="模型厂商（用户自定义）")
    base_url: str = strawberry.field(description="OpenAI 兼容接口地址")
    api_key: str = strawberry.field(description="API-KEY")
    model_name: str = strawberry.field(description="模型名称")
    test_connection: bool = strawberry.field(
        default=True, description="保存前是否做连通性检测"
    )


@strawberry.type
class ExternalModelMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    model: Optional[ExternalModelType] = strawberry.field(
        default=None, description="新增/更新后的模型记录"
    )


@strawberry.type
class DeleteExternalModelResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")


@strawberry.type
class SetActiveModelResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")


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


# ---------------------------------------------------------------------------
# Markdown 提示词库
# ---------------------------------------------------------------------------


@strawberry.type
class MarkdownPromptType:
    id: int = strawberry.field(description="提示词记录ID")
    filename: str = strawberry.field(description="原始文件名")
    note_name: Optional[str] = strawberry.field(
        default=None, description="备注名称，空则展示回退到 filename"
    )
    content: str = strawberry.field(description="Markdown 文本内容")
    is_active: bool = strawberry.field(description="是否为当前选中的提示词")
    char_count: int = strawberry.field(description="字符数")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间")
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间")


@strawberry.type
class MarkdownPromptListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    prompts: List[MarkdownPromptType] = strawberry.field(
        default_factory=list, description="提示词列表"
    )


@strawberry.type
class MarkdownPromptResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    prompt: Optional[MarkdownPromptType] = strawberry.field(
        default=None, description="提示词记录（上传成功或当前选中时返回）"
    )


# ---------------------------------------------------------------------------
# 用量统计（流量统计面板）
# ---------------------------------------------------------------------------


@strawberry.type
class UsageDailyType:
    """单日聚合记录。"""

    date: str = strawberry.field(description="日期（UTC, YYYY-MM-DD）")
    request_count: int = strawberry.field(description="请求次数")
    input_tokens: int = strawberry.field(description="输入 token 合计")
    output_tokens: int = strawberry.field(description="输出 token 合计")
    total_tokens: int = strawberry.field(description="总 token 合计")
    cost_usd: float = strawberry.field(description="花费合计（USD）")


@strawberry.type
class UsageModelBreakdownType:
    """按模型维度的聚合记录。"""

    model_name: str = strawberry.field(description="模型名称")
    request_count: int = strawberry.field(description="请求次数")
    total_tokens: int = strawberry.field(description="总 token 合计")
    cost_usd: float = strawberry.field(description="花费合计（USD）")


@strawberry.type
class UsageStatsResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    days: int = strawberry.field(description="统计天数")
    daily: List[UsageDailyType] = strawberry.field(
        default_factory=list, description="按日聚合明细"
    )
    by_model: List[UsageModelBreakdownType] = strawberry.field(
        default_factory=list, description="按模型聚合明细"
    )
    total_requests: int = strawberry.field(description="请求总次数")
    total_tokens: int = strawberry.field(description="总 token 合计")
    total_cost_usd: float = strawberry.field(description="花费总计（USD）")
