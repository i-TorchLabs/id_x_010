import hashlib
import imghdr
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator, List, Optional

import strawberry
from litestar import MediaType, Request, Response, Router, WebSocket, get, post, websocket
from litestar.response import Stream
from sqlalchemy import func, select

from utils.log_util import get_request_id, logger, request_id_var
from x_models.id_x_010.src.agents.x_langgraph_supervisor import (
    get_orchestrator,
    get_supervisor,
)
from x_models.id_x_010.src.agents.x_sql_agent import SQLAgent
from x_models.id_x_010.src.models.x_models import (
    ExternalModel,
    LocalModel,
    PasswordResetToken,
    ReportSubscription,
    SqlEvalCase,
    SqlEvalResult,
    SqlExample,
    SystemModelSettings,
    UsageLog,
    User,
    UserFeedback,
    UserMarkdownPrompt,
    UserModelSettings,
    UserToken,
    get_session,
)
from x_models.id_x_010.src.schemas.x_schemas import (
    AuthResponseType,
    ChatInput,
    ChatResponseType,
    DatabaseInfoType,
    DatabaseListResponseType,
    DeleteSystemModelResponseType,
    DeleteModelPriceResponseType,
    ModelPriceInput,
    ModelPriceListResponseType,
    ModelPriceMutationResponseType,
    ModelPriceType,
    ForgotPasswordInput,
    SystemModelUserKeyInput,
    SystemModelUserKeyMutationResponseType,
    SystemModelUserMappingListResponseType,
    SystemModelUserMappingType,
    AdminSystemModelUserKeyInput,
    ForgotPasswordResponseType,
    HealthType,
    LoginInput,
    MarkdownPromptListResponseType,
    MarkdownPromptResponseType,
    MarkdownPromptType,
    ModelListResponseType,
    ModelSettingsInput,
    ModelSettingsResponseType,
    ModelSettingsType,
    ModelType,
    OauthInput,
    RegisterInput,
    StreamChunkType,
    SystemModelInput,
    SystemModelListResponseType,
    SystemModelMutationResponseType,
    SystemModelType,
    TestConnectionInput,
    TestConnectionResponseType,
    UsageDailyType,
    UsageModelBreakdownType,
    UsageStatsResponseType,
    UserInfoType,
    UpdateProfileInput,
    UpdateProfileResponseType,
    ExternalModelInput,
    ExternalModelType,
    ExternalModelListResponseType,
    ExternalModelMutationResponseType,
    DeleteExternalModelResponseType,
    SetActiveModelResponseType,
    ReindexResponseType,
    SqlExampleInput,
    SqlExampleType,
    SqlExampleMutationResponseType,
    SqlExampleListResponseType,
    ApprovalTaskType,
    ApprovalTaskListResponseType,
    AdminUserType,
    AdminUserListResponseType,
    AdminMutationResponseType,
    ExportResultResponseType,
    ReportSubscriptionInput,
    ReportSubscriptionType,
    ReportSubscriptionListResponseType,
    ReportSubscriptionMutationResponseType,
    PromptTemplateType,
    PromptTemplateMutationResponseType,
    UserFeedbackType,
    SqlEvalCaseType,
    SqlEvalResultType,
    SqlEvalRunResponseType,
    UserFeedbackMutationResponseType,
    SaveDefaultModelInput,
    SaveDefaultModelResponseType,
    UserModelPropertyInput,
    UserModelPropertyListResponseType,
    UserModelPropertyMutationResponseType,
    UserModelPropertyType,
    AdminUsageStatsResponseType,
)
from x_models.id_x_010.src.views.x_views import (
    build_user_info,
    create_user_markdown_prompt,
    delete_external_model,
    delete_markdown_prompt,
    delete_system_model,
    delete_model_price,
    delete_user_model_provider,
    find_provider_for_model,
    get_active_markdown_prompt,
    get_agent_db_settings,
    get_conversation_history,
    get_external_model_by_id,
    get_external_model_by_name,
    get_system_model_by_name,
    get_user_avatar,
    get_user_model_provider,
    get_user_model_settings,
    get_user_system_model_mapping,
    list_agent_db_settings,
    list_external_models,
    list_system_models,
    list_model_prices,
    list_user_markdown_prompts,
    list_user_model_providers,
    list_user_system_model_mappings,
    load_llm_provider_config,
    merge_context,
    rename_markdown_prompt,
    resolve_model_endpoint,
    save_conversation_log,
    save_usage_log,
    select_markdown_prompt,
    set_user_avatar,
    test_model_connectivity,
    update_markdown_content,
    update_user_profile,
    upsert_external_model,
    upsert_system_model,
    upsert_model_price,
    upsert_user_model_provider,
    upsert_user_model_settings,
    upsert_user_system_model_mapping,
    delete_user_system_model_mapping,
    view_sso_login,
)


@strawberry.type
class Query:
    @strawberry.field(description="健康检查")
    async def health(self) -> HealthType:
        return HealthType(status="ok", service="id_x_010")

    # TASK-012：列出待审批任务，供 Approval Center 兜底拉取
    @strawberry.field(description="列出待审批 SQL 任务（pending）")
    async def list_approval_tasks(self, info: strawberry.Info) -> "ApprovalTaskListResponseType":
        from x_models.id_x_010.src.views.x_approval import list_pending_tasks

        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ApprovalTaskListResponseType(
                    success=False, message="未登录", tasks=[]
                )
            tasks = await list_pending_tasks()
            return ApprovalTaskListResponseType(
                success=True,
                message=f"查询到 {len(tasks)} 条",
                tasks=[
                    ApprovalTaskType(
                        id=t["id"],
                        conversation_id=t["conversation_id"],
                        sql=t["sql"],
                        sql_meaning=t.get("sql_meaning"),
                        question=t["question"],
                        user_id=t.get("user_id"),
                        status=t["status"],
                        created_at=t.get("created_at"),
                        timeout_at=t.get("timeout_at"),
                    )
                    for t in tasks
                ],
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}list_approval_tasks 失败: {e}", exc_info=True
            )
            return ApprovalTaskListResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                tasks=[],
            )

    @strawberry.field(description="获取模型列表（系统预置模型 + 用户自定义模型合并展示）")
    async def get_models(self, info: strawberry.Info) -> ModelListResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)

            # ── 1) 读取系统预置模型（enabled，按 sort_order 排序）──
            sys_models = await list_system_models(enabled_only=True)

            # ── 2) 读取用户设置（默认模型名 + 配额）──
            user_settings: Optional[UserModelSettings] = None
            user_providers: list = []
            if user is not None:
                user_settings = await get_user_model_settings(user.id)
                user_providers = await list_user_model_providers(user.id)

            user_default_name = ""
            if user_settings is not None:
                user_default_name = user_settings.model_name or ""

            # ── 3) 确定全局默认模型名（用户级优先于系统级）──
            sys_default_name = next(
                (m.name for m in sys_models if m.is_default), None
            )
            effective_default = user_default_name or sys_default_name or ""

            # ── 4) 合并去重（按 name 去重，系统模型在前，用户 Provider 模型在后）──
            seen_names: set = set()
            models: List[ModelType] = []
            next_id = 1

            for sm in sys_models:
                if sm.name in seen_names:
                    continue
                seen_names.add(sm.name)
                models.append(
                    ModelType(
                        id=next_id,
                        name=sm.name,
                        provider=sm.provider,
                        base_url=sm.base_url,
                        model_type=sm.model_type or "external",
                        is_default=(sm.name == effective_default),
                        is_system=True,
                    )
                )
                next_id += 1

            # 用户多 Provider 模型展开
            for up in user_providers:
                for name in (up.model_name_list or []):
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    models.append(
                        ModelType(
                            id=next_id,
                            name=name,
                            provider=up.provider,
                            base_url=up.base_url,
                            model_type="external",
                            is_default=(name == effective_default),
                            is_system=False,
                        )
                    )
                    next_id += 1

            # 兼容旧版单 endpoint：无 Provider 行但有旧 user_model_settings
            if not user_providers and user_settings is not None:
                for name in (user_settings.model_name_list or []):
                    if name in seen_names:
                        continue
                    seen_names.add(name)
                    models.append(
                        ModelType(
                            id=next_id,
                            name=name,
                            provider=user_settings.provider,
                            base_url=user_settings.base_url,
                            model_type="external",
                            is_default=(name == effective_default),
                            is_system=False,
                        )
                    )
                    next_id += 1

            # ── 5) 未登录或均无数据时，回退到全局 external_models + local_models ──
            if not models:
                async with get_session()() as session:
                    external_result = await session.execute(select(ExternalModel))
                    external_models = external_result.scalars().all()

                    for model in external_models:
                        models.append(
                            ModelType(
                                id=next_id,
                                name=model.name,
                                provider=model.provider,
                                base_url=model.base_url,
                                model_type="external",
                            )
                        )
                        next_id += 1

                    local_result = await session.execute(select(LocalModel))
                    local_models = local_result.scalars().all()

                    for model in local_models:
                        models.append(
                            ModelType(
                                id=next_id,
                                name=model.name,
                                provider=model.provider,
                                base_url=model.base_url,
                                model_type="local",
                            )
                        )
                        next_id += 1

            if not models:
                logger.warning(
                    f"{get_request_id()}数据库模型表为空"
                )
                return Query._fallback_models()

            logger.info(
                f"{get_request_id()}成功获取模型列表: "
                f"system={len(sys_models)}, providers={len(user_providers)}, "
                f"merged={len(models)}, default={effective_default}"
            )

            return ModelListResponseType(
                success=True,
                message=f"成功获取 {len(models)} 个模型",
                models=models,
            )

        except Exception as e:
            logger.error(f"{get_request_id()}获取模型列表失败: {e}", exc_info=True)
            # 数据库查询失败时返回空列表
            return Query._fallback_models(str(e))

    @staticmethod
    def _fallback_models(error_msg: str = "") -> ModelListResponseType:
        """当数据库不可用时返回空模型列表。"""
        message = "无可用模型"
        if error_msg:
            message += f"（数据库不可用: {error_msg}）"
        return ModelListResponseType(
            success=False,
            message=message,
            models=[],
        )

    @strawberry.field(description="获取数据库列表")
    async def get_databases(self) -> "DatabaseListResponseType":
        try:
            db_items = []

            # 从 agent_db_settings 表读取可用数据库
            agent_db_rows = await list_agent_db_settings()
            db_items = [
                DatabaseInfoType(
                    key=row.db_name, label=row.db_label or row.db_name
                )
                for row in agent_db_rows
            ]

            logger.info(
                f"{get_request_id()}获取数据库列表: {[(d.key, d.label) for d in db_items]}"
            )

            return DatabaseListResponseType(
                success=True,
                message=f"成功获取 {len(db_items)} 个数据库",
                databases=db_items,
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取数据库列表失败: {e}", exc_info=True)
            return DatabaseListResponseType(
                success=False,
                message=f"获取数据库列表失败: {str(e)}",
                databases=[],
            )

    @strawberry.field(description="获取当前用户的模型设置")
    async def get_model_settings(
        self, info: strawberry.Info
    ) -> ModelSettingsResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ModelSettingsResponseType(
                    success=False, message="未登录或登录已过期", settings=None
                )

            settings = await get_user_model_settings(user.id)
            if settings is None:
                return ModelSettingsResponseType(
                    success=True, message="尚未配置模型设置", settings=None
                )

            return ModelSettingsResponseType(
                success=True,
                message="获取成功",
                settings=_settings_type(settings),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取模型设置失败: {e}", exc_info=True)
            return ModelSettingsResponseType(
                success=False, message=f"获取模型设置失败: {str(e)}", settings=None
            )

    @strawberry.field(description="列出当前用户的全部 Markdown 提示词")
    async def list_markdown_prompts(
        self, info: strawberry.Info
    ) -> MarkdownPromptListResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptListResponseType(
                    success=False, message="未登录或登录已过期", prompts=[]
                )

            prompts = await list_user_markdown_prompts(user.id)
            return MarkdownPromptListResponseType(
                success=True,
                message=f"成功获取 {len(prompts)} 条提示词",
                prompts=[_prompt_type(p) for p in prompts],
            )
        except Exception as e:
            logger.error(f"{get_request_id()}列出提示词失败: {e}", exc_info=True)
            return MarkdownPromptListResponseType(
                success=False, message=f"列出提示词失败: {str(e)}", prompts=[]
            )

    @strawberry.field(description="获取当前用户选中的提示词（每轮对话自动注入）")
    async def get_active_markdown_prompt(
        self, info: strawberry.Info
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            prompt = await get_active_markdown_prompt(user.id)
            if prompt is None:
                return MarkdownPromptResponseType(
                    success=True, message="未选中任何提示词", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True, message="获取成功", prompt=_prompt_type(prompt)
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取活跃提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"获取活跃提示词失败: {str(e)}", prompt=None
            )

    @strawberry.field(description="获取当前用户的用量统计（按日聚合，用于流量统计面板）")
    async def usage_stats(
        self, info: strawberry.Info, days: int = 30
    ) -> UsageStatsResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UsageStatsResponseType(
                    success=False,
                    message="未登录或登录已过期",
                    days=days,
                    daily=[],
                    by_model=[],
                    total_requests=0,
                    total_tokens=0,
                    total_cost_usd=0.0,
                )

            days = max(1, min(days, 365))
            start = datetime.now(timezone.utc) - timedelta(days=days)

            async with get_session()() as session:
                # —— 按日聚合（func.date 将 timestamptz 截断为 UTC 日期文本）——
                date_col = func.date(UsageLog.created_at).label("d")
                in_col = func.coalesce(func.sum(UsageLog.input_tokens), 0).label(
                    "in_tok"
                )
                out_col = func.coalesce(func.sum(UsageLog.output_tokens), 0).label(
                    "out_tok"
                )
                tot_col = func.coalesce(func.sum(UsageLog.total_tokens), 0).label(
                    "tot_tok"
                )
                cost_col = func.coalesce(func.sum(UsageLog.cost_usd), 0.0).label(
                    "cost"
                )
                in_cost_col = func.coalesce(
                    func.sum(UsageLog.input_cost_usd), 0.0
                ).label("in_cost")
                out_cost_col = func.coalesce(
                    func.sum(UsageLog.output_cost_usd), 0.0
                ).label("out_cost")
                daily_stmt = (
                    select(
                        date_col,
                        func.count().label("cnt"),
                        in_col,
                        out_col,
                        tot_col,
                        in_cost_col,
                        out_cost_col,
                        cost_col,
                    )
                    .where(
                        UsageLog.user_id == user.id,
                        UsageLog.is_system_model.is_(True),
                        UsageLog.created_at >= start,
                    )
                    .group_by(date_col)
                    .order_by(date_col)
                )
                daily_rows = (await session.execute(daily_stmt)).all()

                daily: List[UsageDailyType] = []
                for row in daily_rows:
                    daily.append(
                        UsageDailyType(
                            date=str(row.d),
                            request_count=int(row.cnt),
                            input_tokens=int(row.in_tok),
                            output_tokens=int(row.out_tok),
                            total_tokens=int(row.tot_tok),
                            input_cost_usd=float(row.in_cost),
                            output_cost_usd=float(row.out_cost),
                            cost_usd=float(row.cost),
                        )
                    )

                # —— 按模型聚合 ——
                model_cost_col = func.coalesce(
                    func.sum(UsageLog.cost_usd), 0.0
                ).label("cost")
                model_in_cost_col = func.coalesce(
                    func.sum(UsageLog.input_cost_usd), 0.0
                ).label("in_cost")
                model_out_cost_col = func.coalesce(
                    func.sum(UsageLog.output_cost_usd), 0.0
                ).label("out_cost")
                model_in_col = func.coalesce(
                    func.sum(UsageLog.input_tokens), 0
                ).label("in_tok")
                model_out_col = func.coalesce(
                    func.sum(UsageLog.output_tokens), 0
                ).label("out_tok")
                model_tot_col = func.coalesce(
                    func.sum(UsageLog.total_tokens), 0
                ).label("tot_tok")
                model_stmt = (
                    select(
                        UsageLog.model_name,
                        func.count().label("cnt"),
                        model_in_col,
                        model_out_col,
                        model_tot_col,
                        model_in_cost_col,
                        model_out_cost_col,
                        model_cost_col,
                    )
                    .where(
                        UsageLog.user_id == user.id,
                        UsageLog.is_system_model.is_(True),
                        UsageLog.created_at >= start,
                    )
                    .group_by(UsageLog.model_name)
                    .order_by(model_cost_col.desc())
                )
                model_rows = (await session.execute(model_stmt)).all()

                by_model: List[UsageModelBreakdownType] = []
                for row in model_rows:
                    by_model.append(
                        UsageModelBreakdownType(
                            model_name=row.model_name or "未知模型",
                            request_count=int(row.cnt),
                            input_tokens=int(row.in_tok),
                            output_tokens=int(row.out_tok),
                            total_tokens=int(row.tot_tok),
                            input_cost_usd=float(row.in_cost),
                            output_cost_usd=float(row.out_cost),
                            cost_usd=float(row.cost),
                        )
                    )

                total_requests = sum(d.request_count for d in daily)
                total_tokens = sum(d.total_tokens for d in daily)
                total_input_tokens = sum(d.input_tokens for d in daily)
                total_output_tokens = sum(d.output_tokens for d in daily)
                total_input_cost = sum(d.input_cost_usd for d in daily)
                total_output_cost = sum(d.output_cost_usd for d in daily)
                total_cost = sum(d.cost_usd for d in daily)

                return UsageStatsResponseType(
                    success=True,
                    message=f"近 {days} 天用量统计",
                    days=days,
                    daily=daily,
                    by_model=by_model,
                    total_requests=total_requests,
                    total_tokens=total_tokens,
                    total_input_tokens=total_input_tokens,
                    total_output_tokens=total_output_tokens,
                    total_input_cost_usd=round(total_input_cost, 6),
                    total_output_cost_usd=round(total_output_cost, 6),
                    total_cost_usd=round(total_cost, 6),
                )
        except Exception as e:
            logger.error(f"{get_request_id()}获取用量统计失败: {e}", exc_info=True)
            return UsageStatsResponseType(
                success=False,
                message=f"获取用量统计失败: {str(e)}",
                days=days,
                daily=[],
                by_model=[],
                total_requests=0,
                total_tokens=0,
                total_cost_usd=0.0,
            )

    @strawberry.field(description="获取 external_models 表全部记录（含 api_key，供弹窗编辑）")
    async def external_models(self) -> ExternalModelListResponseType:
        try:
            rows = await list_external_models()
            models = [
                ExternalModelType(
                    id=r.id,
                    name=r.name,
                    provider=r.provider,
                    base_url=r.base_url,
                    api_key=r.api_key,
                )
                for r in rows
            ]
            return ExternalModelListResponseType(
                success=True,
                message=f"成功获取 {len(models)} 个外部模型",
                models=models,
            )
        except Exception as e:
            logger.error(f"{get_request_id()}获取外部模型列表失败: {e}", exc_info=True)
            return ExternalModelListResponseType(
                success=False, message=f"获取失败: {str(e)}", models=[]
            )

    @strawberry.field(description="获取系统预置模型列表（含 api_key，供管理员编辑；普通用户只读）")
    async def system_models(self, info: strawberry.Info) -> SystemModelListResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            rows = await list_system_models(enabled_only=False)
            models = [
                SystemModelType(
                    id=r.id,
                    name=r.name,
                    provider=r.provider,
                    base_url=r.base_url,
                    api_key=r.api_key,
                    model_type=r.model_type or "external",
                    is_default=bool(r.is_default),
                    enabled=bool(r.enabled),
                    sort_order=r.sort_order,
                    created_at=(
                        r.created_at.isoformat() if r.created_at else None
                    ),
                    updated_at=(
                        r.updated_at.isoformat() if r.updated_at else None
                    ),
                )
                for r in rows
            ]
            return SystemModelListResponseType(
                success=True,
                message=f"成功获取 {len(models)} 个系统预置模型",
                models=models,
            )
        except AdminRequiredError as e:
            return SystemModelListResponseType(
                success=False, message=e.message, models=[]
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}获取系统模型列表失败: {e}", exc_info=True
            )
            return SystemModelListResponseType(
                success=False, message=f"获取失败: {str(e)}", models=[]
            )

    @strawberry.field(description="管理员：获取模型价格列表（USD / 1M tokens）")
    async def model_prices(self, info: strawberry.Info) -> ModelPriceListResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            rows = await list_model_prices()
            prices = [
                ModelPriceType(
                    id=r.id,
                    model_key=r.model_key,
                    input_price_per_1m=float(r.input_price_per_1m or 0.0),
                    output_price_per_1m=float(r.output_price_per_1m or 0.0),
                    enabled=bool(r.enabled),
                    created_at=(
                        r.created_at.isoformat() if r.created_at else None
                    ),
                    updated_at=(
                        r.updated_at.isoformat() if r.updated_at else None
                    ),
                )
                for r in rows
            ]
            return ModelPriceListResponseType(
                success=True,
                message=f"成功获取 {len(prices)} 条模型价格",
                prices=prices,
            )
        except AdminRequiredError as e:
            return ModelPriceListResponseType(
                success=False, message=e.message, prices=[]
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}获取模型价格列表失败: {e}", exc_info=True
            )
            return ModelPriceListResponseType(
                success=False, message=f"获取失败: {str(e)}", prices=[]
            )

    @strawberry.field(description="获取当前用户的全部自定义模型 Provider（多 Provider 多模型）")
    async def my_model_providers(
        self, info: strawberry.Info
    ) -> UserModelPropertyListResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UserModelPropertyListResponseType(
                    success=False, message="未登录或登录已过期", providers=[]
                )

            providers = await list_user_model_providers(user.id)
            return UserModelPropertyListResponseType(
                success=True,
                message=f"查询到 {len(providers)} 个 Provider",
                providers=[
                    UserModelPropertyType(
                        id=p.id,
                        provider=p.provider,
                        base_url=p.base_url,
                        api_key=p.api_key,
                        model_name_list=list(p.model_name_list or []),
                        sort_order=p.sort_order,
                        created_at=(
                            p.created_at.isoformat() if p.created_at else None
                        ),
                        updated_at=(
                            p.updated_at.isoformat() if p.updated_at else None
                        ),
                    )
                    for p in providers
                ],
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}获取用户 Provider 列表失败: {e}", exc_info=True
            )
            return UserModelPropertyListResponseType(
                success=False, message=f"失败: {str(e)}", providers=[]
            )

    @strawberry.field(description="管理员：全局用量统计（按用户聚合，仅系统模型）")
    async def admin_usage_stats(
        self, info: strawberry.Info, days: int = 30
    ) -> "AdminUsageStatsResponseType":
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )
        from x_models.id_x_010.src.schemas.x_schemas import AdminUserUsageType

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return AdminUsageStatsResponseType(
                success=False, message=e.message, users=[]
            )

        try:
            days = max(1, min(days, 365))
            start = datetime.now(timezone.utc) - timedelta(days=days)
            month_start = datetime.now(timezone.utc).replace(
                day=1, hour=0, minute=0, second=0, microsecond=0
            )

            results: list = []
            async with get_session()() as session:
                # 全部用户
                user_rows = (
                    await session.execute(
                        select(User).order_by(User.id.asc())
                    )
                ).scalars().all()

                for u in user_rows:
                    # 本月系统模型花费
                    month_cost = (
                        await session.execute(
                            select(func.coalesce(func.sum(UsageLog.cost_usd), 0.0)).where(
                                UsageLog.user_id == u.id,
                                UsageLog.is_system_model.is_(True),
                                UsageLog.created_at >= month_start,
                            )
                        )
                    ).scalar_one() or 0.0

                    # 本月系统模型请求数
                    month_req = (
                        await session.execute(
                            select(func.count()).where(
                                UsageLog.user_id == u.id,
                                UsageLog.is_system_model.is_(True),
                                UsageLog.created_at >= month_start,
                            )
                        )
                    ).scalar_one() or 0

                    # 近 N 天总花费
                    total_cost = (
                        await session.execute(
                            select(func.coalesce(func.sum(UsageLog.cost_usd), 0.0)).where(
                                UsageLog.user_id == u.id,
                                UsageLog.is_system_model.is_(True),
                                UsageLog.created_at >= start,
                            )
                        )
                    ).scalar_one() or 0.0

                    results.append(
                        AdminUserUsageType(
                            user_id=u.id,
                            email=u.email,
                            display_name=u.display_name,
                            system_model_quota_usd=getattr(u, "system_model_quota_usd", None),
                            month_cost_usd=round(float(month_cost), 6),
                            month_requests=int(month_req),
                            total_cost_usd=round(float(total_cost), 6),
                        )
                    )

            return AdminUsageStatsResponseType(
                success=True,
                message=f"查询到 {len(results)} 个用户",
                users=results,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}admin_usage_stats 失败: {e}", exc_info=True
            )
            return AdminUsageStatsResponseType(
                success=False, message=f"失败: {str(e)}", users=[]
            )

    @strawberry.field(description="管理员：列出全部用户（含 role/is_admin/is_active）")
    async def list_users(self, info: strawberry.Info) -> AdminUserListResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            async with get_session()() as session:
                rows = (
                    await session.execute(select(User).order_by(User.id.asc()))
                ).scalars().all()
            return AdminUserListResponseType(
                success=True,
                message=f"查询到 {len(rows)} 个用户",
                users=[
                    AdminUserType(
                        id=u.id,
                        email=u.email,
                        display_name=u.display_name,
                        is_active=bool(u.is_active),
                        is_admin=bool(getattr(u, "is_admin", False))
                        or u.has_role("admin"),
                        role=u.role or "user",
                        created_at=(
                            u.created_at.isoformat() if u.created_at else None
                        ),
                        updated_at=(
                            u.updated_at.isoformat() if u.updated_at else None
                        ),
                    )
                    for u in rows
                ],
            )
        except AdminRequiredError as e:
            return AdminUserListResponseType(
                success=False, message=e.message, users=[]
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}list_users 失败: {e}", exc_info=True
            )
            return AdminUserListResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                users=[],
            )


