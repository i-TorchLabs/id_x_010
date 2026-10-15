from typing import List, Optional

import strawberry


@strawberry.type
class StreamChunkType:
    type: str = strawberry.field(
        description="块类型: thinking, content, sql_generated, sql_explanation, sql_approval, "
        "sql_rejected, sql_cancelled, security_block, tool_call, result, chart, intent, "
        "start, done, error"
    )
    content: Optional[str] = strawberry.field(default=None, description="内容")
    model_used: Optional[str] = strawberry.field(
        default=None, description="使用的模型名称"
    )
    conversation_id: Optional[str] = strawberry.field(
        default=None, description="会话 ID"
    )
    sql: Optional[str] = strawberry.field(
        default=None, description="SQL 查询语句（sql_approval / sql_generated 类型）"
    )
    sql_meaning: Optional[str] = strawberry.field(
        default=None,
        description="SQL 的一句话自然语言含义"
        "（sql_generated / sql_approval / sql_explanation 类型携带，"
        "前端据此渲染独立的「SQL 阐述气泡」）",
    )
    columns: Optional[List[str]] = strawberry.field(
        default=None, description="SQL 查询结果列名（result 类型）"
    )
    data: Optional[str] = strawberry.field(
        default=None, description="SQL 查询结果行 JSON 字符串（result 类型）"
    )
    row_count: Optional[int] = strawberry.field(
        default=None, description="总行数（result 类型）"
    )
    chart_config: Optional[str] = strawberry.field(
        default=None, description="图表配置 JSON 字符串（chart 类型）"
    )
    security_block: Optional[bool] = strawberry.field(
        default=None,
        description="安全机制拦截标记（security_block 类型必填为 true）"
        "——区分于系统错误 error，前端以红色告警样式独立渲染",
    )
    tool_name: Optional[str] = strawberry.field(
        default=None,
        description="工具名称（tool_call 类型携带，标识 General Agent 当前调用的工具）"
        "——仅 General Agent 输出，SQL/Code Agent 不会出现此字段",
    )
    tool_output: Optional[str] = strawberry.field(
        default=None,
        description="工具输出摘要（tool_call end 类型携带，便于前端展示简短结果）",
    )


@strawberry.type
class ModelInfoType:
    name: str = strawberry.field(description="模型名称")
    type: str = strawberry.field(description="模型类型: local 或 external")
    description: Optional[str] = strawberry.field(default=None, description="模型描述")


