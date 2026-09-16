import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta
from typing import AsyncGenerator, List, Optional

import strawberry
from litestar import MediaType, Request, Response, Router, post
from litestar.response import Stream
from sqlalchemy import select

from utils.log_util import get_request_id, logger, request_id_var
from x_models.id_x_010.src.agents.x_langgraph_supervisor import (
    LangGraphSupervisor,
    get_orchestrator,
)
from x_models.id_x_010.src.agents.x_sql_agent import SQLAgent
from x_models.id_x_010.src.models.x_models import (
    ExternalModel,
    LocalModel,
    PasswordResetToken,
    User,
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
    ForgotPasswordInput,
    ForgotPasswordResponseType,
    HealthType,
    LoginInput,
    ModelListResponseType,
    ModelSettingsInput,
    ModelSettingsResponseType,
    ModelSettingsType,
    ModelType,
    OauthInput,
    RegisterInput,
    StreamChunkType,
    UserInfoType,
)
from x_models.id_x_010.src.views.x_views import (
    get_conversation_history,
    get_user_model_settings,
    list_agent_db_settings,
    load_llm_provider_config,
    merge_context,
    save_conversation_log,
    test_model_connectivity,
    upsert_user_model_settings,
    view_sso_login,
)


@strawberry.type
class Query:
    @strawberry.field(description="健康检查")
    async def health(self) -> HealthType:
        return HealthType(status="ok", service="id_x_010")

    @strawberry.field(description="获取模型列表")
    async def get_models(self) -> ModelListResponseType:
        try:
            models = []

            async with get_session()() as session:
                external_result = await session.execute(select(ExternalModel))
                external_models = external_result.scalars().all()

                for model in external_models:
                    models.append(
                        ModelType(
                            id=model.id,
                            name=model.name,
                            provider=model.provider,
                            base_url=model.base_url,
                            model_type="external",
                        )
                    )

                local_result = await session.execute(select(LocalModel))
                local_models = local_result.scalars().all()

                for model in local_models:
                    models.append(
                        ModelType(
                            id=model.id,
                            name=model.name,
                            provider=model.provider,
                            base_url=model.base_url,
                            model_type="local",
                        )
                    )

            if not models:
                logger.warning(
                    f"{get_request_id()}数据库模型表为空，尝试从环境变量回退获取模型列表"
                )
                return Query._fallback_models()

            logger.info(
                f"{get_request_id()}成功获取模型列表: {len(external_models)} 个外部模型, "
                f"{len(local_models)} 个本地模型"
            )

            return ModelListResponseType(
                success=True,
                message=f"成功获取 {len(models)} 个模型",
                models=models,
            )

        except Exception as e:
            logger.error(f"{get_request_id()}获取模型列表失败: {e}", exc_info=True)
            # 数据库查询失败时，尝试环境变量回退
            return Query._fallback_models(str(e))

    @staticmethod
    def _fallback_models(error_msg: str = "") -> ModelListResponseType:
        """当数据库不可用时，从环境变量回退获取模型列表。"""
        import os as _os

        models = []
        base_url = _os.getenv("EXTERNAL_BASE_URL", "")
        if base_url:
            models.append(
                ModelType(
                    id=-1,
                    name="external-default",
                    provider="external",
                    base_url=base_url,
                    model_type="external",
                )
            )

        local_base_url = _os.getenv("LOCAL_MODEL_BASE_URL", "")
        if local_base_url:
            models.append(
                ModelType(
                    id=-2,
                    name="local-default",
                    provider="local",
                    base_url=local_base_url,
                    model_type="local",
                )
            )

        source = (
            f"（回退模式{f': {error_msg}' if error_msg else ''}）"
            if error_msg or not any([_os.getenv("EXTERNAL_BASE_URL")])
            else ""
        )
        message = f"回退获取 {len(models)} 个模型" if models else "无可用模型"
        if source:
            message += source

        return ModelListResponseType(
            success=len(models) > 0,
            message=message,
            models=models,
        )

    @strawberry.field(description="获取数据库列表")
    async def get_databases(self) -> "DatabaseListResponseType":
        try:
            db_items = []

            # 优先从 agent_db_settings 表读取可用数据库
            agent_db_rows = await list_agent_db_settings()
            if agent_db_rows:
                db_items = [
                    DatabaseInfoType(
                        key=row.db_name, label=row.db_label or row.db_name
                    )
                    for row in agent_db_rows
                ]
            else:
                # 表无数据时回退环境变量 AGENT_DB_LIST（JSON 映射或逗号分隔）
                # JSON 格式：{"显示名": "真实库名"}，前端渲染显示名（label），
                # 后端按真实库名（key）匹配 agent_db_settings 并建连
                db_list_str = os.getenv("AGENT_DB_LIST", "")
                if db_list_str:
                    try:
                        db_dict = json.loads(db_list_str)
                        db_items = [
                            DatabaseInfoType(key=v, label=k) for k, v in db_dict.items()
                        ]
                    except (json.JSONDecodeError, AttributeError):
                        # 兼容旧格式：逗号分隔的纯名称列表
                        db_items = [
                            DatabaseInfoType(key=name.strip(), label=name.strip())
                            for name in db_list_str.split(",")
                            if name.strip()
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


async def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


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


async def _get_bearer_settings(request) -> Optional[UserModelSettings]:
    """解析请求属主用户并返回其模型设置；未登录或未配置时返回 None。"""
    user = await _get_bearer_user(request)
    if user is None:
        return None
    return await get_user_model_settings(user.id)


def _settings_type(settings: UserModelSettings) -> ModelSettingsType:
    return ModelSettingsType(
        provider=settings.provider,
        base_url=settings.base_url,
        api_key=settings.api_key,
        model_name=settings.model_name,
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
                f"api_key={api_key}"
            )

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
            request = _get_info_request(info)
            user_settings = await _get_bearer_settings(request)

            if user_settings is not None:
                orchestrator = LangGraphSupervisor(
                    model_type=input.model_type,
                    model_name=user_settings.model_name,
                    api_key=user_settings.api_key,
                    base_url=user_settings.base_url,
                )
                chat_api_key = user_settings.api_key
                chat_base_url = user_settings.base_url
                chat_model_name = user_settings.model_name
            else:
                orchestrator = get_orchestrator()
                chat_api_key = None
                chat_base_url = None
                chat_model_name = input.model_name

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
            async with get_session()() as session:
                result = await session.execute(
                    select(User).where(User.email == input.email)
                )
                user = result.scalar_one_or_none()

                if user is None:
                    return AuthResponseType(success=False, message="用户不存在")

                password_hash = await hash_password(input.password)
                if user.password_hash != password_hash:
                    return AuthResponseType(success=False, message="密码错误")

                if user.is_active is False:
                    return AuthResponseType(success=False, message="用户尚未激活")

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

                return AuthResponseType(
                    success=True,
                    message="登录成功",
                    token=token,
                    expires_at=expires_at.isoformat(),
                    user=UserInfoType(
                        id=user.id,
                        email=user.email,
                        phone=user.phone,
                        created_at=user.created_at.isoformat()
                        if user.created_at
                        else None,
                    ),
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
                )
                session.add(new_user)
                await session.commit()
                await session.refresh(new_user)

                return AuthResponseType(
                    success=True,
                    message="注册成功，请等待管理员激活账户",
                    token=None,
                    user=UserInfoType(
                        id=new_user.id,
                        email=new_user.email,
                        phone=new_user.phone,
                        created_at=new_user.created_at.isoformat()
                        if new_user.created_at
                        else None,
                    ),
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
                yield StreamChunkType(
                    type="sql_cancelled",
                    content="用户取消了本次查询",
                )
                return

            # 按 LLM_PROVIDER 加载提供商表配置（external_provider / local_provider）
            await load_llm_provider_config()

            # 用户已保存自定义模型设置时，以其覆盖默认链路配置
            user_settings = await _get_bearer_settings(_get_info_request(info))
            if user_settings is not None:
                model_name = user_settings.model_name

            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=user_settings.api_key if user_settings else None,
                base_url=user_settings.base_url if user_settings else None,
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
                    )

                if last_chunk_type == "sql_rejected":
                    async for chunk2 in sql_agent.stream_query(question=question):
                        yield StreamChunkType(
                            type=chunk2.get("type", ""),
                            content=chunk2.get("content"),
                            model_used=chunk2.get("model_used"),
                            conversation_id=conversation_id,
                            sql=chunk2.get("sql"),
                        )
        except Exception as e:
            logger.error(f"{get_request_id()}SQL审批接口错误: {e}", exc_info=True)
            yield StreamChunkType(
                type="error",
                content=f"审批处理失败: {str(e)}",
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

            if not all([provider, base_url, api_key, model_name]):
                return ModelSettingsResponseType(
                    success=False,
                    message="模型厂商、访问地址、API-KEY、模型名称均为必填项",
                    settings=None,
                )

            logger.info(
                f"{get_request_id()}收到模型设置保存请求，开始连通性检测: "
                f"user_id={user.id}, provider={provider}, "
                f"model={model_name}, base_url={base_url}"
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

    @strawberry.mutation(description="用户登出")
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
    ) -> AsyncGenerator[StreamChunkType, None]:
        try:
            logger.info(
                f"{get_request_id()}收到流式聊天请求: query='{query[:50]}.../', model_type={model_type}, "
                f"agent_type={agent_type}"
            )

            frontend_context = None
            if context:
                try:
                    frontend_context = [
                        json.loads(ctx) if isinstance(ctx, str) else ctx
                        for ctx in context
                    ]
                except json.JSONDecodeError:
                    frontend_context = None

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

            # 用户已保存自定义模型设置时，以其覆盖默认链路配置。
            # 注意不能复用 get_orchestrator() 的缓存实例：环境变量缺 key 时
            # 默认 supervisor 的 agent 构造会直接抛错，且配置与用户设置不符。
            request = _get_info_request(info)
            user_settings = await _get_bearer_settings(request)
            if user_settings is not None:
                model_name = user_settings.model_name
                override_api_key = user_settings.api_key
                override_base_url = user_settings.base_url
                logger.info(
                    f"{get_request_id()}使用用户自定义模型配置: "
                    f"model={model_name}, base_url={override_base_url}"
                )
                orchestrator = LangGraphSupervisor(
                    model_type=model_type,
                    model_name=model_name,
                    api_key=override_api_key,
                    base_url=override_base_url,
                )
            else:
                override_api_key = None
                override_base_url = None
                orchestrator = get_orchestrator()

            full_response = []
            thinking_buffer = []
            model_used = ""
            intent = ""

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
            ):
                chunk_type = StreamChunkType(
                    type=chunk.get("type", ""),
                    content=chunk.get("content"),
                    model_used=chunk.get("model_used"),
                    conversation_id=chunk.get("conversation_id"),
                    sql=chunk.get("sql"),
                )

                if chunk_type.type == "intent":
                    intent = chunk_type.content or ""
                elif chunk_type.type == "thinking":
                    thinking_buffer.append(chunk_type.content or "")
                elif chunk_type.type == "content":
                    full_response.append(chunk_type.content or "")
                    model_used = chunk_type.model_used or ""

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

        # 用户已保存自定义模型设置时，以其覆盖默认链路配置
        user_settings = await _get_bearer_settings(request)
        if user_settings is not None:
            model_name = user_settings.model_name

        async def generate():
            if req_id:
                request_id_var.set(req_id)
            sql_agent = SQLAgent(
                model_type=model_type,
                model_name=model_name,
                api_key=user_settings.api_key if user_settings else None,
                base_url=user_settings.base_url if user_settings else None,
                db_name=db_name,
            )

            if action == "approve":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=True, question=question
                ):
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"
            elif action == "reject":
                async for chunk in sql_agent.continue_with_approval(
                    sql=sql, approved=False, question=question
                ):
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                        }
                    )
                    yield f"data: {chunk_data}\n\n"

                async for chunk in sql_agent.stream_query(question=question):
                    chunk_data = _json.dumps(
                        {
                            "type": chunk.get("type", ""),
                            "content": chunk.get("content"),
                            "model_used": chunk.get("model_used"),
                            "conversation_id": conversation_id,
                            "sql": chunk.get("sql"),
                        }
                    )
                    yield f"data: {chunk_data}\n\n"

        return Stream(generate(), media_type="text/event-stream")

    router = Router(
        path=route_prefix,
        route_handlers=[
            GraphQLController,
            graphql_stream_subscription,
            sql_approval_endpoint,
        ],
    )

    return router