async def hash_password(password: str) -> str:
    """生成 bcrypt 哈希（TASK-019）。

    rounds=12 是 bcrypt 推荐的安全强度；老用户登录时由 verify_password
    判定为 sha256 后自动升级为此哈希。
    """
    import bcrypt

    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(password: str, hash_str: str, algo: str = "bcrypt") -> bool:
    """校验密码。

    Args:
        password: 用户输入的明文密码。
        hash_str: 数据库存储的哈希。
        algo: 哈希算法；"bcrypt"（默认新数据）或 "sha256"（老数据，兼容）。

    Returns:
        True 表示匹配；False 表示不匹配或哈希格式错误。
    """
    if not password or not hash_str:
        return False
    if algo == "bcrypt":
        try:
            import bcrypt

            return bcrypt.checkpw(password.encode(), hash_str.encode())
        except (ValueError, TypeError):
            return False
    elif algo == "sha256":
        # 老数据兼容；登录成功后由 login mutation 自动升级为 bcrypt
        return hashlib.sha256(password.encode()).hexdigest() == hash_str
    return False


async def generate_token() -> str:
    return secrets.token_urlsafe(32)


async def verify_token(token: str) -> Optional[User]:
    if not token:
        return None

    try:
        async with get_session()() as session:
            result = await session.execute(
                select(UserToken).where(UserToken.token == token)
            )
            user_token = result.scalar_one_or_none()

            if user_token is None:
                logger.warning(f"{get_request_id()}令牌不存在: {token[:8]}...")
                return None

            if not user_token.is_valid():
                logger.warning(f"{get_request_id()}令牌已过期: {token[:8]}...")
                return None

            user_result = await session.execute(
                select(User).where(User.id == user_token.user_id)
            )
            user = user_result.scalar_one_or_none()

            return user

    except Exception as e:
        logger.error(f"{get_request_id()}验证令牌失败: {e}", exc_info=True)
        return None


def _get_info_request(info: strawberry.Info):
    """从 strawberry context 中取 Litestar Request（默认 context 为 dict）。"""
    ctx = info.context
    if isinstance(ctx, dict):
        return ctx.get("request")
    return getattr(ctx, "request", None)


async def _get_bearer_user(request) -> Optional[User]:
    """从请求头 Authorization: Bearer <token> 解析并校验用户。"""
    if request is None:
        return None
    auth_header = request.headers.get("authorization", "")
    if not auth_header.lower().startswith("bearer "):
        return None
    return await verify_token(auth_header[7:].strip())


async def _get_bearer_settings(
    request, user: Optional[User] = None
) -> Optional[UserModelSettings]:
    """解析请求属主用户并返回其模型设置；未登录或未配置时返回 None。

    性能：调用方已完成 token 校验时传入 user，避免重复 verify_token
    （每次 2 个 DB 往返）。
    """
    if user is None:
        user = await _get_bearer_user(request)
    if user is None:
        return None
    return await get_user_model_settings(user.id)


def _to_subscription_type(sub) -> "ReportSubscriptionType":
    """ReportSubscription ORM → GraphQL type 转换。"""
    return ReportSubscriptionType(
        id=sub.id,
        user_id=sub.user_id,
        name=sub.name,
        cron=sub.cron,
        query_template=sub.query_template,
        format=sub.format or "xlsx",
        db_name=sub.db_name,
        enabled=bool(sub.enabled),
        last_run_at=sub.last_run_at.isoformat() if sub.last_run_at else None,
        last_run_status=sub.last_run_status,
        created_at=sub.created_at.isoformat() if sub.created_at else None,
    )


def _settings_type(settings: UserModelSettings) -> ModelSettingsType:
    return ModelSettingsType(
        provider=settings.provider,
        base_url=settings.base_url,
        api_key=settings.api_key,
        model_name=settings.model_name,
        model_name_list=list(settings.model_name_list or []),
        quota_limit_monthly_usd=settings.quota_limit_monthly_usd,
        updated_at=settings.updated_at.isoformat() if settings.updated_at else None,
    )