@strawberry.type
class ModelType:
    id: int = strawberry.field(description="模型ID（合并列表内唯一，仅供前端 Select key 使用）")
    name: str = strawberry.field(description="模型名称")
    provider: str = strawberry.field(description="模型商")
    base_url: str = strawberry.field(description="访问地址")
    model_type: str = strawberry.field(description="模型类型: local 或 external")
    is_default: bool = strawberry.field(
        default=False,
        description="是否为当前用户的默认模型（用户级默认优先于系统级默认）",
    )
    is_system: bool = strawberry.field(
        default=False,
        description="是否为系统预置模型（True=只读，用户无法在设置弹窗中修改）",
    )


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
    role: Optional[str] = strawberry.field(
        default=None,
        description="登录场景角色校验：传入 'admin' 则仅允许管理员登录，"
        "'user' 仅允许普通用户登录；留空表示不校验（兼容旧客户端）",
    )


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
    role: Optional[str] = strawberry.field(
        default=None, description="用户角色（逗号分隔多角色）：user / admin / user,admin"
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
    model_name: str = strawberry.field(description="默认模型名称（须在 model_name_list 内）")
    model_name_list: List[str] = strawberry.field(
        description="可选模型名称列表，消息输入框的模型选择器据此渲染"
    )
    quota_limit_monthly_usd: Optional[float] = strawberry.field(
        default=None,
        description="月度额度上限（USD，自然月聚合）；为空表示不限额",
    )


@strawberry.type
class ModelSettingsType:
    provider: str = strawberry.field(description="模型厂商")
    base_url: str = strawberry.field(description="访问地址")
    api_key: str = strawberry.field(description="API-KEY（仅返回给属主本人）")
    model_name: str = strawberry.field(description="默认模型名称")
    model_name_list: List[str] = strawberry.field(description="可选模型名称列表")
    quota_limit_monthly_usd: Optional[float] = strawberry.field(
        default=None, description="月度额度上限（USD）；NULL 表示不限额"
    )
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间")


@strawberry.type
class ModelSettingsResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息（含连通性检测结果）")
    settings: Optional[ModelSettingsType] = strawberry.field(
        default=None, description="模型设置"
    )


# ---------------------------------------------------------------------------
# 用户自定义模型 Provider（user_model_providers 表，每用户多行）
# ---------------------------------------------------------------------------


@strawberry.type
class UserModelPropertyType:
    """user_model_providers 表的展示视图。"""
    id: int = strawberry.field(description="Provider 记录 ID")
    provider: str = strawberry.field(description="模型厂商")
    base_url: str = strawberry.field(description="访问地址")
    api_key: str = strawberry.field(description="API-KEY（仅返回给属主本人）")
    model_name_list: List[str] = strawberry.field(
        default_factory=list, description="该 Provider 下可选的模型名称列表"
    )
    sort_order: int = strawberry.field(description="排序序号")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间 ISO")


@strawberry.type
class UserModelPropertyListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    providers: List[UserModelPropertyType] = strawberry.field(
        default_factory=list, description="用户 Provider 列表"
    )


@strawberry.input
class UserModelPropertyInput:
    """新增 / 更新用户 Provider 入参。id 为 None 时按 provider 名新增。"""
    id: Optional[int] = strawberry.field(default=None, description="已有记录 ID（更新时传）")
    provider: str = strawberry.field(description="模型厂商，如 siliconflow/openai")
    base_url: str = strawberry.field(description="OpenAI 兼容接口地址")
    api_key: str = strawberry.field(description="API-KEY")
    model_name_list: List[str] = strawberry.field(
        description="该 Provider 下可选的模型名称列表"
    )
    sort_order: int = strawberry.field(default=0, description="排序序号")
    test_connection: bool = strawberry.field(
        default=True, description="保存前是否对第一个模型做连通性检测"
    )


@strawberry.type
class UserModelPropertyMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    provider: Optional[UserModelPropertyType] = strawberry.field(
        default=None, description="新增/更新后的 Provider 记录"
    )


@strawberry.input
class SaveDefaultModelInput:
    """设置用户默认模型（跨 Provider 选择）。"""
    model_name: str = strawberry.field(description="默认模型名称")
    quota_limit_monthly_usd: Optional[float] = strawberry.field(
        default=None, description="月度额度上限（USD）；留空表示不限额"
    )


@strawberry.type
class SaveDefaultModelResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    model_name: Optional[str] = strawberry.field(default=None, description="已设置的默认模型名")
    quota_limit_monthly_usd: Optional[float] = strawberry.field(
        default=None, description="已设置的月度配额"
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


# ---------------------------------------------------------------------------
# Schema 索引重建（TASK-003）：触发 x_indexer.index_database 重建 table_comments
# ---------------------------------------------------------------------------


@strawberry.type
class ReindexResponseType:
    """reindexSchema mutation 的返回：索引统计与人类可读消息。"""
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    indexed_count: int = strawberry.field(description="本次实际写入/更新表数")


# ---------------------------------------------------------------------------
# SQL Few-Shot 例子库（TASK-009）：仅 SQL Agent 召回使用
# ---------------------------------------------------------------------------


@strawberry.type
class SqlExampleType:
    """sql_examples 表的完整记录。"""
    id: int = strawberry.field(description="例子 ID")
    db_name: str = strawberry.field(description="目标库名")
    question: str = strawberry.field(description="自然语言问题")
    sql: str = strawberry.field(description="正确 SQL")
    explanation: Optional[str] = strawberry.field(default=None, description="SQL 说明")
    enabled: bool = strawberry.field(description="是否启用")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO 字符串")


@strawberry.input
class SqlExampleInput:
    """新增/更新 SQL 例子入参。id 为 None 时新增，非 None 时更新对应行。"""
    id: Optional[int] = strawberry.field(default=None, description="已有例子 ID（更新时传）")
    db_name: str = strawberry.field(description="目标库名")
    question: str = strawberry.field(description="自然语言问题")
    sql: str = strawberry.field(description="正确 SQL")
    explanation: Optional[str] = strawberry.field(default=None, description="SQL 说明")
    enabled: bool = strawberry.field(default=True, description="是否启用")


@strawberry.type
class SqlExampleMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    example: Optional[SqlExampleType] = strawberry.field(default=None, description="新增/更新后的例子")


@strawberry.type
class SqlExampleListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    examples: List[SqlExampleType] = strawberry.field(
        default_factory=list, description="SQL 例子列表"
    )


# ---------------------------------------------------------------------------
# SQL 审批任务（TASK-012）：ApprovalTask 表的 GraphQL 视图
# ---------------------------------------------------------------------------


@strawberry.type
class ApprovalTaskType:
    """approval_tasks 表的展示视图。"""
    id: str = strawberry.field(description="任务 ID")
    conversation_id: str = strawberry.field(description="会话 ID")
    sql: str = strawberry.field(description="待审批 SQL")
    sql_meaning: Optional[str] = strawberry.field(default=None, description="自然语言含义")
    question: str = strawberry.field(description="用户原始问题")
    user_id: Optional[int] = strawberry.field(default=None, description="发起用户 ID")
    status: str = strawberry.field(description="pending/approved/rejected/cancelled/timeout")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")
    timeout_at: Optional[str] = strawberry.field(default=None, description="超时时间 ISO")


@strawberry.type
class ApprovalTaskListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    tasks: List[ApprovalTaskType] = strawberry.field(
        default_factory=list, description="待审批任务列表"
    )


# ---------------------------------------------------------------------------
# 后台运维面板（TASK-013）：管理员可见的用户/模型/数据库管理接口
# ---------------------------------------------------------------------------


@strawberry.type
class AdminUserType:
    """管理员视角的用户记录（不含 password_hash 等敏感字段）。"""
    id: int = strawberry.field(description="用户 ID")
    email: str = strawberry.field(description="邮箱")
    display_name: Optional[str] = strawberry.field(default=None, description="显示名称")
    is_active: bool = strawberry.field(description="是否激活")
    is_admin: bool = strawberry.field(description="是否管理员（admin ∈ role 的派生标志）")
    role: str = strawberry.field(description="用户角色（逗号分隔多角色）：user / admin / user,admin")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间 ISO")


@strawberry.type
class AdminUserListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    users: List[AdminUserType] = strawberry.field(
        default_factory=list, description="用户列表"
    )


@strawberry.type
class AdminMutationResponseType:
    """通用 admin mutation 返回类型（无具体数据返回）。"""
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")


# ---------------------------------------------------------------------------
# 数据导出与定时报告订阅（TASK-014）
# ---------------------------------------------------------------------------


@strawberry.type
class ExportResultResponseType:
    """exportResult mutation 返回：base64 编码的二进制 + 文件名。"""
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    file_name: Optional[str] = strawberry.field(default=None, description="建议保存的文件名")
    content_base64: Optional[str] = strawberry.field(
        default=None, description="文件内容 base64 编码；前端 atob → Blob → a.click() 下载"
    )


@strawberry.input
class ReportSubscriptionInput:
    """新增/更新报告订阅入参。"""
    id: Optional[int] = strawberry.field(default=None, description="已有订阅 ID（更新时传）")
    name: str = strawberry.field(description="订阅名")
    cron: str = strawberry.field(description="cron 表达式，如 '0 9 * * 1'")
    query_template: str = strawberry.field(description="SQL 查询模板")
    format: str = strawberry.field(default="xlsx", description="导出格式：xlsx/csv/json")
    db_name: Optional[str] = strawberry.field(default=None, description="目标库")
    recipients: Optional[str] = strawberry.field(
        default=None, description='邮箱 JSON 字符串，如 \'{"emails":["a@b.com"]}\''
    )
    enabled: bool = strawberry.field(default=True, description="是否启用")


@strawberry.type
class ReportSubscriptionType:
    """report_subscriptions 表的展示视图。"""
    id: int = strawberry.field(description="订阅 ID")
    user_id: int = strawberry.field(description="属主用户 ID")
    name: str = strawberry.field(description="订阅名")
    cron: str = strawberry.field(description="cron 表达式")
    query_template: str = strawberry.field(description="SQL 模板")
    format: str = strawberry.field(description="格式")
    db_name: Optional[str] = strawberry.field(default=None, description="目标库")
    enabled: bool = strawberry.field(description="是否启用")
    last_run_at: Optional[str] = strawberry.field(default=None, description="上次执行 ISO")
    last_run_status: Optional[str] = strawberry.field(default=None, description="上次状态")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")


@strawberry.type
class ReportSubscriptionListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    subscriptions: List[ReportSubscriptionType] = strawberry.field(
        default_factory=list, description="订阅列表"
    )


@strawberry.type
class ReportSubscriptionMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    subscription: Optional[ReportSubscriptionType] = strawberry.field(
        default=None, description="新增/更新后的订阅"
    )


# ---------------------------------------------------------------------------
# Prompt 工作台（TASK-018）
# ---------------------------------------------------------------------------


@strawberry.type
class PromptTemplateType:
    """prompt_templates 表的展示视图。"""
    id: int = strawberry.field(description="模板 ID")
    key: str = strawberry.field(description="prompt key，如 general.system")
    version: int = strawberry.field(description="版本号")
    content: str = strawberry.field(description="prompt 正文（可能截断）")
    is_active: bool = strawberry.field(description="是否为当前激活版本")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")


@strawberry.type
class PromptTemplateMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    template: Optional[PromptTemplateType] = strawberry.field(
        default=None, description="新建/更新后的模板"
    )


# ---------------------------------------------------------------------------
# 用户反馈与 SQL 评估（TASK-017）
# ---------------------------------------------------------------------------


@strawberry.type
class UserFeedbackType:
    """user_feedback 表的展示视图。"""
    id: int = strawberry.field(description="反馈 ID")
    user_id: Optional[int] = strawberry.field(default=None, description="提交者 ID")
    conversation_id: str = strawberry.field(description="会话 ID")
    message_index: int = strawberry.field(description="消息序号")
    rating: int = strawberry.field(description="1=赞，-1=踩")
    feedback_text: Optional[str] = strawberry.field(default=None, description="详细反馈")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")


@strawberry.type
class SqlEvalCaseType:
    """sql_eval_cases 表的展示视图。"""
    id: int = strawberry.field(description="用例 ID")
    question: str = strawberry.field(description="自然语言问题")
    expected_sql: Optional[str] = strawberry.field(default=None, description="期望 SQL")
    db_name: str = strawberry.field(description="目标库名")
    tags: Optional[str] = strawberry.field(default=None, description="标签 JSON 字符串")
    enabled: bool = strawberry.field(description="是否启用")


@strawberry.type
class SqlEvalResultType:
    """单次评估结果记录。"""
    case_id: int = strawberry.field(description="用例 ID")
    generated_sql: Optional[str] = strawberry.field(default=None, description="生成 SQL")
    executable: bool = strawberry.field(description="是否可执行")
    error: Optional[str] = strawberry.field(default=None, description="错误信息")


@strawberry.type
class SqlEvalRunResponseType:
    """runSqlEval mutation 返回：总体统计 + 每条 case 结果。"""
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    total: int = strawberry.field(description="总用例数")
    executable_count: int = strawberry.field(description="可执行 SQL 数")
    passing_rate: float = strawberry.field(description="可执行率（0-1）")
    results: List[SqlEvalResultType] = strawberry.field(
        default_factory=list, description="每条 case 结果"
    )


@strawberry.type
class UserFeedbackMutationResponseType:
    """submitFeedback mutation 返回。"""
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    feedback: Optional[UserFeedbackType] = strawberry.field(
        default=None, description="提交后的反馈记录"
    )


# ---------------------------------------------------------------------------
# 系统预置模型（system_model_settings 表，管理员 CRUD，用户只读）
# ---------------------------------------------------------------------------


@strawberry.type
class SystemModelType:
    """system_model_settings 表的展示视图。"""
    id: int = strawberry.field(description="模型记录 ID")
    name: str = strawberry.field(description="模型名称")
    provider: str = strawberry.field(description="模型厂商")
    base_url: str = strawberry.field(description="访问地址")
    api_key: str = strawberry.field(description="API-KEY（含密钥，供管理员编辑回填）")
    model_type: str = strawberry.field(description="模型类型: local 或 external")
    is_default: bool = strawberry.field(description="是否为系统默认模型")
    enabled: bool = strawberry.field(description="是否启用")
    sort_order: int = strawberry.field(description="排序序号（小在前）")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间 ISO")


@strawberry.type
class SystemModelListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    models: List[SystemModelType] = strawberry.field(
        default_factory=list, description="系统预置模型列表"
    )


@strawberry.input
class SystemModelInput:
    """新增 / 更新系统预置模型入参。id 为 None 时按 name 新增，非 None 时更新指定行。"""
    id: Optional[int] = strawberry.field(default=None, description="已有记录 ID（更新时传）")
    name: str = strawberry.field(description="模型名称")
    provider: str = strawberry.field(description="模型厂商")
    base_url: str = strawberry.field(description="OpenAI 兼容接口地址")
    api_key: str = strawberry.field(description="API-KEY")
    model_type: str = strawberry.field(
        default="external", description="模型类型: local 或 external"
    )
    is_default: bool = strawberry.field(
        default=False, description="是否设为系统默认（True 时自动取消其余行的默认标记）"
    )
    enabled: bool = strawberry.field(default=True, description="是否启用")
    sort_order: int = strawberry.field(default=0, description="排序序号")
    test_connection: bool = strawberry.field(
        default=True, description="保存前是否做连通性检测"
    )


@strawberry.type
class SystemModelMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    model: Optional[SystemModelType] = strawberry.field(
        default=None, description="新增/更新后的模型记录"
    )


@strawberry.type
class DeleteSystemModelResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")


# ---------------------------------------------------------------------------
# 用户对系统预置模型的 API Key 映射（system_model_user_mappings 表）
# ---------------------------------------------------------------------------


@strawberry.type
class SystemModelUserMappingType:
    """system_model_user_mappings 表的展示视图。"""
    id: int = strawberry.field(description="映射记录 ID")
    user_id: int = strawberry.field(description="用户 ID")
    system_model_id: int = strawberry.field(description="系统预置模型 ID")
    system_model_name: Optional[str] = strawberry.field(
        default=None, description="系统预置模型名称（JOIN 回填）"
    )
    api_key: str = strawberry.field(description="用户个人 API Key（覆盖全局 key）")
    created_at: Optional[str] = strawberry.field(default=None, description="创建时间 ISO")
    updated_at: Optional[str] = strawberry.field(default=None, description="更新时间 ISO")


@strawberry.type
class SystemModelUserMappingListResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    mappings: List[SystemModelUserMappingType] = strawberry.field(
        default_factory=list, description="用户系统模型映射列表"
    )


@strawberry.input
class SystemModelUserKeyInput:
    """用户保存/更新自己对系统预置模型 API Key 的入参。"""
    system_model_id: int = strawberry.field(description="系统预置模型 ID")
    api_key: str = strawberry.field(description="用户个人 API Key")
    test_connection: bool = strawberry.field(
        default=True, description="保存前是否做连通性检测"
    )


@strawberry.type
class SystemModelUserKeyMutationResponseType:
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    mapping: Optional[SystemModelUserMappingType] = strawberry.field(
        default=None, description="保存后的映射记录"
    )


@strawberry.input
class AdminSystemModelUserKeyInput:
    """管理员为指定用户保存系统预置模型 API Key 的入参。"""
    user_id: int = strawberry.field(description="目标用户 ID")
    system_model_id: int = strawberry.field(description="系统预置模型 ID")
    api_key: str = strawberry.field(description="该用户的个人 API Key")
    test_connection: bool = strawberry.field(
        default=True, description="保存前是否做连通性检测"
    )


# ---------------------------------------------------------------------------
# 后台管理：用户配额 + 全局用量统计
# ---------------------------------------------------------------------------


@strawberry.type
class AdminUserUsageType:
    """单个用户的系统模型用量汇总。"""
    user_id: int = strawberry.field(description="用户 ID")
    email: str = strawberry.field(description="用户邮箱")
    display_name: Optional[str] = strawberry.field(default=None, description="显示名")
    system_model_quota_usd: Optional[float] = strawberry.field(
        default=None, description="系统模型月度配额（USD）；NULL 不限额"
    )
    month_cost_usd: float = strawberry.field(description="本月系统模型花费（USD）")
    month_requests: int = strawberry.field(description="本月系统模型请求数")
    total_cost_usd: float = strawberry.field(description="全部系统模型花费（USD）")


@strawberry.type
class AdminUsageStatsResponseType:
    """管理员用量统计返回：按用户维度聚合。"""
    success: bool = strawberry.field(description="是否成功")
    message: str = strawberry.field(description="消息")
    users: List[AdminUserUsageType] = strawberry.field(
        default_factory=list, description="用户用量列表"
    )
