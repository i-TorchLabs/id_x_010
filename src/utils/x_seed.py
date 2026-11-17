"""预置数据幂等播种（外部第三方 PostgreSQL 部署模式）。

背景：连接外部第三方 PostgreSQL 后（对齐 id_x_007 的部署模式），不再有
db 容器的 docker-entrypoint-initdb.d 自动执行 ops/init/*.sql，全部预置
数据改由本模块在 ``x_plugin.build_tables`` 建表后幂等播种：

- 表无数据才插入（``WHERE NOT EXISTS`` / ``ON CONFLICT DO NOTHING``），
  不覆盖运维已手工维护的行，重复启动安全；
- 内容与 ops/init/02_external.sql ~ 09_admin.sql 一一对应，init SQL
  仅保留作手动初始化 / 审阅参考；
- 失败不阻塞启动（由 x_plugin 的调用方包裹 warn 日志）。
"""

import os
from typing import Dict

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# ==========================================
# 种子数据（与 ops/init/*.sql 保持同步）
# ==========================================

# init/02_external.sql：外部模型提供商（LLM_PROVIDER=external 时生效，取 id 最小行）
_EXTERNAL_PROVIDER_SEED: Dict[str, str] = {
    "api_key": "sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K",
    "llm_base_url": "https://apihk.chinarouter.net/v1",
    "embd_base_url": "https://apihk.chinarouter.net/v1",
    "vl_base_url": "https://apihk.chinarouter.net/v1",
}

# init/03_local.sql：本地 Ollama 提供商（LLM_PROVIDER=local 时生效，取 id 最小行）
_LOCAL_PROVIDER_SEED: Dict[str, str] = {
    "api_key": "ollama",
    "llm_base_url": "http://host.containers.internal:11434",
    "embd_base_url": "http://host.containers.internal:11434",
    "vl_base_url": "http://host.containers.internal:11434",
}

# init/04_agent.sql：SQL Agent 目标库（每行一个可选数据库，共用接入凭据）
_AGENT_DB_USERNAME = "i"
_AGENT_DB_PASSWORD = "P@ssmickey233!"
_AGENT_DB_SEED: tuple[tuple[str, str, str, int], ...] = (
    # (db_name, db_label, db_host, db_port)
    ("hengsheng_base", "样例库", "47.115.150.95", 15432),
    ("ex_biaopu_target", "标普数据库", "10.20.217.87", 15432),
    ("ex_factset", "FactSet数据库", "10.20.217.87", 15432),
    ("ex_rating_express", "RatingExpress数据库", "10.20.217.87", 15432),
)

# init/05_models.sql：系统预置模型（管理员维护，用户只读；均经同一网关接入）
_GATEWAY_BASE_URL = "https://apihk.chinarouter.net/v1"
_SYSTEM_MODEL_SEED: tuple[tuple[str, str], ...] = (
    # (name, provider)
    ("claude-fable-5", "Anthropic"),
    ("claude-opus-5", "Anthropic"),
    ("claude-opus-5-5", "Anthropic"),
    ("claude-sonnet-5", "Anthropic"),
    ("claude-sonnet-5-5", "Anthropic"),
    ("gpt-5.5", "OpenAI"),
    ("gpt-5.6-sol", "OpenAI"),
    ("gpt-5.6-terra", "OpenAI"),
    ("gpt-6-astra", "OpenAI"),
    ("gpt-6-sol", "OpenAI"),
    ("glm-5.3", "GLM"),
    ("deepseek-v4-flash-0731", "DeepSeek"),
    ("deepseek-v4-pro-0813", "DeepSeek"),
    ("deepseek-v4.1-flash", "DeepSeek"),
    ("deepseek-v4.1-flash-1017", "DeepSeek"),
    ("qwen3.8-flash", "Qwen"),
    ("qwen3.8-max", "Qwen"),
)

# init/07_oauth.sql：CUHK ADFS SSO 单点登录（取 id 最小行生效）
_SSO_SEED: Dict[str, str] = {
    "client_id": "373d4823-7c0b-4375-a16c-e902f979ee34",
    "client_secret": "xKczBbxvKZ2kELoUiuEfkLPkmYF2yN2V0jAHpgD0",
    "redirect_uri": "https://sme-tx-studio.cuhk.edu.cn/f/010/oauth2",
}