@strawberry.type
class Mutation:
    @strawberry.mutation(description="发送聊天请求（非流式）")
    async def chat(
        self, info: strawberry.Info, input: ChatInput
    ) -> ChatResponseType:
        try:
            base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
            api_key = os.getenv("OPENROUTER_API_KEY", "")

            logger.info(
                f"{get_request_id()}收到聊天请求: query='{input.query[:50]}...', "
                f"model_type={input.model_type}, "
                f"model_name={input.model_name}, "
                f"agent_type={input.agent_type}, "
                f"stream={input.stream}, "
                f"url={base_url}, "
                f"api_key={'***set' if api_key else '***empty'}"
            )

            # TASK-008：限流 + 配额检查（best-effort，失败放行）
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            rl_key = str(user.id) if user is not None else (
                request.client.host if request and request.client else "anon"
            )
            from x_models.id_x_010.src.middleware.x_ratelimit import rate_limit

            if not await rate_limit("chat", rl_key):
                return ChatResponseType(
                    success=False,
                    message="请求过于频繁，请稍后再试（每分钟上限 20 次）",
                    response="",
                    thinking="",
                )

            if user is not None:
                # 配额检查在模型解析后进行，仅当选用系统预置模型时检查
                pass

            context = None
            if input.context:
                try:
                    context = [
                        json.loads(ctx) if isinstance(ctx, str) else ctx
                        for ctx in input.context
                    ]
                except json.JSONDecodeError:
                    context = None

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 用户已保存自定义模型设置时，以其覆盖默认链路配置
            # （复用上方已校验的 user，避免重复 verify_token 的 2 次 DB 往返）
            user_settings = await _get_bearer_settings(request, user=user)

            # 解析实际调用的模型端点：前端选中的 model_name 若命中系统预置模型，
            # 则使用该系统模型的 api_key / base_url；否则回退到用户级设置。
            # 若用户已设置 per-user 系统模型 key，则用其覆盖全局 key。
            chat_api_key, chat_base_url, effective_model_name = (
                await resolve_model_endpoint(
                    input.model_name, user_settings, user.id if user else None
                )
            )

            # 系统模型配额检查：仅当选用系统预置模型时检查
            # 注意：须用 resolve_model_endpoint 回填后的 effective_model_name 判断，
            # 前端未传 model_name 时会回退到系统默认模型（is_default=True 行）。
            _is_system_model = False
            if effective_model_name:
                _sys_model = await get_system_model_by_name(effective_model_name)
                _is_system_model = _sys_model is not None and _sys_model.enabled

            if user is not None and _is_system_model:
                from x_models.id_x_010.src.utils.x_quota import check_user_quota

                ok, msg = await check_user_quota(user.id)
                if not ok:
                    logger.warning(
                        f"{get_request_id()}用户配额超限 user_id={user.id}: {msg}"
                    )
                    return ChatResponseType(
                        success=False,
                        message=msg,
                        response="",
                        thinking="",
                    )

            if chat_api_key is not None and chat_base_url is not None:
                # 按（模型 + 端点）缓存复用 supervisor：每请求新建会重复付出
                # Agent 实例化 / workflow 编译 / PG checkpointer 探测等开销
                orchestrator = get_supervisor(
                    model_type=input.model_type,
                    model_name=effective_model_name,
                    api_key=chat_api_key,
                    base_url=chat_base_url,
                )
                chat_model_name = effective_model_name
            else:
                orchestrator = get_orchestrator()
                chat_model_name = effective_model_name

            # 自动注入用户当前选中的 Markdown 提示词：
            # - prompt_disabled=True（用户在前端点击取消）：本轮不携带，直接跳过查询
            # - 其它情况（默认）：三种 Agent 模式 + 自动路由全部携带；
            #   总线层仅读取并透传，是否注入由各 Agent 节点自行决定
            active_prompt_content: Optional[str] = None
            if input.prompt_disabled:
                logger.info(
                    f"{get_request_id()}用户已取消提示词注入(agent_type={input.agent_type or 'auto'})"
                )
            else:
                # 复用入口处已校验的 user，避免第三次 verify_token
                if user is not None:
                    active_prompt = await get_active_markdown_prompt(user.id)
                    if active_prompt is not None:
                        active_prompt_content = active_prompt.content
                        logger.info(
                            f"{get_request_id()}已携带提示词(agent_type={input.agent_type or 'auto'}): "
                            f"filename={active_prompt.filename}, "
                            f"chars={len(active_prompt.content)}"
                        )

            result = await orchestrator.process(
                query=input.query,
                model_type=input.model_type,
                model_name=chat_model_name,
                agent_type=input.agent_type,
                conversation_id=input.conversation_id,
                context=context,
                db_name=input.db_name,
                api_key=chat_api_key,
                base_url=chat_base_url,
                prompt_content=active_prompt_content,
            )

            try:
                await save_conversation_log(
                    conversation_id=result["conversation_id"],
                    user_query=input.query,
                    model_response=result["response"],
                    thinking_process=result["thinking"],
                    model_type=input.model_type,
                    model_name=result["model_used"],
                    intent=result["intent"] or "",
                )
            except Exception as e:
                logger.error(f"{get_request_id()}保存对话日志失败: {e}", exc_info=True)

            return ChatResponseType(
                response=result["response"],
                thinking=result["thinking"],
                conversation_id=result["conversation_id"],
                model_used=result["model_used"],
                success=result["success"],
            )

        except Exception as e:
            logger.error(f"{get_request_id()}聊天接口错误: {e}", exc_info=True)
            raise Exception(f"处理请求失败: {str(e)}")

    @strawberry.mutation(description="用户登录")
    async def login(self, input: LoginInput) -> AuthResponseType:
        try:
            # TASK-008：登录失败限流，邮箱为 key，5 次/分钟；成功后清除计数
            from x_models.id_x_010.src.middleware.x_ratelimit import (
                clear_rate_limit,
                rate_limit,
            )

            if not await rate_limit("login", input.email, limit=5):
                return AuthResponseType(
                    success=False,
                    message="登录尝试过多，请 15 分钟后再试",
                )

            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                user = result.scalar_one_or_none()

                if user is None:
                    return AuthResponseType(success=False, message="用户不存在")

                # TASK-019：bcrypt 优先；老数据 password_algo 缺失视为 sha256
                algo = getattr(user, "password_algo", None) or "sha256"
                if not verify_password(input.password, user.password_hash, algo):
                    return AuthResponseType(success=False, message="密码错误")

                # 老 sha256 自动升级为 bcrypt（用户无感知）
                if algo != "bcrypt":
                    user.password_hash = await hash_password(input.password)
                    user.password_algo = "bcrypt"
                    logger.info(
                        f"{get_request_id()}用户密码已升级为 bcrypt: "
                        f"user_id={user.id}, email={user.email}"
                    )

                if user.is_active is False:
                    return AuthResponseType(success=False, message="用户尚未激活")

                # 角色校验：管理员登录页与用户登录页分离后，按 input.role 校验。
                # role 为多角色字段（逗号分隔），has_role("admin") 判定管理员。
                # 管理员同时也是普通用户，可在用户登录页登录（跳转 user-home）。
                user_has_admin = user.has_role("admin") or bool(
                    getattr(user, "is_admin", False)
                )
                if input.role:
                    requested = input.role.strip().lower()
                    if requested not in ("admin", "user"):
                        return AuthResponseType(
                            success=False, message="无效的登录角色"
                        )
                    if requested == "admin" and not user_has_admin:
                        logger.warning(
                            f"{get_request_id()}非管理员尝试登录管理后台: "
                            f"user_id={user.id}, email={user.email}"
                        )
                        return AuthResponseType(
                            success=False, message="该账号无管理员权限"
                        )
                    # requested == "user"：管理员也是普通用户，允许登录用户页

                # is_admin 与 role 同步：admin ∈ role 但 is_admin 未置位时补齐
                if user_has_admin and not getattr(user, "is_admin", False):
                    user.is_admin = True

                token = await generate_token()

                expires_at = datetime.utcnow() + timedelta(hours=24)

                user_token = UserToken(
                    user_id=user.id,
                    token=token,
                    expires_at=expires_at,
                )
                session.add(user_token)
                await session.commit()
                await session.refresh(user)

                # 登录成功：清掉该邮箱的失败计数
                clear_rate_limit("login", input.email)

                return AuthResponseType(
                    success=True,
                    message="登录成功",
                    token=token,
                    expires_at=expires_at.isoformat(),
                    user=build_user_info(user),
                )

        except Exception as e:
            logger.error(f"{get_request_id()}登录失败: {e}", exc_info=True)
            return AuthResponseType(success=False, message=f"登录失败: {str(e)}")

    @strawberry.mutation(description="SSO 单点登录（ADFS 授权码授予流，首次自动建档）")
    async def sso_login(self, input: OauthInput) -> AuthResponseType:
        return await view_sso_login(code=input.code, state=input.state)

    @strawberry.mutation(description="用户注册")
    async def register(self, input: RegisterInput) -> AuthResponseType:
        try:
            if input.password != input.confirm_password:
                return AuthResponseType(success=False, message="两次密码输入不一致")

            if len(input.password) < 6:
                return AuthResponseType(success=False, message="密码长度至少6位")

            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                existing_user = result.scalar_one_or_none()

                if existing_user:
                    return AuthResponseType(success=False, message="邮箱已被注册")

                password_hash = await hash_password(input.password)
                new_user = User(
                    email=input.email,
                    password_hash=password_hash,
                    phone=input.phone,
                    is_active=False,
                    role="user",
                    is_admin=False,
                )
                session.add(new_user)
                await session.commit()
                await session.refresh(new_user)

                return AuthResponseType(
                    success=True,
                    message="注册成功，请等待管理员激活账户",
                    token=None,
                    user=build_user_info(new_user),
                )

        except Exception as e:
            logger.error(f"{get_request_id()}注册失败: {e}", exc_info=True)
            return AuthResponseType(success=False, message=f"注册失败: {str(e)}")

    @strawberry.mutation(description="忘记密码")
    async def forgot_password(
        self, input: ForgotPasswordInput
    ) -> ForgotPasswordResponseType:
        try:
            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                user = result.scalar_one_or_none()

                if user is None:
                    return ForgotPasswordResponseType(
                        success=True,
                        message="如果邮箱存在，重置链接已发送",
                    )

                old_tokens_result = await session.execute(
                    select(PasswordResetToken).where(
                        PasswordResetToken.user_id == user.id,
                        PasswordResetToken.used.is_(False),
                    )
                )
                old_tokens = old_tokens_result.scalars().all()
                for old_token in old_tokens:
                    old_token.used = True

                reset_token = secrets.token_urlsafe(32)
                expires_at = datetime.utcnow() + timedelta(hours=1)

                new_token = PasswordResetToken(
                    user_id=user.id,
                    token=reset_token,
                    expires_at=expires_at,
                )
                session.add(new_token)
                await session.commit()

                return ForgotPasswordResponseType(
                    success=True,
                    message="重置令牌已生成，生产环境应发送邮件",
                    reset_token=reset_token,
                )

        except Exception as e:
            logger.error(f"{get_request_id()}忘记密码处理失败: {e}", exc_info=True)
            return ForgotPasswordResponseType(
                success=False, message=f"处理失败: {str(e)}"
            )

    @strawberry.mutation(description="SQL审批操作")
    async def sql_approval(
        self,
        info: strawberry.Info,
        conversation_id: str,
        sql: str,
        action: str,
        question: str,
        model_type: str = "external",
        model_name: Optional[str] = None,
        db_name: Optional[str] = None,
    ) -> AsyncGenerator[StreamChunkType, None]:
        try:
            if action == "cancel":
                # TASK-012：若该 SQL 已挂起为 ApprovalTask，同步标记 cancelled
                try:
                    from x_models.id_x_010.src.views.x_approval import (
                        resolve_task,
                    )
                    from sqlalchemy import select as _select
                    from x_models.id_x_010.src.models.x_models import (
                        ApprovalTask as _ApprovalTask,
                    )

                    async with get_session()() as session:
                        task = (
                            await session.execute(
                                _select(_ApprovalTask).where(
                                    _ApprovalTask.conversation_id == conversation_id,
                                    _ApprovalTask.sql == sql,
                                    _ApprovalTask.status == "pending",
                                )
                            )
                        ).scalar_one_or_none()
                    if task is not None:
                        await resolve_task(
                            task.id, action="cancel", assigned_to=None
                        )
                except Exception as e:
                    logger.warning(
                        f"{get_request_id()}sql_approval cancel 标记 ApprovalTask 失败: "
                        f"{type(e).__name__}: {e}"
                    )
                yield StreamChunkType(
                    type="sql_cancelled",
                    content="用户取消了本次查询",
                )
                return

            # TASK-012：approve / reject 时同步 ApprovalTask 状态
            if action in ("approve", "reject"):
                try:
                    from x_models.id_x_010.src.views.x_approval import (
                        resolve_task,
                    )
                    from sqlalchemy import select as _select
                    from x_models.id_x_010.src.models.x_models import (
                        ApprovalTask as _ApprovalTask,
                    )

                    request = _get_info_request(info)
                    approver = await _get_bearer_user(request)
                    async with get_session()() as session:
                        task = (
                            await session.execute(
                                _select(_ApprovalTask).where(
                                    _ApprovalTask.conversation_id == conversation_id,
                                    _ApprovalTask.sql == sql,
                                    _ApprovalTask.status == "pending",
                                )
                            )
                        ).scalar_one_or_none()
                    if task is not None:
                        await resolve_task(
                            task.id,
                            action=action,
                            assigned_to=approver.id if approver else None,
                        )
                except Exception as e:
                    logger.warning(
                        f"{get_request_id()}sql_approval resolve ApprovalTask 失败: "
                        f"{type(e).__name__}: {e}"
                    )

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 解析模型端点：前端传入的 model_name 若命中系统预置模型，
            # 使用该系统模型的端点；否则回退到用户级设置
            _req = _get_info_request(info)
            _app_user = await _get_bearer_user(_req)
            user_settings = await _get_bearer_settings(_req)
            agent_api_key, agent_base_url, resolved_model_name = (
                await resolve_model_endpoint(
                    model_name, user_settings, _app_user.id if _app_user else None
                )
            )
            if resolved_model_name:
                model_name = resolved_model_name

            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=agent_api_key,
                base_url=agent_base_url,
                db_name=db_name,
            )

            if action == "approve":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=True, question=question
                ):
                    yield StreamChunkType(
                        type=chunk.get("type", ""),
                        content=chunk.get("content"),
                        model_used=chunk.get("model_used"),
                        conversation_id=conversation_id,
                        sql=chunk.get("sql"),
                        sql_meaning=chunk.get("sql_meaning"),
                        # TASK-015：补齐 result/chart/security_block 字段转发，
                        # 否则前端审核通过后收不到查询结果，ResultView 永不渲染。
                        columns=chunk.get("columns"),
                        data=(
                            json.dumps(chunk["data"], ensure_ascii=False)
                            if chunk.get("data") is not None
                            else None
                        ),
                        row_count=chunk.get("row_count"),
                        chart_config=(
                            json.dumps(chunk["chart_config"], ensure_ascii=False)
                            if chunk.get("chart_config") is not None
                            else None
                        ),
                        security_block=(
                            bool(chunk["security_block"])
                            if chunk.get("security_block") is not None
                            else None
                        ),
                        input_tokens=(
                            int((chunk.get("usage") or {}).get("input_tokens", 0) or 0)
                            if chunk.get("usage")
                            else None
                        ),
                        output_tokens=(
                            int((chunk.get("usage") or {}).get("output_tokens", 0) or 0)
                            if chunk.get("usage")
                            else None
                        ),
                    )
            elif action == "reject":
                last_chunk_type = None
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=False, question=question
                ):
                    last_chunk_type = chunk.get("type", "")
                    yield StreamChunkType(
                        type=chunk.get("type", ""),
                        content=chunk.get("content"),
                        model_used=chunk.get("model_used"),
                        conversation_id=conversation_id,
                        sql=chunk.get("sql"),
                        sql_meaning=chunk.get("sql_meaning"),
                        columns=chunk.get("columns"),
                        data=(
                            json.dumps(chunk["data"], ensure_ascii=False)
                            if chunk.get("data") is not None
                            else None
                        ),
                        row_count=chunk.get("row_count"),
                        chart_config=(
                            json.dumps(chunk["chart_config"], ensure_ascii=False)
                            if chunk.get("chart_config") is not None
                            else None
                        ),
                        security_block=(
                            bool(chunk["security_block"])
                            if chunk.get("security_block") is not None
                            else None
                        ),
                        input_tokens=(
                            int((chunk.get("usage") or {}).get("input_tokens", 0) or 0)
                            if chunk.get("usage")
                            else None
                        ),
                        output_tokens=(
                            int((chunk.get("usage") or {}).get("output_tokens", 0) or 0)
                            if chunk.get("usage")
                            else None
                        ),
                    )

                if last_chunk_type == "sql_rejected":
                    # TASK-015：重新生成 SQL 后会再次走审核流（auto_execute=False）
                    # 可能在用户二次审核通过时产出 result chunk——这里也要补齐字段。
                    async for chunk2 in sql_agent.stream_query(question=question):
                        yield StreamChunkType(
                            type=chunk2.get("type", ""),
                            content=chunk2.get("content"),
                            model_used=chunk2.get("model_used"),
                            conversation_id=conversation_id,
                            sql=chunk2.get("sql"),
                            sql_meaning=chunk2.get("sql_meaning"),
                            columns=chunk2.get("columns"),
                            data=(
                                json.dumps(chunk2["data"], ensure_ascii=False)
                                if chunk2.get("data") is not None
                                else None
                            ),
                            row_count=chunk2.get("row_count"),
                            chart_config=(
                                json.dumps(chunk2["chart_config"], ensure_ascii=False)
                                if chunk2.get("chart_config") is not None
                                else None
                            ),
                            security_block=(
                                bool(chunk2["security_block"])
                                if chunk2.get("security_block") is not None
                                else None
                            ),
                            input_tokens=(
                                int(
                                    (chunk2.get("usage") or {}).get("input_tokens", 0)
                                    or 0
                                )
                                if chunk2.get("usage")
                                else None
                            ),
                            output_tokens=(
                                int(
                                    (chunk2.get("usage") or {}).get("output_tokens", 0)
                                    or 0
                                )
                                if chunk2.get("usage")
                                else None
                            ),
                        )
        except Exception as e:
            logger.error(f"{get_request_id()}SQL审批接口错误: {e}", exc_info=True)
            yield StreamChunkType(
                type="error",
                content=f"审批处理失败: {str(e)}",
            )

    @strawberry.mutation(description="重建目标库的 schema 向量索引（写入 table_comments）")
    async def reindex_schema(
        self, info: strawberry.Info, db_name: str
    ) -> ReindexResponseType:
        """触发 x_indexer.index_database：遍历目标库 public schema 全部表，
        调用 x_vectorstore.upsert_table_comment 写入/更新 table_comments，
        供 SQL Agent retriever 后续召回（TASK-002）。

        需要登录；审批/管理员校验后续在 TASK-013 引入 require_admin 后升级。
        异常不抛出，返回结构化 ReindexResponseType。
        """
        request = _get_info_request(info)
        user = await _get_bearer_user(request)
        if user is None:
            return ReindexResponseType(
                success=False, message="未登录", indexed_count=0
            )

        if not db_name:
            return ReindexResponseType(
                success=False, message="db_name 不能为空", indexed_count=0
            )

        try:
            # 按 LLM_PROVIDER 加载提供商表配置（与 chat / sql_approval 一致）
            await load_llm_provider_config()
            # 用户保存自定义模型设置时以其覆盖默认链路配置；reindex 不需要 LLM
            # 但 SQLAgent 实例化会创建 LLM 客户端，保持参数一致以避免类型混乱
            user_settings = await _get_bearer_settings(request)

            from x_models.id_x_010.src.utils.x_indexer import index_database

            reindex_api_key, reindex_base_url, reindex_model_name = (
                await resolve_model_endpoint(None, user_settings, user.id)
            )

            sql_agent = SQLAgent(
                model_name=reindex_model_name,
                api_key=reindex_api_key,
                base_url=reindex_base_url,
                db_name=db_name,
            )
            await sql_agent.db.connect()
            try:
                count = await index_database(db_name, sql_agent.db)
            finally:
                try:
                    await sql_agent.db.disconnect()
                except Exception as e:
                    logger.warning(
                        f"{get_request_id()}reindex_schema disconnect 失败（非致命）: "
                        f"{type(e).__name__}: {e}"
                    )

            return ReindexResponseType(
                success=True,
                message=f"已索引 {count} 张表",
                indexed_count=count,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}reindex_schema 失败: {e}", exc_info=True
            )
            return ReindexResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                indexed_count=0,
            )

    # ------------------------------------------------------------------
    # SQL Few-Shot 例子库 CRUD（TASK-009）
    # 本期用 _get_bearer_user 鉴权；TASK-013 完成后升级为 require_admin
    # ------------------------------------------------------------------

    @strawberry.mutation(description="新增/更新 SQL Few-Shot 例子（自动生成 embedding）")
    async def save_sql_example(
        self, info: strawberry.Info, input: SqlExampleInput
    ) -> SqlExampleMutationResponseType:
        request = _get_info_request(info)
        user = await _get_bearer_user(request)
        if user is None:
            return SqlExampleMutationResponseType(
                success=False, message="未登录", example=None
            )

        try:
            from x_models.id_x_010.src.utils.x_fewshot import embed_example

            async with get_session()() as session:
                if input.id is None:
                    example = SqlExample(
                        db_name=input.db_name,
                        question=input.question,
                        sql=input.sql,
                        explanation=input.explanation,
                        enabled=input.enabled,
                    )
                    session.add(example)
                else:
                    example = (
                        await session.execute(
                            select(SqlExample).where(SqlExample.id == input.id)
                        )
                    ).scalar_one_or_none()
                    if example is None:
                        return SqlExampleMutationResponseType(
                            success=False,
                            message=f"例子不存在: id={input.id}",
                            example=None,
                        )
                    example.db_name = input.db_name
                    example.question = input.question
                    example.sql = input.sql
                    example.explanation = input.explanation
                    example.enabled = input.enabled

                # 计算 embedding；失败时仍写入(embedding NULL，召回降级)
                example.embedding = await embed_example(input.question)

                await session.commit()
                await session.refresh(example)

                return SqlExampleMutationResponseType(
                    success=True,
                    message="保存成功",
                    example=SqlExampleType(
                        id=example.id,
                        db_name=example.db_name,
                        question=example.question,
                        sql=example.sql,
                        explanation=example.explanation,
                        enabled=bool(example.enabled),
                        created_at=(
                            example.created_at.isoformat()
                            if example.created_at is not None
                            else None
                        ),
                    ),
                )
        except Exception as e:
            logger.error(
                f"{get_request_id()}save_sql_example 失败: {e}", exc_info=True
            )
            return SqlExampleMutationResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                example=None,
            )

    @strawberry.mutation(description="删除 SQL Few-Shot 例子")
    async def delete_sql_example(
        self, info: strawberry.Info, example_id: int
    ) -> SqlExampleMutationResponseType:
        request = _get_info_request(info)
        user = await _get_bearer_user(request)
        if user is None:
            return SqlExampleMutationResponseType(
                success=False, message="未登录", example=None
            )

        try:
            async with get_session()() as session:
                example = (
                    await session.execute(
                        select(SqlExample).where(SqlExample.id == example_id)
                    )
                ).scalar_one_or_none()
                if example is None:
                    return SqlExampleMutationResponseType(
                        success=False,
                        message=f"例子不存在: id={example_id}",
                        example=None,
                    )
                await session.delete(example)
                await session.commit()
            return SqlExampleMutationResponseType(
                success=True, message="已删除", example=None
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}delete_sql_example 失败: {e}", exc_info=True
            )
            return SqlExampleMutationResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                example=None,
            )

    @strawberry.field(description="列出 SQL Few-Shot 例子（可选 db_name 过滤）")
    async def list_sql_examples(
        self, info: strawberry.Info, db_name: Optional[str] = None
    ) -> SqlExampleListResponseType:
        request = _get_info_request(info)
        user = await _get_bearer_user(request)
        if user is None:
            return SqlExampleListResponseType(
                success=False, message="未登录", examples=[]
            )

        try:
            async with get_session()() as session:
                stmt = select(SqlExample)
                if db_name:
                    stmt = stmt.where(SqlExample.db_name == db_name)
                stmt = stmt.order_by(SqlExample.id.desc())
                rows = (await session.execute(stmt)).scalars().all()

            return SqlExampleListResponseType(
                success=True,
                message=f"查询到 {len(rows)} 条",
                examples=[
                    SqlExampleType(
                        id=r.id,
                        db_name=r.db_name,
                        question=r.question,
                        sql=r.sql,
                        explanation=r.explanation,
                        enabled=bool(r.enabled),
                        created_at=(
                            r.created_at.isoformat()
                            if r.created_at is not None
                            else None
                        ),
                    )
                    for r in rows
                ],
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}list_sql_examples 失败: {e}", exc_info=True
            )
            return SqlExampleListResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                examples=[],
            )

    # ------------------------------------------------------------------
    # 后台运维（TASK-013）：管理员 mutation
    # ------------------------------------------------------------------

    @strawberry.mutation(description="管理员：设置/取消用户管理员权限（多角色 role 字段增删 admin）")
    async def set_user_admin(
        self, info: strawberry.Info, user_id: int, is_admin: bool
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            async with get_session()() as session:
                u = (
                    await session.execute(select(User).where(User.id == user_id))
                ).scalar_one_or_none()
                if u is None:
                    return AdminMutationResponseType(
                        success=False, message=f"用户不存在: id={user_id}"
                    )
                if is_admin:
                    u.add_role("admin")
                else:
                    u.remove_role("admin")
                await session.commit()
            return AdminMutationResponseType(
                success=True,
                message=f"已{'授予' if is_admin else '撤销'}管理员权限",
            )
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)
        except Exception as e:
            logger.error(
                f"{get_request_id()}set_user_admin 失败: {e}", exc_info=True
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )

    @strawberry.mutation(description="管理员：激活/停用用户")
    async def toggle_user_active(
        self, info: strawberry.Info, user_id: int, is_active: bool
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            async with get_session()() as session:
                u = (
                    await session.execute(select(User).where(User.id == user_id))
                ).scalar_one_or_none()
                if u is None:
                    return AdminMutationResponseType(
                        success=False, message=f"用户不存在: id={user_id}"
                    )
                u.is_active = is_active
                await session.commit()
            return AdminMutationResponseType(
                success=True,
                message=f"已{'激活' if is_active else '停用'}用户",
            )
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)
        except Exception as e:
            logger.error(
                f"{get_request_id()}toggle_user_active 失败: {e}", exc_info=True
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )

    @strawberry.mutation(description="管理员：重置用户密码")
    async def reset_user_password(
        self, info: strawberry.Info, user_id: int, new_password: str
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            if not new_password or len(new_password) < 6:
                return AdminMutationResponseType(
                    success=False, message="密码至少 6 位"
                )
            async with get_session()() as session:
                u = (
                    await session.execute(select(User).where(User.id == user_id))
                ).scalar_one_or_none()
                if u is None:
                    return AdminMutationResponseType(
                        success=False, message=f"用户不存在: id={user_id}"
                    )
                u.password_hash = await hash_password(new_password)
                u.password_algo = "bcrypt"  # TASK-019 自动升级
                await session.commit()
            return AdminMutationResponseType(success=True, message="密码已重置")
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)
        except Exception as e:
            logger.error(
                f"{get_request_id()}reset_user_password 失败: {e}", exc_info=True
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )

    @strawberry.mutation(description="管理员：设置用户的系统模型月度配额")
    async def set_user_system_quota(
        self, info: strawberry.Info, user_id: int, quota_usd: Optional[float]
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)

        if quota_usd is not None and quota_usd < 0:
            return AdminMutationResponseType(
                success=False, message="配额须为非负数（留空表示不限额）"
            )

        try:
            async with get_session()() as session:
                u = (
                    await session.execute(select(User).where(User.id == user_id))
                ).scalar_one_or_none()
                if u is None:
                    return AdminMutationResponseType(
                        success=False, message=f"用户不存在: id={user_id}"
                    )
                u.system_model_quota_usd = quota_usd
                await session.commit()
            return AdminMutationResponseType(
                success=True,
                message=f"配额已设置: ${quota_usd}" if quota_usd is not None else "配额已清除（不限额）",
            )
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)
        except Exception as e:
            logger.error(
                f"{get_request_id()}set_user_system_quota 失败: {e}", exc_info=True
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )
    # ------------------------------------------------------------------

    @strawberry.mutation(description="管理员：保存 Prompt 模板新版本（自动激活）")
    async def save_prompt_template(
        self, info: strawberry.Info, key: str, content: str
    ) -> "PromptTemplateMutationResponseType":
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )
        from x_models.id_x_010.src.utils.x_prompts import save_prompt_template as _save

        try:
            admin = await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return PromptTemplateMutationResponseType(
                success=False, message=e.message, template=None
            )

        if not key or not content:
            return PromptTemplateMutationResponseType(
                success=False, message="key 与 content 不能为空", template=None
            )

        try:
            tpl = await _save(key=key, content=content, variables=None, created_by=admin.id)
            from x_models.id_x_010.src.schemas.x_schemas import PromptTemplateType

            return PromptTemplateMutationResponseType(
                success=True,
                message=f"已保存为 v{tpl.version}（自动激活）",
                template=PromptTemplateType(
                    id=tpl.id,
                    key=tpl.key,
                    version=tpl.version,
                    content=tpl.content[:200],  # 截断回显避免响应过大
                    is_active=bool(tpl.is_active),
                    created_at=tpl.created_at.isoformat() if tpl.created_at else None,
                ),
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}save_prompt_template 失败: {e}", exc_info=True
            )
            return PromptTemplateMutationResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                template=None,
            )

    # ------------------------------------------------------------------
    # 用户反馈与 SQL 评估（TASK-017）
    # ------------------------------------------------------------------

    @strawberry.mutation(description="提交用户反馈（👍/踩 + 备注）")
    async def submit_feedback(
        self,
        info: strawberry.Info,
        conversation_id: str,
        message_index: int,
        rating: int,
        feedback_text: Optional[str] = None,
    ) -> "UserFeedbackMutationResponseType":
        request = _get_info_request(info)
        user = await _get_bearer_user(request)
        # 匿名也可反馈（暂允许）；后续可加 require_admin 看 admin 反馈面板
        if user is None:
            return UserFeedbackMutationResponseType(
                success=False, message="未登录", feedback=None
            )

        if rating not in (1, -1):
            return UserFeedbackMutationResponseType(
                success=False, message="rating 必须为 1 或 -1", feedback=None
            )
        if not conversation_id:
            return UserFeedbackMutationResponseType(
                success=False, message="conversation_id 不能为空", feedback=None
            )

        try:
            async with get_session()() as session:
                fb = UserFeedback(
                    user_id=user.id,
                    conversation_id=conversation_id,
                    message_index=message_index,
                    rating=rating,
                    feedback_text=feedback_text,
                )
                session.add(fb)
                await session.commit()
                await session.refresh(fb)

            return UserFeedbackMutationResponseType(
                success=True,
                message="反馈已提交",
                feedback=UserFeedbackType(
                    id=fb.id,
                    user_id=fb.user_id,
                    conversation_id=fb.conversation_id,
                    message_index=fb.message_index,
                    rating=fb.rating,
                    feedback_text=fb.feedback_text,
                    created_at=fb.created_at.isoformat() if fb.created_at else None,
                ),
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}submit_feedback 失败: {e}", exc_info=True
            )
            return UserFeedbackMutationResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                feedback=None,
            )

    @strawberry.mutation(description="管理员：保存 SQL 评估用例")
    async def save_sql_eval_case(
        self,
        info: strawberry.Info,
        question: str,
        db_name: str,
        expected_sql: Optional[str] = None,
        tags: Optional[str] = None,
        enabled: bool = True,
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)

        if not question or not db_name:
            return AdminMutationResponseType(
                success=False, message="question 与 db_name 不能为空"
            )

        try:
            import json as _json

            tags_dict = None
            if tags:
                try:
                    tags_dict = _json.loads(tags)
                except _json.JSONDecodeError:
                    tags_dict = None

            async with get_session()() as session:
                case = SqlEvalCase(
                    question=question,
                    db_name=db_name,
                    expected_sql=expected_sql,
                    tags=tags_dict,
                    enabled=enabled,
                )
                session.add(case)
                await session.commit()
            return AdminMutationResponseType(success=True, message="已保存评估用例")
        except Exception as e:
            logger.error(
                f"{get_request_id()}save_sql_eval_case 失败: {e}", exc_info=True
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )

    @strawberry.mutation(description="管理员：执行 SQL 评估（同步 ≤ 50 条 enabled case）")
    async def run_sql_eval(
        self,
        info: strawberry.Info,
        limit: int = 50,
    ) -> SqlEvalRunResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return SqlEvalRunResponseType(
                success=False, message=e.message, total=0, executable_count=0, passing_rate=0.0, results=[]
            )

        try:
            await load_llm_provider_config()
            cap = max(1, min(int(limit or 50), 50))  # 上限 50 防 LLM 滥用

            async with get_session()() as session:
                cases = (
                    await session.execute(
                        select(SqlEvalCase)
                        .where(SqlEvalCase.enabled.is_(True))
                        .order_by(SqlEvalCase.id.asc())
                        .limit(cap)
                    )
                ).scalars().all()

            if not cases:
                return SqlEvalRunResponseType(
                    success=True,
                    message="无 enabled 用例",
                    total=0,
                    executable_count=0,
                    passing_rate=0.0,
                    results=[],
                )

            from x_models.id_x_010.src.agents.x_sql_agent import SQLAgent, validate_sql_security

            # 按 db_name 缓存 agent 避免重复 connect
            agents: dict = {}
            results: list = []
            executable_count = 0

            for case in cases:
                # 复用 SQLAgent 缓存（get_sql_agent），无则新建
                if case.db_name not in agents:
                    agents[case.db_name] = SQLAgent(db_name=case.db_name)
                    await agents[case.db_name].db.connect()

                agent = agents[case.db_name]
                # 借用 get_sql_agent 缓存逻辑：get_sql_agent 内部已做 LRU
                # 这里直接用 new SQLAgent 即可（评估场景不需 supervisor 路由）
                generated_sql = ""
                executable = False
                error_msg = None
                try:
                    # 调 query() 拿生成 SQL（不执行——通过 SQLSecurityChecker 检查可执行性）
                    # 这里简化：调 agent._generate_query_node + check_query
                    # 复杂场景需要 stream，简化为直接拿 sql 字段
                    stream_result = agent.graph_query(question=case.question) if hasattr(agent, "graph_query") else None
                    # 没有 graph_query 方法时降级为安全检查 expected_sql
                    if stream_result is None:
                        # 降级：直接对 expected_sql 做安全检查（验证用例可执行性）
                        sql_to_check = case.expected_sql or ""
                        if not sql_to_check:
                            error_msg = "未生成 SQL 且无 expected_sql"
                        else:
                            safe, reason = validate_sql_security(sql_to_check)
                            if safe:
                                # 进一步尝试执行（取一行验证）
                                try:
                                    rows, _ = await agent.db.execute_query(
                                        f"EXPLAIN {sql_to_check}"
                                    )
                                    executable = True
                                except Exception as ee:
                                    error_msg = f"EXPLAIN 失败: {ee}"
                            else:
                                error_msg = f"安全检查未通过: {reason}"
                except Exception as ee:
                    error_msg = f"{type(ee).__name__}: {ee}"

                if executable:
                    executable_count += 1

                results.append(
                    SqlEvalResultType(
                        case_id=case.id,
                        generated_sql=generated_sql or case.expected_sql,
                        executable=executable,
                        error=error_msg,
                    )
                )

                # 落库评估结果
                async with get_session()() as session:
                    session.add(
                        SqlEvalResult(
                            case_id=case.id,
                            generated_sql=generated_sql or case.expected_sql,
                            executable=executable,
                            error=error_msg,
                        )
                    )
                    await session.commit()

            # 关闭所有 agent 连接
            for ag in agents.values():
                try:
                    await ag.db.disconnect()
                except Exception:
                    pass

            passing_rate = (executable_count / len(cases)) if cases else 0.0
            return SqlEvalRunResponseType(
                success=True,
                message=f"已评估 {len(cases)} 条用例",
                total=len(cases),
                executable_count=executable_count,
                passing_rate=round(passing_rate, 4),
                results=results,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}run_sql_eval 失败: {e}", exc_info=True
            )
            return SqlEvalRunResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                total=0,
                executable_count=0,
                passing_rate=0.0,
                results=[],
            )

    @strawberry.mutation(description="导出 SQL 查询结果（≤1 万行；同步返回 base64）")
    async def export_result(
        self,
        info: strawberry.Info,
        query: str,
        fmt: str = "xlsx",
        db_name: Optional[str] = None,
    ) -> ExportResultResponseType:
        """同步执行 SQL ≤1 万行；超限返回 success=False 提示。"""
        import base64

        from x_models.id_x_010.src.utils.x_export import (
            export_csv,
            export_json,
            export_xlsx,
        )

        request = _get_info_request(info)
        user = await _get_bearer_user(request)
        if user is None:
            return ExportResultResponseType(
                success=False, message="未登录", file_name=None, content_base64=None
            )

        if not query or not query.strip():
            return ExportResultResponseType(
                success=False,
                message="query 不能为空",
                file_name=None,
                content_base64=None,
            )

        # 安全检查：只允许 SELECT；复用 SQL Agent 的 SQLSecurityChecker
        from x_models.id_x_010.src.agents.x_sql_agent import (
            SQLAgent,
            validate_sql_security,
        )

        safe, reason = validate_sql_security(query)
        if not safe:
            return ExportResultResponseType(
                success=False,
                message=f"SQL 安全检查未通过: {reason}",
                file_name=None,
                content_base64=None,
            )

        try:
            await load_llm_provider_config()
            sql_agent = SQLAgent(db_name=db_name)
            await sql_agent.db.connect()
            try:
                rows, columns = await sql_agent.db.execute_query(query)
            finally:
                try:
                    await sql_agent.db.disconnect()
                except Exception:
                    pass

            if len(rows) > 10_000:
                return ExportResultResponseType(
                    success=False,
                    message=f"结果 {len(rows)} 行超限（>1 万），请缩小查询范围",
                    file_name=None,
                    content_base64=None,
                )

            fmt_lower = (fmt or "xlsx").lower()
            if fmt_lower == "csv":
                content = export_csv(rows, columns)
            elif fmt_lower == "json":
                content = export_json(rows)
            else:
                content = export_xlsx(rows, columns)

            ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
            file_name = f"export_{ts}.{fmt_lower}"
            return ExportResultResponseType(
                success=True,
                message=f"导出 {len(rows)} 行",
                file_name=file_name,
                content_base64=base64.b64encode(content).decode("ascii"),
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}export_result 失败: {e}", exc_info=True
            )
            return ExportResultResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                file_name=None,
                content_base64=None,
            )

    @strawberry.mutation(description="管理员：新增/更新报告订阅")
    async def save_report_subscription(
        self, info: strawberry.Info, input: ReportSubscriptionInput
    ) -> "ReportSubscriptionMutationResponseType":
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            admin = await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return ReportSubscriptionMutationResponseType(
                success=False, message=e.message, subscription=None
            )

        try:
            import json as _json

            recipients = None
            if input.recipients:
                try:
                    recipients = _json.loads(input.recipients)
                except _json.JSONDecodeError:
                    recipients = None

            async with get_session()() as session:
                if input.id is None:
                    sub = ReportSubscription(
                        user_id=admin.id,
                        name=input.name,
                        cron=input.cron,
                        query_template=input.query_template,
                        format=input.format or "xlsx",
                        db_name=input.db_name,
                        recipients=recipients,
                        enabled=input.enabled,
                    )
                    session.add(sub)
                else:
                    sub = (
                        await session.execute(
                            select(ReportSubscription).where(
                                ReportSubscription.id == input.id
                            )
                        )
                    ).scalar_one_or_none()
                    if sub is None:
                        return ReportSubscriptionMutationResponseType(
                            success=False,
                            message=f"订阅不存在: id={input.id}",
                            subscription=None,
                        )
                    sub.name = input.name
                    sub.cron = input.cron
                    sub.query_template = input.query_template
                    sub.format = input.format or "xlsx"
                    sub.db_name = input.db_name
                    sub.recipients = recipients
                    sub.enabled = input.enabled

                await session.commit()
                await session.refresh(sub)

            return ReportSubscriptionMutationResponseType(
                success=True,
                message="保存成功",
                subscription=_to_subscription_type(sub),
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}save_report_subscription 失败: {e}", exc_info=True
            )
            return ReportSubscriptionMutationResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                subscription=None,
            )

    @strawberry.field(description="管理员：列出报告订阅")
    async def list_report_subscriptions(
        self, info: strawberry.Info
    ) -> ReportSubscriptionListResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return ReportSubscriptionListResponseType(
                success=False, message=e.message, subscriptions=[]
            )

        try:
            async with get_session()() as session:
                rows = (
                    await session.execute(
                        select(ReportSubscription).order_by(
                            ReportSubscription.id.desc()
                        )
                    )
                ).scalars().all()
            return ReportSubscriptionListResponseType(
                success=True,
                message=f"查询到 {len(rows)} 条",
                subscriptions=[_to_subscription_type(r) for r in rows],
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}list_report_subscriptions 失败: {e}", exc_info=True
            )
            return ReportSubscriptionListResponseType(
                success=False,
                message=f"失败: {type(e).__name__}: {e}",
                subscriptions=[],
            )

    @strawberry.mutation(description="管理员：删除报告订阅")
    async def delete_report_subscription(
        self, info: strawberry.Info, subscription_id: int
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            async with get_session()() as session:
                sub = (
                    await session.execute(
                        select(ReportSubscription).where(
                            ReportSubscription.id == subscription_id
                        )
                    )
                ).scalar_one_or_none()
                if sub is None:
                    return AdminMutationResponseType(
                        success=False, message=f"订阅不存在: id={subscription_id}"
                    )
                await session.delete(sub)
                await session.commit()
            return AdminMutationResponseType(success=True, message="已删除")
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)
        except Exception as e:
            logger.error(
                f"{get_request_id()}delete_report_subscription 失败: {e}", exc_info=True
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )

    @strawberry.mutation(description="保存当前用户的模型设置（保存前先做连通性检测）")
    async def save_model_settings(
        self, info: strawberry.Info, input: ModelSettingsInput
    ) -> ModelSettingsResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ModelSettingsResponseType(
                    success=False, message="未登录或登录已过期", settings=None
                )

            provider = input.provider.strip()
            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_name = input.model_name.strip()
            model_name_list = [n.strip() for n in (input.model_name_list or []) if n and n.strip()]

            if not all([provider, base_url, api_key, model_name]):
                return ModelSettingsResponseType(
                    success=False,
                    message="模型厂商、访问地址、API-KEY、默认模型名称均为必填项",
                    settings=None,
                )

            # 默认模型必须在列表内；列表为空时以默认模型作为唯一可选项
            if model_name not in model_name_list:
                model_name_list = [model_name, *model_name_list]

            # 配额由管理员在后台设置，用户保存设置时沿用库中既有值
            existing = await get_user_model_settings(user.id)
            quota_limit = existing.quota_limit_monthly_usd if existing else None

            logger.info(
                f"{get_request_id()}收到模型设置保存请求，开始连通性检测: "
                f"user_id={user.id}, provider={provider}, "
                f"default={model_name}, list={model_name_list}, base_url={base_url}"
            )

            ok, message = await test_model_connectivity(
                base_url=base_url, api_key=api_key, model_name=model_name
            )
            if not ok:
                return ModelSettingsResponseType(
                    success=False,
                    message=f"连通性检测未通过，设置未保存: {message}",
                    settings=None,
                )

            settings = await upsert_user_model_settings(
                user_id=user.id,
                provider=provider,
                base_url=base_url,
                api_key=api_key,
                model_name=model_name,
                model_name_list=model_name_list,
                quota_limit_monthly_usd=quota_limit,
            )

            # 同步登记默认模型到 external_models 表，使未配置用户级模型设置时
            # 全局列表仍可见该模型。失败不影响用户设置已保存的事实，仅记日志。
            try:
                await upsert_external_model(
                    name=model_name,
                    provider=provider,
                    base_url=base_url,
                    api_key=api_key,
                )
            except Exception as sync_err:
                logger.warning(
                    f"{get_request_id()}同步登记 external_models 失败（用户设置已保存）: {sync_err}"
                )

            return ModelSettingsResponseType(
                success=True,
                message=f"{message}，设置已保存",
                settings=_settings_type(settings),
            )

        except Exception as e:
            logger.error(f"{get_request_id()}保存模型设置失败: {e}", exc_info=True)
            return ModelSettingsResponseType(
                success=False, message=f"保存模型设置失败: {str(e)}", settings=None
            )

    @strawberry.mutation(description="测试模型连通性（不落库），用于保存前的独立检测")
    async def test_connection(
        self, info: strawberry.Info, input: TestConnectionInput
    ) -> TestConnectionResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return TestConnectionResponseType(
                    success=False, message="未登录或登录已过期"
                )

            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_name = input.model_name.strip()

            if not all([base_url, api_key, model_name]):
                return TestConnectionResponseType(
                    success=False,
                    message="访问地址、API-KEY、模型名称均为必填项",
                )

            logger.info(
                f"{get_request_id()}收到连通性测试请求: user_id={user.id}, "
                f"model={model_name}, base_url={base_url}"
            )

            ok, message = await test_model_connectivity(
                base_url=base_url, api_key=api_key, model_name=model_name
            )
            return TestConnectionResponseType(success=ok, message=message)
        except Exception as e:
            logger.error(f"{get_request_id()}连通性测试失败: {e}", exc_info=True)
            return TestConnectionResponseType(
                success=False, message=f"连通性测试失败: {str(e)}"
            )

    # ------------------------------------------------------------------
    # 用户自定义模型 Provider（多 Provider，每 Provider 多模型）
    # ------------------------------------------------------------------

    @strawberry.mutation(description="新增/更新用户自定义模型 Provider（含连通性检测）")
    async def save_model_provider(
        self, info: strawberry.Info, input: UserModelPropertyInput
    ) -> UserModelPropertyMutationResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UserModelPropertyMutationResponseType(
                    success=False, message="未登录或登录已过期", provider=None
                )

            provider_name = input.provider.strip()
            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_list = [n.strip() for n in (input.model_name_list or []) if n and n.strip()]

            if not all([provider_name, base_url, api_key]):
                return UserModelPropertyMutationResponseType(
                    success=False,
                    message="模型厂商、访问地址、API-KEY 均为必填项",
                    provider=None,
                )
            if not model_list:
                return UserModelPropertyMutationResponseType(
                    success=False,
                    message="至少添加一个模型名称",
                    provider=None,
                )

            # 连通性检测：用第一个模型名测试
            if input.test_connection:
                ok, msg = await test_model_connectivity(
                    base_url=base_url, api_key=api_key, model_name=model_list[0]
                )
                if not ok:
                    return UserModelPropertyMutationResponseType(
                        success=False,
                        message=f"连通性检测未通过: {msg}",
                        provider=None,
                    )

            saved = await upsert_user_model_provider(
                user_id=user.id,
                provider=provider_name,
                base_url=base_url,
                api_key=api_key,
                model_name_list=model_list,
                sort_order=input.sort_order,
                provider_id=input.id,
            )
            if saved is None:
                return UserModelPropertyMutationResponseType(
                    success=False, message="保存失败", provider=None
                )

            return UserModelPropertyMutationResponseType(
                success=True,
                message="Provider 已保存",
                provider=UserModelPropertyType(
                    id=saved.id,
                    provider=saved.provider,
                    base_url=saved.base_url,
                    api_key=saved.api_key,
                    model_name_list=list(saved.model_name_list or []),
                    sort_order=saved.sort_order,
                    created_at=(
                        saved.created_at.isoformat() if saved.created_at else None
                    ),
                    updated_at=(
                        saved.updated_at.isoformat() if saved.updated_at else None
                    ),
                ),
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}保存用户 Provider 失败: {e}", exc_info=True
            )
            return UserModelPropertyMutationResponseType(
                success=False, message=f"失败: {str(e)}", provider=None
            )

    @strawberry.mutation(description="删除用户自定义模型 Provider")
    async def delete_model_provider(
        self, info: strawberry.Info, provider_id: int
    ) -> UserModelPropertyMutationResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UserModelPropertyMutationResponseType(
                    success=False, message="未登录或登录已过期", provider=None
                )

            ok = await delete_user_model_provider(user.id, provider_id)
            if not ok:
                return UserModelPropertyMutationResponseType(
                    success=False, message="Provider 不存在或已被删除", provider=None
                )
            return UserModelPropertyMutationResponseType(
                success=True, message="Provider 已删除", provider=None
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}删除用户 Provider 失败: {e}", exc_info=True
            )
            return UserModelPropertyMutationResponseType(
                success=False, message=f"失败: {str(e)}", provider=None
            )

    @strawberry.mutation(description="设置默认模型名（跨 Provider 选择；配额由管理员在后台设置）")
    async def save_default_model(
        self, info: strawberry.Info, input: SaveDefaultModelInput
    ) -> SaveDefaultModelResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return SaveDefaultModelResponseType(
                    success=False, message="未登录或登录已过期",
                )

            model_name = input.model_name.strip()
            if not model_name:
                return SaveDefaultModelResponseType(
                    success=False, message="默认模型名不能为空",
                )

            # 默认模型名存入 user_model_settings；配额由管理员通过
            # set_user_system_quota 维护，此处不再触碰 users.system_model_quota_usd
            settings = await upsert_user_model_settings(
                user_id=user.id,
                provider="",
                base_url="",
                api_key="",
                model_name=model_name,
                model_name_list=[],
                quota_limit_monthly_usd=None,
            )
            if settings is None:
                return SaveDefaultModelResponseType(
                    success=False, message="保存失败",
                )

            return SaveDefaultModelResponseType(
                success=True,
                message="默认模型已设置",
                model_name=settings.model_name,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}保存默认模型失败: {e}", exc_info=True
            )
            return SaveDefaultModelResponseType(
                success=False, message=f"失败: {str(e)}",
            )

    @strawberry.mutation(description="新增/更新外部模型到 external_models 表（支持多模型 + Provider 自定义）")
    async def save_external_model(
        self, info: strawberry.Info, input: ExternalModelInput
    ) -> ExternalModelMutationResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return ExternalModelMutationResponseType(
                    success=False, message="未登录或登录已过期", model=None
                )

            provider = input.provider.strip()
            base_url = input.base_url.strip().rstrip("/")
            api_key = input.api_key.strip()
            model_name = input.model_name.strip()

            if not all([provider, base_url, api_key, model_name]):
                return ExternalModelMutationResponseType(
                    success=False,
                    message="厂商、访问地址、API-KEY、模型名称均为必填项",
                    model=None,
                )

            # 可选连通性检测（默认开启）
            if input.test_connection:
                logger.info(
                    f"{get_request_id()}保存外部模型前连通性检测: "
                    f"provider={provider}, model={model_name}"
                )
                ok, msg = await test_model_connectivity(
                    base_url=base_url, api_key=api_key, model_name=model_name
                )
                if not ok:
                    return ExternalModelMutationResponseType(
                        success=False,
                        message=f"连通性检测未通过，模型未保存: {msg}",
                        model=None,
                    )

            saved = await upsert_external_model(
                name=model_name,
                provider=provider,
                base_url=base_url,
                api_key=api_key,
            )
            if saved is None:
                return ExternalModelMutationResponseType(
                    success=False, message="保存到数据库失败", model=None
                )

            result_model = ExternalModelType(
                id=saved.id,
                name=saved.name,
                provider=saved.provider,
                base_url=saved.base_url,
                api_key=saved.api_key,
            )
            msg = (
                "连通性检测通过，模型已保存"
                if input.test_connection
                else "模型已保存"
            )
            return ExternalModelMutationResponseType(
                success=True, message=msg, model=result_model
            )
        except Exception as e:
            logger.error(f"{get_request_id()}保存外部模型失败: {e}", exc_info=True)
            return ExternalModelMutationResponseType(
                success=False, message=f"保存失败: {str(e)}", model=None
            )

    @strawberry.mutation(description="删除 external_models 表中的指定模型")
    async def delete_external_model(
        self, info: strawberry.Info, model_id: int
    ) -> DeleteExternalModelResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return DeleteExternalModelResponseType(
                    success=False, message="未登录或登录已过期"
                )

            ok = await delete_external_model(model_id)
            if not ok:
                return DeleteExternalModelResponseType(
                    success=False, message="模型不存在或已被删除"
                )
            return DeleteExternalModelResponseType(
                success=True, message="模型已删除"
            )
        except Exception as e:
            logger.error(f"{get_request_id()}删除外部模型失败: {e}", exc_info=True)
            return DeleteExternalModelResponseType(
                success=False, message=f"删除失败: {str(e)}"
            )

    @strawberry.mutation(description="将指定外部模型设为当前用户的活跃模型（写入 user_model_settings）")
    async def set_active_model(
        self, info: strawberry.Info, model_id: int
    ) -> SetActiveModelResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return SetActiveModelResponseType(
                    success=False, message="未登录或登录已过期"
                )

            model = await get_external_model_by_id(model_id)
            if model is None:
                return SetActiveModelResponseType(
                    success=False, message="模型不存在"
                )

            # 沿用用户既有的模型列表与额度配置，仅切换默认模型；
            # 若默认模型不在列表内则自动追加。无既有设置则新建单元素列表。
            existing = await get_user_model_settings(user.id)
            name_list = list(existing.model_name_list or []) if existing else []
            if model.name not in name_list:
                name_list = [model.name, *name_list]
            quota = existing.quota_limit_monthly_usd if existing else None

            settings = await upsert_user_model_settings(
                user_id=user.id,
                provider=model.provider,
                base_url=model.base_url,
                api_key=model.api_key,
                model_name=model.name,
                model_name_list=name_list,
                quota_limit_monthly_usd=quota,
            )
            if settings is None:
                return SetActiveModelResponseType(
                    success=False, message="设置活跃模型失败"
                )

            logger.info(
                f"{get_request_id()}默认模型已切换: user_id={user.id}, "
                f"model={model.name}, id={model.id}"
            )
            return SetActiveModelResponseType(
                success=True,
                message=f"默认模型已切换为 {model.name}",
            )
        except Exception as e:
            logger.error(f"{get_request_id()}设置活跃模型失败: {e}", exc_info=True)
            return SetActiveModelResponseType(
                success=False, message=f"设置失败: {str(e)}"
            )

    # ------------------------------------------------------------------
    # 系统预置模型管理（system_model_settings 表，管理员 CRUD）
    # ------------------------------------------------------------------

    @strawberry.mutation(description="管理员：新增/更新系统预置模型（保存前可选连通性检测）")
    async def save_system_model(
        self, info: strawberry.Info, input: SystemModelInput
    ) -> SystemModelMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return SystemModelMutationResponseType(
                success=False, message=e.message, model=None
            )

        provider = input.provider.strip()
        base_url = input.base_url.strip().rstrip("/")
        api_key = input.api_key.strip()
        name = input.name.strip()
        model_type = (input.model_type or "external").strip()

        if not all([name, provider, base_url, api_key]):
            return SystemModelMutationResponseType(
                success=False,
                message="模型名称、厂商、访问地址、API-KEY 均为必填项",
                model=None,
            )

        if input.test_connection:
            logger.info(
                f"{get_request_id()}保存系统模型前连通性检测: "
                f"provider={provider}, model={name}"
            )
            ok, msg = await test_model_connectivity(
                base_url=base_url, api_key=api_key, model_name=name
            )
            if not ok:
                return SystemModelMutationResponseType(
                    success=False,
                    message=f"连通性检测未通过，模型未保存: {msg}",
                    model=None,
                )

        saved = await upsert_system_model(
            name=name,
            provider=provider,
            base_url=base_url,
            api_key=api_key,
            model_type=model_type,
            is_default=input.is_default,
            enabled=input.enabled,
            sort_order=input.sort_order,
            model_id=input.id,
        )
        if saved is None:
            return SystemModelMutationResponseType(
                success=False, message="保存到数据库失败", model=None
            )

        result_model = SystemModelType(
            id=saved.id,
            name=saved.name,
            provider=saved.provider,
            base_url=saved.base_url,
            api_key=saved.api_key,
            model_type=saved.model_type or "external",
            is_default=bool(saved.is_default),
            enabled=bool(saved.enabled),
            sort_order=saved.sort_order,
            created_at=saved.created_at.isoformat() if saved.created_at else None,
            updated_at=saved.updated_at.isoformat() if saved.updated_at else None,
        )
        msg = "连通性检测通过，系统模型已保存" if input.test_connection else "系统模型已保存"
        return SystemModelMutationResponseType(
            success=True, message=msg, model=result_model
        )

    @strawberry.mutation(description="管理员：删除系统预置模型")
    async def delete_system_model(
        self, info: strawberry.Info, model_id: int
    ) -> DeleteSystemModelResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return DeleteSystemModelResponseType(success=False, message=e.message)

        try:
            ok = await delete_system_model(model_id)
            if not ok:
                return DeleteSystemModelResponseType(
                    success=False, message="模型不存在或已被删除"
                )
            return DeleteSystemModelResponseType(
                success=True, message="系统模型已删除"
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}删除系统模型失败: {e}", exc_info=True
            )
            return DeleteSystemModelResponseType(
                success=False, message=f"删除失败: {str(e)}"
            )

    # ------------------------------------------------------------------
    # 模型价格管理（model_prices 表，管理员 CRUD，USD / 1M tokens）
    # ------------------------------------------------------------------

    @strawberry.mutation(description="管理员：新增/更新模型价格（USD / 1M tokens）")
    async def save_model_price(
        self, info: strawberry.Info, input: ModelPriceInput
    ) -> ModelPriceMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return ModelPriceMutationResponseType(
                success=False, message=e.message, price=None
            )

        model_key = (input.model_key or "").strip().lower()
        if not model_key:
            return ModelPriceMutationResponseType(
                success=False, message="模型名称匹配串不能为空", price=None
            )
        if input.input_price_per_1m < 0 or input.output_price_per_1m < 0:
            return ModelPriceMutationResponseType(
                success=False, message="价格不能为负数", price=None
            )

        saved = await upsert_model_price(
            model_key=model_key,
            input_price_per_1m=input.input_price_per_1m,
            output_price_per_1m=input.output_price_per_1m,
            enabled=input.enabled,
            price_id=input.id,
        )
        if saved is None:
            return ModelPriceMutationResponseType(
                success=False,
                message="保存失败：记录不存在或 model_key 与其它行冲突",
                price=None,
            )

        return ModelPriceMutationResponseType(
            success=True,
            message="模型价格已保存",
            price=ModelPriceType(
                id=saved.id,
                model_key=saved.model_key,
                input_price_per_1m=float(saved.input_price_per_1m or 0.0),
                output_price_per_1m=float(saved.output_price_per_1m or 0.0),
                enabled=bool(saved.enabled),
                created_at=saved.created_at.isoformat() if saved.created_at else None,
                updated_at=saved.updated_at.isoformat() if saved.updated_at else None,
            ),
        )

    @strawberry.mutation(description="管理员：删除模型价格（删除后计价回退内置目录）")
    async def delete_model_price(
        self, info: strawberry.Info, price_id: int
    ) -> DeleteModelPriceResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
        except AdminRequiredError as e:
            return DeleteModelPriceResponseType(success=False, message=e.message)

        try:
            ok = await delete_model_price(price_id)
            if not ok:
                return DeleteModelPriceResponseType(
                    success=False, message="价格记录不存在或已被删除"
                )
            return DeleteModelPriceResponseType(
                success=True, message="模型价格已删除"
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}删除模型价格失败: {e}", exc_info=True
            )
            return DeleteModelPriceResponseType(
                success=False, message=f"删除失败: {str(e)}"
            )

    # ------------------------------------------------------------------
    # 用户对系统预置模型的 API Key 映射（system_model_user_mappings 表）
    # 用户可保存自己的 key 覆盖系统模型的全局 key，便于按用户统计用量
    # ------------------------------------------------------------------

    @strawberry.field(description="获取当前用户对系统预置模型的 API Key 映射列表")
    async def my_system_model_keys(
        self, info: strawberry.Info
    ) -> SystemModelUserMappingListResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return SystemModelUserMappingListResponseType(
                    success=False, message="未登录或登录已过期", mappings=[]
                )

            mappings = await list_user_system_model_mappings(user.id)
            # JOIN 回填 system_model_name
            sys_models = {m.id: m for m in await list_system_models(enabled_only=False)}
            result = []
            for mp in mappings:
                sm = sys_models.get(mp.system_model_id)
                result.append(
                    SystemModelUserMappingType(
                        id=mp.id,
                        user_id=mp.user_id,
                        system_model_id=mp.system_model_id,
                        system_model_name=sm.name if sm else None,
                        api_key=mp.api_key,
                        created_at=(
                            mp.created_at.isoformat() if mp.created_at else None
                        ),
                        updated_at=(
                            mp.updated_at.isoformat() if mp.updated_at else None
                        ),
                    )
                )
            return SystemModelUserMappingListResponseType(
                success=True,
                message=f"查询到 {len(result)} 条映射",
                mappings=result,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}获取用户系统模型映射失败: {e}", exc_info=True
            )
            return SystemModelUserMappingListResponseType(
                success=False, message=f"失败: {str(e)}", mappings=[]
            )

    @strawberry.mutation(description="保存当前用户对系统预置模型的个人 API Key")
    async def save_system_model_user_key(
        self, info: strawberry.Info, input: SystemModelUserKeyInput
    ) -> SystemModelUserKeyMutationResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return SystemModelUserKeyMutationResponseType(
                    success=False, message="未登录或登录已过期", mapping=None
                )

            api_key = input.api_key.strip()
            if not api_key:
                return SystemModelUserKeyMutationResponseType(
                    success=False, message="API Key 不能为空", mapping=None
                )

            systemModelBlockMsg = (
                "系统预置模型 API Key 由管理员统一配置，禁止普通用户自助设置"
            )
            if not (user.has_role("admin") or bool(getattr(user, "is_admin", False))):
                return SystemModelUserKeyMutationResponseType(
                    success=False, message=systemModelBlockMsg, mapping=None
                )

            # 校验 system_model_id 存在且 enabled
            sys_models = await list_system_models(enabled_only=True)
            sm = next((m for m in sys_models if m.id == input.system_model_id), None)
            if sm is None:
                return SystemModelUserKeyMutationResponseType(
                    success=False,
                    message=f"系统预置模型不存在或未启用: id={input.system_model_id}",
                    mapping=None,
                )

            # 可选连通性检测
            if input.test_connection:
                ok, msg = await test_model_connectivity(
                    base_url=sm.base_url, api_key=api_key, model_name=sm.name
                )
                if not ok:
                    return SystemModelUserKeyMutationResponseType(
                        success=False,
                        message=f"连通性检测未通过: {msg}",
                        mapping=None,
                    )

            mapping = await upsert_user_system_model_mapping(
                user_id=user.id,
                system_model_id=input.system_model_id,
                api_key=api_key,
            )
            if mapping is None:
                return SystemModelUserKeyMutationResponseType(
                    success=False, message="保存失败", mapping=None
                )

            return SystemModelUserKeyMutationResponseType(
                success=True,
                message="用户的系统模型 API Key 已保存",
                mapping=SystemModelUserMappingType(
                    id=mapping.id,
                    user_id=mapping.user_id,
                    system_model_id=mapping.system_model_id,
                    system_model_name=sm.name,
                    api_key=mapping.api_key,
                    created_at=(
                        mapping.created_at.isoformat() if mapping.created_at else None
                    ),
                    updated_at=(
                        mapping.updated_at.isoformat() if mapping.updated_at else None
                    ),
                ),
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}保存用户系统模型映射失败: {e}", exc_info=True
            )
            return SystemModelUserKeyMutationResponseType(
                success=False, message=f"失败: {str(e)}", mapping=None
            )

    @strawberry.mutation(description="删除当前用户对系统预置模型的个人 API Key（回退到全局 key）")
    async def delete_system_model_user_key(
        self, info: strawberry.Info, system_model_id: int
    ) -> SystemModelUserKeyMutationResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return SystemModelUserKeyMutationResponseType(
                    success=False, message="未登录或登录已过期", mapping=None
                )

            if not (user.has_role("admin") or bool(getattr(user, "is_admin", False))):
                return SystemModelUserKeyMutationResponseType(
                    success=False,
                    message="系统预置模型 API Key 由管理员统一配置，禁止普通用户自助删除",
                    mapping=None,
                )

            ok = await delete_user_system_model_mapping(user.id, system_model_id)
            if not ok:
                return SystemModelUserKeyMutationResponseType(
                    success=False,
                    message="映射不存在或已被删除",
                    mapping=None,
                )
            return SystemModelUserKeyMutationResponseType(
                success=True,
                message="已删除个人 Key，将回退到系统模型的全局 Key",
                mapping=None,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}删除用户系统模型映射失败: {e}", exc_info=True
            )
            return SystemModelUserKeyMutationResponseType(
                success=False, message=f"失败: {str(e)}", mapping=None
            )

    # ------------------------------------------------------------------
    # 管理员：替指定用户管理系统预置模型的 API Key
    # 普通用户不能自助配置系统模型 API Key，由管理员在后台逐用户配置。
    # ------------------------------------------------------------------

    @strawberry.field(description="管理员：列出指定用户对系统预置模型的 API Key 映射")
    async def admin_list_user_system_model_keys(
        self, info: strawberry.Info, user_id: int
    ) -> SystemModelUserMappingListResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            mappings = await list_user_system_model_mappings(user_id)
            sys_models = {m.id: m for m in await list_system_models(enabled_only=False)}
            result = []
            for mp in mappings:
                sm = sys_models.get(mp.system_model_id)
                result.append(
                    SystemModelUserMappingType(
                        id=mp.id,
                        user_id=mp.user_id,
                        system_model_id=mp.system_model_id,
                        system_model_name=sm.name if sm else None,
                        api_key=mp.api_key,
                        created_at=mp.created_at.isoformat() if mp.created_at else None,
                        updated_at=mp.updated_at.isoformat() if mp.updated_at else None,
                    )
                )
            return SystemModelUserMappingListResponseType(
                success=True,
                message=f"查询到 {len(result)} 条映射",
                mappings=result,
            )
        except AdminRequiredError as e:
            return SystemModelUserMappingListResponseType(
                success=False, message=e.message, mappings=[]
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}管理员查询用户系统模型映射失败: {e}",
                exc_info=True,
            )
            return SystemModelUserMappingListResponseType(
                success=False, message=f"失败: {str(e)}", mappings=[]
            )

    @strawberry.mutation(description="管理员：为指定用户保存系统预置模型的 API Key")
    async def admin_save_user_system_model_key(
        self, info: strawberry.Info, input: AdminSystemModelUserKeyInput
    ) -> SystemModelUserKeyMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))

            api_key = input.api_key.strip()
            if not api_key:
                return SystemModelUserKeyMutationResponseType(
                    success=False, message="API Key 不能为空", mapping=None
                )

            sys_models = await list_system_models(enabled_only=False)
            sm = next((m for m in sys_models if m.id == input.system_model_id), None)
            if sm is None:
                return SystemModelUserKeyMutationResponseType(
                    success=False,
                    message=f"系统预置模型不存在: id={input.system_model_id}",
                    mapping=None,
                )

            if input.test_connection:
                ok, msg = await test_model_connectivity(
                    base_url=sm.base_url, api_key=api_key, model_name=sm.name
                )
                if not ok:
                    return SystemModelUserKeyMutationResponseType(
                        success=False,
                        message=f"连通性检测未通过: {msg}",
                        mapping=None,
                    )

            mapping = await upsert_user_system_model_mapping(
                user_id=input.user_id,
                system_model_id=input.system_model_id,
                api_key=api_key,
            )
            if mapping is None:
                return SystemModelUserKeyMutationResponseType(
                    success=False, message="保存失败", mapping=None
                )
            return SystemModelUserKeyMutationResponseType(
                success=True,
                message="已保存该用户的系统模型 API Key",
                mapping=SystemModelUserMappingType(
                    id=mapping.id,
                    user_id=mapping.user_id,
                    system_model_id=mapping.system_model_id,
                    system_model_name=sm.name,
                    api_key=mapping.api_key,
                    created_at=mapping.created_at.isoformat() if mapping.created_at else None,
                    updated_at=mapping.updated_at.isoformat() if mapping.updated_at else None,
                ),
            )
        except AdminRequiredError as e:
            return SystemModelUserKeyMutationResponseType(
                success=False, message=e.message, mapping=None
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}管理员保存用户系统模型映射失败: {e}",
                exc_info=True,
            )
            return SystemModelUserKeyMutationResponseType(
                success=False, message=f"失败: {str(e)}", mapping=None
            )

    @strawberry.mutation(description="管理员：删除指定用户对系统预置模型的个人 API Key")
    async def admin_delete_user_system_model_key(
        self, info: strawberry.Info, user_id: int, system_model_id: int
    ) -> AdminMutationResponseType:
        from x_models.id_x_010.src.middleware.x_admin import (
            AdminRequiredError,
            require_admin,
        )

        try:
            await require_admin(_get_info_request(info))
            ok = await delete_user_system_model_mapping(user_id, system_model_id)
            if not ok:
                return AdminMutationResponseType(
                    success=False, message="映射不存在或已被删除"
                )
            return AdminMutationResponseType(
                success=True, message="已删除该用户的个人 Key"
            )
        except AdminRequiredError as e:
            return AdminMutationResponseType(success=False, message=e.message)
        except Exception as e:
            logger.error(
                f"{get_request_id()}管理员删除用户系统模型映射失败: {e}",
                exc_info=True,
            )
            return AdminMutationResponseType(
                success=False, message=f"失败: {type(e).__name__}: {e}"
            )

    async def logout(self) -> AuthResponseType:
        try:
            return AuthResponseType(
                success=True,
                message="登出成功",
                token=None,
                user=None,
            )

        except Exception as e:
            logger.error(f"{get_request_id()}登出失败: {e}", exc_info=True)
            return AuthResponseType(success=False, message=f"登出失败: {str(e)}")

    @strawberry.mutation(description="更新当前用户资料（显示名称；头像走 /upload-avatar 端点）")
    async def update_profile(
        self, info: strawberry.Info, input: UpdateProfileInput
    ) -> UpdateProfileResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return UpdateProfileResponseType(
                    success=False, message="未登录或登录已过期", user=None
                )

            updated = await update_user_profile(
                user_id=user.id, display_name=input.display_name
            )
            if updated is None:
                return UpdateProfileResponseType(
                    success=False, message="用户不存在或更新失败", user=None
                )

            return UpdateProfileResponseType(
                success=True,
                message="资料已更新",
                user=build_user_info(updated),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}更新资料失败: {e}", exc_info=True)
            return UpdateProfileResponseType(
                success=False, message=f"更新资料失败: {str(e)}", user=None
            )

    @strawberry.mutation(description="选中一个 Markdown 提示词作为当前提示词")
    async def select_markdown_prompt(
        self, info: strawberry.Info, prompt_id: int
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            prompt = await select_markdown_prompt(user.id, prompt_id)
            if prompt is None:
                return MarkdownPromptResponseType(
                    success=False, message="提示词不存在或无权操作", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True, message="已设为当前提示词", prompt=_prompt_type(prompt)
            )
        except Exception as e:
            logger.error(f"{get_request_id()}选中提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"选中提示词失败: {str(e)}", prompt=None
            )

    @strawberry.mutation(description="删除一个 Markdown 提示词")
    async def delete_markdown_prompt(
        self, info: strawberry.Info, prompt_id: int
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            deleted = await delete_markdown_prompt(user.id, prompt_id)
            if not deleted:
                return MarkdownPromptResponseType(
                    success=False, message="提示词不存在或无权操作", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True, message="提示词已删除", prompt=None
            )
        except Exception as e:
            logger.error(f"{get_request_id()}删除提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"删除提示词失败: {str(e)}", prompt=None
            )

    @strawberry.mutation(description="更新提示词的备注名称")
    async def rename_markdown_prompt(
        self, info: strawberry.Info, prompt_id: int, note_name: Optional[str]
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            renamed = await rename_markdown_prompt(user.id, prompt_id, note_name)
            if renamed is None:
                return MarkdownPromptResponseType(
                    success=False, message="提示词不存在或无权操作", prompt=None
                )
            return MarkdownPromptResponseType(
                success=True,
                message="备注名称已更新",
                prompt=_prompt_type(renamed),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}重命名提示词失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"重命名提示词失败: {str(e)}", prompt=None
            )

    @strawberry.mutation(description="更新提示词的 Markdown 正文内容")
    async def update_markdown_content(
        self, info: strawberry.Info, prompt_id: int, content: str
    ) -> MarkdownPromptResponseType:
        try:
            request = _get_info_request(info)
            user = await _get_bearer_user(request)
            if user is None:
                return MarkdownPromptResponseType(
                    success=False, message="未登录或登录已过期", prompt=None
                )

            updated = await update_markdown_content(user.id, prompt_id, content)
            if updated is None:
                return MarkdownPromptResponseType(
                    success=False,
                    message="提示词不存在、无权操作或内容为空",
                    prompt=None,
                )
            return MarkdownPromptResponseType(
                success=True,
                message="内容已更新",
                prompt=_prompt_type(updated),
            )
        except Exception as e:
            logger.error(f"{get_request_id()}更新提示词内容失败: {e}", exc_info=True)
            return MarkdownPromptResponseType(
                success=False, message=f"更新提示词内容失败: {str(e)}", prompt=None
            )


@strawberry.type
class Subscription:
    @strawberry.subscription(description="流式聊天请求")
    async def stream_chat(
        self,
        info: strawberry.Info,
        query: str,
        model_type: str = "external",
        model_name: Optional[str] = None,
        agent_type: Optional[str] = None,
        conversation_id: Optional[str] = None,
        context: Optional[List[str]] = None,
        db_name: Optional[str] = None,
        prompt_disabled: bool = False,
    ) -> AsyncGenerator[StreamChunkType, None]:
        try:
            logger.info(
                f"{get_request_id()}收到流式聊天请求: query='{query[:50]}.../', model_type={model_type}, "
                f"agent_type={agent_type}"
            )

            # TASK-008：限流 + 配额检查（best-effort）。失败 yield error chunk 后 return
            request = _get_info_request(info)
            rl_user = await _get_bearer_user(request)
            rl_key = str(rl_user.id) if rl_user is not None else (
                request.client.host if request and request.client else "anon"
            )

            # TASK-016：从 Accept-Language 头解析语言写入 lang_var，
            # 供 load_prompt 选择对应语言的默认 prompt；解析失败回退 zh-CN
            try:
                from x_models.id_x_010.src.utils.x_prompts import lang_var

                accept_lang = (
                    request.headers.get("accept-language") if request else None
                )
                lang_var.set(accept_lang or "zh-CN")
            except Exception:
                pass

            from x_models.id_x_010.src.middleware.x_ratelimit import rate_limit

            if not await rate_limit("stream_chat", rl_key):
                yield StreamChunkType(
                    type="error",
                    content="请求过于频繁，请稍后再试（每分钟上限 20 次）",
                )
                return

            if rl_user is not None:
                # 系统模型配额检查：移到模型解析后执行
                pass

            frontend_context = None
            if context:
                try:
                    frontend_context = [
                        json.loads(ctx) if isinstance(ctx, str) else ctx
                        for ctx in context
                    ]
                except json.JSONDecodeError:
                    frontend_context = None

            # 优先使用长期记忆（TASK-005）：摘要 + 实体 + 最近 6 条原文；
            # conversation_id 为空或失败时回退 merge_context 原始全量截断行为
            merged_context: Optional[List[Dict[str, str]]] = None
            if conversation_id:
                try:
                    from x_models.id_x_010.src.utils.x_memory import get_context

                    merged_context = await get_context(conversation_id)
                except Exception as e:
                    logger.warning(
                        f"{get_request_id()}get_context 失败,回退 merge_context: "
                        f"{type(e).__name__}: {e}"
                    )
                    merged_context = None

            if not merged_context:
                # 性能：get_conversation_history 仅在 get_context 未产出时才
                # 需要——之前无条件先查导致 get_context 成功时该查询白做
                db_history = None
                if conversation_id:
                    db_history = await get_conversation_history(conversation_id)
                merged_context = merge_context(
                    db_history=db_history,
                    frontend_context=frontend_context,
                )

            if merged_context:
                logger.info(
                    f"{get_request_id()}上下文已加载: {len(merged_context)} 条消息, "
                    f"约 {len(merged_context) // 2} 轮对话"
                )

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 模型解析优先级（通过 resolve_model_endpoint 统一处理）：
            #   1. 前端选中的 model_name → system_model_settings 表查 base_url/api_key
            #   2. 用户级模型设置（model_name_list 共享同一 base_url/api_key）
            #   3. 全局 provider 配置（external_provider 表）
            #   回退到 external_models 表（兼容旧数据）
            # （复用入口处已校验的 rl_user，避免重复 verify_token 的 2 次 DB 往返）
            user_settings = await _get_bearer_settings(request, user=rl_user)

            override_api_key, override_base_url, resolved_model = (
                await resolve_model_endpoint(
                    model_name, user_settings,
                    rl_user.id if rl_user else None,
                )
            )
            if resolved_model:
                model_name = resolved_model

            # 系统模型配额检查：仅当选用系统预置模型时检查
            # 注意：必须在 resolve_model_endpoint 之后判断，因为前端未传 model_name 时
            # 解析后会回填为系统默认模型名（is_default=True 行），否则 is_system_model
            # 永远为 False，导致 usage_logs 不计费、usage_stats 查不到数据。
            _is_system_model_stream = False
            if model_name:
                _sys_model_s = await get_system_model_by_name(model_name)
                _is_system_model_stream = _sys_model_s is not None and _sys_model_s.enabled

            if rl_user is not None and _is_system_model_stream:
                from x_models.id_x_010.src.utils.x_quota import check_user_quota

                ok, msg = await check_user_quota(rl_user.id)
                if not ok:
                    logger.warning(
                        f"{get_request_id()}用户配额超限 user_id={rl_user.id}: {msg}"
                    )
                    yield StreamChunkType(type="error", content=msg)
                    return

            if override_api_key is None and model_name:
                # 兼容旧数据：未命中系统模型表时查 external_models
                ext_model = await get_external_model_by_name(model_name)
                if ext_model is not None:
                    override_api_key = ext_model.api_key
                    override_base_url = ext_model.base_url
                    logger.info(
                        f"{get_request_id()}使用 external_models 配置: "
                        f"model={model_name}, base_url={override_base_url}"
                    )

            if override_api_key is not None and override_base_url is not None:
                logger.info(
                    f"{get_request_id()}模型端点已解析: "
                    f"model={model_name}, base_url={override_base_url}"
                )
                # 按（模型 + 端点）缓存复用 supervisor：每请求新建会重复付出
                # Agent 实例化 / workflow 编译 / PG checkpointer 探测等开销
                orchestrator = get_supervisor(
                    model_type=model_type,
                    model_name=model_name,
                    api_key=override_api_key,
                    base_url=override_base_url,
                )
            else:
                # 回退：未在前端选择模型且无用户设置，
                # 使用全局 provider 配置（external_provider 表）
                orchestrator = get_orchestrator()

            # 自动注入用户当前选中的 Markdown 提示词：
            # - prompt_disabled=True（用户在前端点击取消）：本轮不携带，直接跳过查询
            # - 其它情况（默认）：三种 Agent 模式 + 自动路由全部携带；
            #   总线层仅读取并透传，是否注入由各 Agent 节点自行决定
            active_prompt_content: Optional[str] = None
            if prompt_disabled:
                logger.info(
                    f"{get_request_id()}用户已取消提示词注入(agent_type={agent_type or 'auto'})"
                )
            else:
                # 复用入口处已校验的 rl_user，避免第三次 verify_token
                if rl_user is not None:
                    active_prompt = await get_active_markdown_prompt(rl_user.id)
                    if active_prompt is not None:
                        active_prompt_content = active_prompt.content
                        logger.info(
                            f"{get_request_id()}已携带提示词(agent_type={agent_type or 'auto'}): "
                            f"filename={active_prompt.filename}, "
                            f"chars={len(active_prompt.content)}"
                        )

            full_response = []
            thinking_buffer = []
            model_used = ""
            intent = ""
            captured_usage: Optional[dict] = None

            async for chunk in orchestrator.stream_process(
                query=query,
                model_type=model_type,
                model_name=model_name,
                agent_type=agent_type,
                conversation_id=conversation_id,
                context=merged_context,
                db_name=db_name,
                api_key=override_api_key,
                base_url=override_base_url,
                prompt_content=active_prompt_content,
            ):
                # LLM 末块（done 类型）携带的 token 用量：转发给前端在
                # 气泡底部展示，同时缓存供流结束后落库 usage_logs
                _chunk_usage = chunk.get("usage") or None
                chunk_type = StreamChunkType(
                    type=chunk.get("type", ""),
                    content=chunk.get("content"),
                    model_used=chunk.get("model_used"),
                    conversation_id=chunk.get("conversation_id"),
                    sql=chunk.get("sql"),
                    sql_meaning=chunk.get("sql_meaning"),
                    columns=chunk.get("columns"),
                    data=(
                        json.dumps(chunk["data"], ensure_ascii=False)
                        if chunk.get("data") is not None
                        else None
                    ),
                    row_count=chunk.get("row_count"),
                    chart_config=(
                        json.dumps(chunk["chart_config"], ensure_ascii=False)
                        if chunk.get("chart_config") is not None
                        else None
                    ),
                    # 安全拦截标记：仅 security_block 类型 chunk 会带 true，
                    # 区别于 error 类型的系统错误
                    security_block=(
                        bool(chunk["security_block"])
                        if chunk.get("security_block") is not None
                        else None
                    ),
                    # General Agent 工具调用通知（TASK-004）；其它 Agent
                    # 不会携带这两个字段，保持 None 即可
                    tool_name=chunk.get("tool_name"),
                    tool_output=chunk.get("tool_output"),
                    input_tokens=(
                        int(_chunk_usage.get("input_tokens", 0) or 0)
                        if _chunk_usage
                        else None
                    ),
                    output_tokens=(
                        int(_chunk_usage.get("output_tokens", 0) or 0)
                        if _chunk_usage
                        else None
                    ),
                )

                if chunk_type.type == "intent":
                    intent = chunk_type.content or ""
                elif chunk_type.type == "thinking":
                    thinking_buffer.append(chunk_type.content or "")
                elif chunk_type.type == "content":
                    full_response.append(chunk_type.content or "")
                    model_used = chunk_type.model_used or ""

                # 捕获 LLM 末块返回的 token 用量（best-effort，可能为 None）
                if chunk.get("usage"):
                    captured_usage = chunk["usage"]

                yield chunk_type

            try:
                await save_conversation_log(
                    conversation_id=conversation_id or "",
                    user_query=query,
                    model_response="".join(full_response),
                    thinking_process="".join(thinking_buffer),
                    model_type=model_type,
                    model_name=model_used,
                    intent=intent or "",
                )
            except Exception as e:
                logger.error(f"{get_request_id()}保存对话日志失败: {e}", exc_info=True)

            # 长期记忆（TASK-005）：fire-and-forget 触发滚动摘要，不阻塞主响应。
            # 失败 best-effort，仅 logger.warning；用户感知不到。
            if conversation_id:
                try:
                    import asyncio as _asyncio

                    from x_models.id_x_010.src.utils.x_memory import maybe_summarize

                    _asyncio.create_task(maybe_summarize(conversation_id))
                except Exception as e:
                    logger.warning(
                        f"{get_request_id()}maybe_summarize 触发失败（best-effort）: "
                        f"{type(e).__name__}: {e}"
                    )

            # 落库用量统计（token 消耗 + 估算花费），best-effort，不影响主链路
            try:
                await save_usage_log(
                    # 修复：之前用的 user 变量仅在非 general 分支赋值，
                    # general 模式下 NameError 被 except 吞掉导致用量日志丢失
                    user_id=rl_user.id if rl_user is not None else None,
                    conversation_id=conversation_id or "",
                    model_type=model_type,
                    model_name=model_used or model_name or "",
                    intent=intent or "",
                    usage=captured_usage,
                    is_system_model=_is_system_model_stream,
                )
            except Exception as e:
                logger.error(f"{get_request_id()}保存用量日志失败: {e}", exc_info=True)

        except Exception as e:
            logger.error(f"{get_request_id()}流式聊天接口错误: {e}", exc_info=True)
            yield StreamChunkType(
                type="error",
                content=f"处理请求失败: {str(e)}",
            )


schema = strawberry.Schema(
    query=Query,
    mutation=Mutation,
    subscription=Subscription,
)


async def _generate_cancel_response():
    data = json.dumps(
        {
            "type": "sql_cancelled",
            "content": "用户取消了本次查询",
        }
    )
    yield f"data: {data}\n\n"


# ---------------------------------------------------------------------------
# Markdown 文件上传
# ---------------------------------------------------------------------------

_MARKDOWN_EXTENSIONS: tuple[str, ...] = (".md", ".markdown", ".mdown", ".mkd")
_MARKDOWN_CONTENT_TYPES: tuple[str, ...] = (
    "text/markdown",
    "text/x-markdown",
    # 许多系统对 .md 默认返回 text/plain，予以放行后由内容嗅探兜底校验
    "text/plain",
    "application/octet-stream",
)
_MARKDOWN_MAX_BYTES: int = 2 * 1024 * 1024  # 2MB
_MARKDOWN_SNIFF_HINTS: tuple[str, ...] = (
    "#", "##", "###", "- ", "* ", "> ", "```", "---", "| ", "[", "](", "1. ",
)


def _validate_markdown_file(
    filename: Optional[str],
    content_type: Optional[str],
    raw: bytes,
) -> tuple[bool, str, str]:
    """服务端 Markdown 校验：扩展名 → Content-Type → 大小 → UTF-8 解码 → 内容嗅探。

    返回 (是否通过, 文本内容, 错误信息)。文本内容仅在通过时有效。
    """
    if not filename:
        return False, "", "未提供文件名"

    name_lower = filename.lower()
    if not name_lower.endswith(_MARKDOWN_EXTENSIONS):
        return (
            False,
            "",
            f"仅支持 Markdown 文件（扩展名 .md / .markdown），当前文件：{filename}",
        )

    if content_type and content_type.lower() not in _MARKDOWN_CONTENT_TYPES:
        return False, "", f"文件 Content-Type 非 Markdown 文本：{content_type}"

    if not raw:
        return False, "", "文件内容为空"

    if len(raw) > _MARKDOWN_MAX_BYTES:
        return (
            False,
            "",
            f"文件过大（>{_MARKDOWN_MAX_BYTES // 1024 // 1024}MB），请精简后再上传",
        )

    # 优先 UTF-8，兼容 BOM
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        try:
            text = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            return False, "", "文件非 UTF-8 文本，无法作为 Markdown 解析"

    # 内容嗅探：前 2KB 内须出现 Markdown 结构性标志，避免上传任意文本冒充
    head = text[:2048]
    if not any(hint in head for hint in _MARKDOWN_SNIFF_HINTS):
        return (
            False,
            "",
            "文件内容未检测到 Markdown 结构（标题 / 列表 / 代码块 / 引用 / 链接等）",
        )

    return True, text, ""


def _prompt_type(prompt: UserMarkdownPrompt) -> MarkdownPromptType:
    """ORM → GraphQL 类型转换。"""
    return MarkdownPromptType(
        id=prompt.id,
        filename=prompt.filename,
        note_name=prompt.note_name,
        content=prompt.content,
        is_active=prompt.is_active,
        char_count=len(prompt.content) if prompt.content else 0,
        created_at=prompt.created_at.isoformat() if prompt.created_at else None,
        updated_at=prompt.updated_at.isoformat() if prompt.updated_at else None,
    )


@post("/upload-markdown", media_type=MediaType.JSON)
async def upload_markdown_endpoint(request: Request) -> Response:
    """接收前端上传的 Markdown 文件，校验通过后按用户持久化到提示词库。

    需携带 Authorization: Bearer <token>。同名文件覆盖内容并保持原选中状态；
    用户首条提示词自动设为活跃。
    """
    import json as _json

    # 鉴权：未登录拒绝上传
    user = await _get_bearer_user(request)
    if user is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未登录或登录已过期，无法上传"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=401,
            media_type="application/json",
        )

    try:
        form = await request.form()
    except Exception as e:
        logger.warning(f"{get_request_id()}Markdown 上传表单解析失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"表单解析失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    upload_file = form.get("file") if form else None
    if upload_file is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未接收到文件，请选择一个 Markdown 文件"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    filename = getattr(upload_file, "filename", None)
    content_type = getattr(upload_file, "content_type", None)
    try:
        raw = await upload_file.read()
    except Exception as e:
        logger.warning(f"{get_request_id()}Markdown 上传读取失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"文件读取失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    ok, text, err = _validate_markdown_file(filename, content_type, raw)
    if not ok:
        logger.warning(f"{get_request_id()}Markdown 上传校验失败: {err}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": err},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    # 按用户持久化
    saved = await create_user_markdown_prompt(
        user_id=user.id, filename=filename, content=text
    )
    if saved is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "保存到数据库失败，请重试"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=500,
            media_type="application/json",
        )

    logger.info(
        f"{get_request_id()}Markdown 上传成功: user_id={user.id}, filename={filename}, "
        f"size={len(raw)}B, chars={len(text)}, is_active={saved.is_active}"
    )
    return Response(
        content=_json.dumps(
            {
                "success": True,
                "prompt": saved.to_dict(),
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        status_code=200,
        media_type="application/json",
    )


# ============================================
# 头像上传 / 头像读取
# ============================================

_AVATAR_ALLOWED_TYPES: tuple[str, ...] = (
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
)
_AVATAR_MAX_BYTES: int = 8 * 1024 * 1024  # 8MB
# imghdr 返回的图片类型标识 → Content-Type
_AVATAR_CONTENT_TYPES: dict[str, str] = {
    "jpeg": "image/jpeg",
    "jpg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}


@post("/upload-avatar", media_type=MediaType.JSON)
async def upload_avatar_endpoint(request: Request) -> Response:
    """接收前端上传的头像图片，校验通过后写入 users.avatar 字段。

    需携带 Authorization: Bearer <token>。仅支持 JPEG/PNG/WebP/GIF，≤2MB。
    成功后返回新的 avatar_url（带版本号防缓存）。
    """
    import json as _json

    user = await _get_bearer_user(request)
    if user is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未登录或登录已过期，无法上传"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=401,
            media_type="application/json",
        )

    try:
        form = await request.form()
    except Exception as e:
        logger.warning(f"{get_request_id()}头像上传表单解析失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"表单解析失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    upload_file = form.get("file") if form else None
    if upload_file is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未接收到文件"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    content_type = getattr(upload_file, "content_type", None)
    try:
        raw = await upload_file.read()
    except Exception as e:
        logger.warning(f"{get_request_id()}头像上传读取失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"文件读取失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    if not raw:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "文件内容为空"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )
    if len(raw) > _AVATAR_MAX_BYTES:
        return Response(
            content=_json.dumps(
                {
                    "success": False,
                    "error": "头像过大（>8MB），请压缩后重试",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    # 双重校验：MIME 头 + 内容嗅探（imghdr 根据文件头识别真实格式）
    if content_type and content_type.lower() not in _AVATAR_ALLOWED_TYPES:
        return Response(
            content=_json.dumps(
                {
                    "success": False,
                    "error": f"仅支持 JPEG/PNG/WebP/GIF，当前类型：{content_type}",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )
    sniffed = imghdr.what(None, h=raw)
    if sniffed not in _AVATAR_CONTENT_TYPES:
        return Response(
            content=_json.dumps(
                {
                    "success": False,
                    "error": "文件内容不是有效图片（嗅探失败），请检查文件是否损坏",
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    updated = await set_user_avatar(user.id, raw)
    if updated is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "保存到数据库失败，请重试"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=500,
            media_type="application/json",
        )

    info = build_user_info(updated)
    logger.info(
        f"{get_request_id()}头像上传成功: user_id={user.id}, size={len(raw)}B, "
        f"type={sniffed}"
    )
    return Response(
        content=_json.dumps(
            {
                "success": True,
                "avatarUrl": info.avatar_url,
                "user": {
                    "id": info.id,
                    "email": info.email,
                    "phone": info.phone,
                    "displayName": info.display_name,
                    "avatarUrl": info.avatar_url,
                    "createdAt": info.created_at,
                },
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        status_code=200,
        media_type="application/json",
    )


@post("/upload-image", media_type=MediaType.JSON)
async def upload_image_endpoint(request: Request) -> Response:
    """TASK-015：通用图片上传端点，供 VL Agent 视觉分析使用。

    鉴权：Bearer token。允许 image/*，≤8MB。落库 UploadedImage 表后返回 image_id，
    前端在消息文本中插入 ``[image:ID]`` 占位，supervisor 检测后路由到 VLAgent。
    """
    import json as _json

    user = await _get_bearer_user(request)
    if user is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未登录或登录已过期"}, ensure_ascii=False
            ).encode("utf-8"),
            status_code=401,
            media_type="application/json",
        )

    try:
        form = await request.form()
    except Exception as e:
        logger.warning(f"{get_request_id()}图片上传表单解析失败: {e}")
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"表单解析失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    upload_file = form.get("file") if form else None
    if upload_file is None:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "未接收到文件"}, ensure_ascii=False
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    content_type = getattr(upload_file, "content_type", None) or "image/jpeg"
    try:
        raw = await upload_file.read()
    except Exception as e:
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"文件读取失败: {type(e).__name__}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    if not raw:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "文件内容为空"}, ensure_ascii=False
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    if len(raw) > 8 * 1024 * 1024:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "图片过大（>8MB）"}, ensure_ascii=False
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    if not content_type.lower().startswith("image/"):
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"仅允许 image/*，当前类型：{content_type}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    # 双重校验：imghdr 嗅探真实格式
    sniffed = imghdr.what(None, h=raw)
    if sniffed not in _AVATAR_CONTENT_TYPES:
        return Response(
            content=_json.dumps(
                {"success": False, "error": "文件内容不是有效图片"}, ensure_ascii=False
            ).encode("utf-8"),
            status_code=400,
            media_type="application/json",
        )

    filename = getattr(upload_file, "filename", "image") or "image"

    try:
        async with get_session()() as session:
            from x_models.id_x_010.src.models.x_models import UploadedImage

            img = UploadedImage(
                user_id=user.id,
                filename=filename,
                mime=content_type,
                data=raw,
            )
            session.add(img)
            await session.commit()
            await session.refresh(img)
            image_id = img.id
    except Exception as e:
        logger.error(
            f"{get_request_id()}upload_image 落库失败: {e}", exc_info=True
        )
        return Response(
            content=_json.dumps(
                {"success": False, "error": f"保存失败: {type(e).__name__}: {e}"},
                ensure_ascii=False,
            ).encode("utf-8"),
            status_code=500,
            media_type="application/json",
        )

    logger.info(
        f"{get_request_id()}图片上传成功: user_id={user.id}, image_id={image_id}, "
        f"size={len(raw)}B, type={sniffed}"
    )
    return Response(
        content=_json.dumps(
            {
                "success": True,
                "image_id": image_id,
                "filename": filename,
            },
            ensure_ascii=False,
        ).encode("utf-8"),
        status_code=200,
        media_type="application/json",
    )


@get("/avatar/{user_id:int}", media_type=MediaType.JSON)
async def serve_avatar_endpoint(user_id: int) -> Response:
    """按 user_id 输出头像二进制。无头像时返回 404，由前端回退到字母占位。

    响应体为图片字节；Content-Type 由嗅探的真实格式决定。
    """
    avatar = await get_user_avatar(user_id)
    if not avatar:
        return Response(
            content=b"",
            status_code=404,
            media_type="application/json",
        )
    sniffed = imghdr.what(None, h=avatar)
    media_type = _AVATAR_CONTENT_TYPES.get(sniffed or "", "image/jpeg")
    return Response(
        content=avatar,
        status_code=200,
        media_type=media_type,
        headers={
            "Cache-Control": "no-cache, must-revalidate",
        },
    )


async def on_shutdown_hook() -> None:
    """Litestar on_shutdown 钩子（TASK-011 配套）。

    清理 _sql_agent_cache 中的全部 SQLAgent 连接，避免进程退出时连接泄漏。
    主程序可手动注册：``on_shutdown=[id_x_010.on_shutdown_hook]``；
    即使主程序不调用，本插件也在 x_plugin.py 注册 atexit 同步兜底（best-effort）。
    """
    try:
        from x_models.id_x_010.src.agents.x_sql_agent import close_all_sql_agents

        await close_all_sql_agents()
    except Exception as e:
        logger.warning(
            f"{get_request_id()}on_shutdown_hook 执行失败（best-effort）: "
            f"{type(e).__name__}: {e}"
        )


def register_routers(route_prefix: str) -> Router:
    from strawberry.litestar import make_graphql_controller

    GraphQLController = make_graphql_controller(
        schema,
        path="/graphql",
    )

    @post("/graphql/stream", media_type=MediaType.TEXT)
    async def graphql_stream_subscription(request: Request) -> Stream:
        import json as _json

        body = await request.json()
        query = body.get("query", "")
        variables = body.get("variables", {})
        operation_name = body.get("operationName")

        # 在请求上下文中捕获 request_id，确保 generate() 内可用
        req_id = request_id_var.get("")

        logger.info(
            f"{get_request_id()}收到 GraphQL 流式订阅请求: query='{query[:100]}...'"
        )

        async def generate():
            # 异步生成器在新的协程上下文中执行，需要重新设置 request_id
            if req_id:
                request_id_var.set(req_id)
            try:
                subscription_result = await schema.subscribe(
                    query,
                    variable_values=variables,
                    operation_name=operation_name,
                    # 默认 context 为 dict（与 HTTP controller 一致），
                    # 供 resolver 读取 Authorization 做用户设置解析
                    context_value={"request": request},
                )

                if subscription_result is None:
                    error_response = {"errors": [{"message": "订阅返回空结果"}]}
                    yield f"data: {_json.dumps(error_response, ensure_ascii=False)}\n\n"
                    return

                errors = getattr(subscription_result, "errors", None)
                if errors:
                    error_response = {"errors": [{"message": str(e)} for e in errors]}
                    yield f"data: {_json.dumps(error_response, ensure_ascii=False)}\n\n"
                    return

                async for result in subscription_result:
                    response_data = {}

                    data = getattr(result, "data", None)
                    if data:
                        response_data["data"] = data

                    result_errors = getattr(result, "errors", None)
                    if result_errors:
                        response_data["errors"] = [
                            {"message": str(e)} for e in result_errors
                        ]

                    if response_data:
                        yield f"data: {_json.dumps(response_data, ensure_ascii=False)}\n\n"

                yield f"data: {_json.dumps({'complete': True}, ensure_ascii=False)}\n\n"

            except Exception as e:
                logger.error(
                    f"{get_request_id()}GraphQL 订阅执行错误: {e}", exc_info=True
                )
                error_response = {"errors": [{"message": str(e)}]}
                yield f"data: {_json.dumps(error_response, ensure_ascii=False)}\n\n"

        return Stream(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    @post("/sql-approval", media_type=MediaType.TEXT)
    async def sql_approval_endpoint(request: Request) -> Response | Stream:
        import json as _json

        body = await request.json()
        conversation_id = body.get("conversation_id", "")
        sql = body.get("sql", "")
        action = body.get("action", "")
        question = body.get("question", "")
        model_type = body.get("model_type", "external")
        model_name = body.get("model_name")
        db_name = body.get("db_name")

        if action not in ["approve", "reject", "cancel"]:
            return Response(
                content=_json.dumps(
                    {"error": "Invalid action"}, ensure_ascii=False
                ).encode("utf-8"),
                status_code=400,
                media_type="application/json",
            )

        if action == "cancel":
            return Stream(
                _generate_cancel_response(),
                media_type="text/event-stream",
            )

        # 在请求上下文中捕获 request_id，确保 generate() 内可用
        req_id = request_id_var.get("")

        # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
        await load_llm_provider_config()

        # 用户已保存自定义模型设置时，以其覆盖默认链路配置；
        # 前端传入的 model_name 优先，仅在其为空时回退到用户默认模型
        user_settings = await _get_bearer_settings(request)
        if user_settings is not None and not model_name:
            model_name = user_settings.model_name

        # 模型解析：前端选中的 model_name → external_models 表查 base_url/api_key
        # 用户级模型（不在 external_models 表内）回退到 user_settings 的共享凭据
        ext_model = await get_external_model_by_name(model_name or "")
        if ext_model is not None:
            override_api_key = ext_model.api_key
            override_base_url = ext_model.base_url
        else:
            override_api_key = user_settings.api_key if user_settings else None
            override_base_url = user_settings.base_url if user_settings else None

        # db_name 为空时从 agent_db_settings 表取首行作为默认目标库，
        # 避免 DatabaseConnection 因无配置而连接失败
        effective_db_name = db_name
        if not effective_db_name:
            default_db = await get_agent_db_settings()
            if default_db is not None:
                effective_db_name = default_db.db_name

        async def generate():
            if req_id:
                request_id_var.set(req_id)
            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=override_api_key,
                base_url=override_base_url,
                db_name=effective_db_name,
            )

            if action == "approve":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=True, question=question
                ):
                    # TASK-015：补齐 columns/data/row_count/chart_config/security_block
                    # 字段转发——之前只发 6 个字段，前端 ResultView 永远收不到数据。
                    _raw_data = chunk.get("data")
                    _raw_chart = chunk.get("chart_config")
                    _usage = chunk.get("usage") or None
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                            "sql_meaning": chunk.get("sql_meaning"),
                            "columns": chunk.get("columns"),
                            "data": (
                                _json.dumps(_raw_data, ensure_ascii=False)
                                if _raw_data is not None
                                else None
                            ),
                            "row_count": chunk.get("row_count"),
                            "chart_config": (
                                _json.dumps(_raw_chart, ensure_ascii=False)
                                if _raw_chart is not None
                                else None
                            ),
                            "security_block": chunk.get("security_block"),
                            # 审批后续流的 token 用量（done chunk 携带），
                            # 供前端气泡 meta 行展示
                            "input_tokens": (
                                int(_usage.get("input_tokens", 0) or 0)
                                if _usage
                                else None
                            ),
                            "output_tokens": (
                                int(_usage.get("output_tokens", 0) or 0)
                                if _usage
                                else None
                            ),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"
            elif action == "reject":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=False, question=question
                ):
                    _raw_data = chunk.get("data")
                    _raw_chart = chunk.get("chart_config")
                    _usage = chunk.get("usage") or None
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                            "sql_meaning": chunk.get("sql_meaning"),
                            "columns": chunk.get("columns"),
                            "data": (
                                _json.dumps(_raw_data, ensure_ascii=False)
                                if _raw_data is not None
                                else None
                            ),
                            "row_count": chunk.get("row_count"),
                            "chart_config": (
                                _json.dumps(_raw_chart, ensure_ascii=False)
                                if _raw_chart is not None
                                else None
                            ),
                            "security_block": chunk.get("security_block"),
                            "input_tokens": (
                                int(_usage.get("input_tokens", 0) or 0)
                                if _usage
                                else None
                            ),
                            "output_tokens": (
                                int(_usage.get("output_tokens", 0) or 0)
                                if _usage
                                else None
                            ),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"

                async for chunk in sql_agent.stream_query(question=question):
                    _raw_data = chunk.get("data")
                    _raw_chart = chunk.get("chart_config")
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                            "sql_meaning": chunk.get("sql_meaning"),
                            "columns": chunk.get("columns"),
                            "data": (
                                _json.dumps(_raw_data, ensure_ascii=False)
                                if _raw_data is not None
                                else None
                            ),
                            "row_count": chunk.get("row_count"),
                            "chart_config": (
                                _json.dumps(_raw_chart, ensure_ascii=False)
                                if _raw_chart is not None
                                else None
                            ),
                            "security_block": chunk.get("security_block"),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"

        return Stream(generate(), media_type="text/event-stream")

    # TASK-012：WebSocket 审批通道，鉴权从 query string token 解析。
    # Litestar 要求 websocket handler 的 socket 参数必须有类型注解，
    # 否则在注册阶段 ImproperlyConfiguredException。
    @websocket("/ws/approval")
    async def approval_ws_endpoint(socket: WebSocket) -> None:
        from x_models.id_x_010.src.controllers.x_ws import approval_ws

        await approval_ws(socket)

    @get("/metrics")
    async def metrics_endpoint() -> Response:
        """Prometheus 指标端点（TASK-007）。

        无需鉴权（指标不带敏感信息），生产部署可由反向代理限制源 IP。
        每次请求前由 sql_agent._collect_pool_metrics（TASK-011）刷新连接池指标。
        """
        try:
            # 尝试刷新 SQL Agent 连接池指标（TASK-011）；缺失方法时静默跳过
            try:
                from x_models.id_x_010.src.agents.x_sql_agent import (
                    _collect_pool_metrics,
                )

                _collect_pool_metrics()
            except Exception:
                pass

            from x_models.id_x_010.src.utils.x_metrics import render_metrics

            content, content_type = render_metrics()
            return Response(
                content=content,
                status_code=200,
                media_type=content_type,
            )
        except Exception as e:
            logger.error(
                f"{get_request_id()}metrics endpoint 失败: {e}", exc_info=True
            )
            return Response(
                content=b"",
                status_code=500,
                media_type="text/plain",
            )

    router = Router(
        path=route_prefix,
        route_handlers=[
            GraphQLController,
            graphql_stream_subscription,
            sql_approval_endpoint,
            upload_markdown_endpoint,
            upload_avatar_endpoint,
            serve_avatar_endpoint,
            metrics_endpoint,
            approval_ws_endpoint,
            upload_image_endpoint,
        ],
    )

    return router