async def seed_reference_data(conn: AsyncConnection) -> None:
    """幂等播种预置参考数据（提供商 / 目标库 / 系统模型 / SSO）。

    与 init/02~07 的 ``WHERE NOT EXISTS`` 语义一致：表无数据才插入，
    运维直接改表维护的配置不会被覆盖。
    """
    await conn.execute(
        text(
            "INSERT INTO external_provider (api_key, llm_base_url, embd_base_url, vl_base_url) "
            "SELECT :api_key, :llm_base_url, :embd_base_url, :vl_base_url "
            "WHERE NOT EXISTS (SELECT 1 FROM external_provider)"
        ),
        _EXTERNAL_PROVIDER_SEED,
    )
    await conn.execute(
        text(
            "INSERT INTO local_provider (api_key, llm_base_url, embd_base_url, vl_base_url) "
            "SELECT :api_key, :llm_base_url, :embd_base_url, :vl_base_url "
            "WHERE NOT EXISTS (SELECT 1 FROM local_provider)"
        ),
        _LOCAL_PROVIDER_SEED,
    )
    for db_name, db_label, db_host, db_port in _AGENT_DB_SEED:
        await conn.execute(
            text(
                "INSERT INTO agent_db_settings "
                "(db_name, db_label, db_host, db_port, db_username, db_password) "
                "VALUES (:db_name, :db_label, :db_host, :db_port, :db_username, :db_password) "
                "ON CONFLICT (db_name) DO NOTHING"
            ),
            {
                "db_name": db_name,
                "db_label": db_label,
                "db_host": db_host,
                "db_port": db_port,
                "db_username": _AGENT_DB_USERNAME,
                "db_password": _AGENT_DB_PASSWORD,
            },
        )
    for name, provider in _SYSTEM_MODEL_SEED:
        await conn.execute(
            text(
                "INSERT INTO system_model_settings "
                "(name, provider, base_url, model_type, is_default, enabled, sort_order) "
                "VALUES (:name, :provider, :base_url, 'external', TRUE, TRUE, 1) "
                "ON CONFLICT (name) DO NOTHING"
            ),
            {"name": name, "provider": provider, "base_url": _GATEWAY_BASE_URL},
        )
    await conn.execute(
        text(
            "INSERT INTO sso_settings (client_id, client_secret, redirect_uri) "
            "SELECT :client_id, :client_secret, :redirect_uri "
            "WHERE NOT EXISTS (SELECT 1 FROM sso_settings)"
        ),
        _SSO_SEED,
    )


async def seed_initial_admin(conn: AsyncConnection) -> None:
    """幂等播种初始管理员（取代 init/09_admin.sql 的 pgcrypto crypt() 方案）。

    - 账号：环境变量 ADMIN_EMAIL（默认 sme@cuhk.edu.cn）；
      口令：ADMIN_PASSWORD（默认 P@sssme!）；
    - 哈希走 Python bcrypt（rounds=12），与 controllers.hash_password /
      verify_password 的 bcrypt 分支对齐，不依赖数据库 pgcrypto 扩展
      （外部第三方库未必可用 superuser 建扩展）；
    - 目标邮箱已存在则跳过，不覆盖已修改的密码 / 角色。
    """
    import bcrypt

    email = (os.getenv("ADMIN_EMAIL", "") or "").strip() or "sme@cuhk.edu.cn"
    password = os.getenv("ADMIN_PASSWORD", "") or "P@sssme!"
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    existing = await conn.execute(
        text("SELECT 1 FROM users WHERE email = :email LIMIT 1"),
        {"email": email},
    )
    if existing.scalar() is not None:
        return  # 目标邮箱已存在：不覆盖已修改的密码 / 角色
    await conn.execute(
        text(
            "INSERT INTO users "
            "(email, password_hash, password_algo, display_name, is_active, is_admin, role) "
            "VALUES (:email, :pw_hash, 'bcrypt', '管理员', TRUE, TRUE, 'admin')"
        ),
        {"email": email, "pw_hash": pw_hash},
    )
