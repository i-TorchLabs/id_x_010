-- PostgreSQL 初始化脚本
-- 创建数据库表
-- psql -h 127.0.0.1 -p 15432 -U postgres -d id_x_010 -f init.sql

-- 启用 pgvector 扩展：供 table_comments / document_chunks / sql_examples 等
-- 向量检索表的 embedding 列使用。镜像需为 pgvector/pgvector:pg<版本>。
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- 1. 用户表 (users)
-- 优先创建，因为其他表依赖此表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(128) NOT NULL UNIQUE,
    phone VARCHAR(20),
    password_hash VARCHAR(256) NOT NULL,
    display_name VARCHAR(64),
    avatar BYTEA,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 兼容已有库：仅当列缺失时追加（幂等）
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar BYTEA;
-- TASK-013：管理员标志位；旧库通过 ALTER 兼容，新库由 create_all 自动建
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN users.is_admin IS '是否管理员（控制 /admin 路由与 admin mutation 访问）';
-- TASK-019：密码哈希算法；老数据 null 视为 sha256，登录时自动升级为 bcrypt
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo VARCHAR(16) DEFAULT 'bcrypt';
COMMENT ON COLUMN users.password_algo IS '密码哈希算法：bcrypt / sha256（老数据）';

-- 用户表索引
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);
CREATE INDEX IF NOT EXISTS ix_users_phone ON users(phone);

-- 添加表注释
COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.id IS '用户ID';
COMMENT ON COLUMN users.email IS '邮箱';
COMMENT ON COLUMN users.phone IS '电话号码';
COMMENT ON COLUMN users.password_hash IS '密码哈希';
COMMENT ON COLUMN users.display_name IS '显示名称（可由用户自定义，空则回退到 email 本地名）';
COMMENT ON COLUMN users.avatar IS '头像图片二进制（BYTEA），通过 /avatar/<user_id> 端点按需输出';
COMMENT ON COLUMN users.is_active IS '是否激活';
COMMENT ON COLUMN users.created_at IS '创建时间';
COMMENT ON COLUMN users.updated_at IS '更新时间';

-- ============================================
-- 2. 对话日志表 (conversation_logs)
-- ============================================
CREATE TABLE IF NOT EXISTS conversation_logs (
    id SERIAL PRIMARY KEY,
    conversation_id VARCHAR(64),
    user_query TEXT NOT NULL,
    model_response TEXT,
    thinking_process TEXT,
    model_type VARCHAR(32),
    model_name VARCHAR(128),
    intent VARCHAR(64),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    extra_metadata JSON
);

-- 对话日志表索引
CREATE INDEX IF NOT EXISTS ix_conversation_logs_conversation_id ON conversation_logs(conversation_id);

-- 添加表注释
COMMENT ON TABLE conversation_logs IS '对话日志表';
COMMENT ON COLUMN conversation_logs.id IS 'ID';
COMMENT ON COLUMN conversation_logs.conversation_id IS '会话 ID';
COMMENT ON COLUMN conversation_logs.user_query IS '用户提问';
COMMENT ON COLUMN conversation_logs.model_response IS '模型回答';
COMMENT ON COLUMN conversation_logs.thinking_process IS '思考过程';
COMMENT ON COLUMN conversation_logs.model_type IS '模型类型: local 或 external';
COMMENT ON COLUMN conversation_logs.model_name IS '使用的模型名称';
COMMENT ON COLUMN conversation_logs.intent IS '识别的意图';
COMMENT ON COLUMN conversation_logs.created_at IS '创建时间';
COMMENT ON COLUMN conversation_logs.extra_metadata IS '元数据';

-- ============================================
-- 3. 用户令牌表 (user_tokens)
-- 依赖 users 表
-- ============================================
CREATE TABLE IF NOT EXISTS user_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 用户令牌表索引
CREATE INDEX IF NOT EXISTS ix_user_tokens_token ON user_tokens(token);
CREATE INDEX IF NOT EXISTS ix_user_tokens_user_id ON user_tokens(user_id);

-- 添加表注释
COMMENT ON TABLE user_tokens IS '用户令牌表';
COMMENT ON COLUMN user_tokens.id IS 'ID';
COMMENT ON COLUMN user_tokens.user_id IS '用户ID';
COMMENT ON COLUMN user_tokens.token IS '认证令牌';
COMMENT ON COLUMN user_tokens.expires_at IS '过期时间';
COMMENT ON COLUMN user_tokens.created_at IS '创建时间';

-- ============================================
-- 4. 密码重置令牌表 (password_reset_tokens)
-- 依赖 users 表
-- ============================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 密码重置令牌表索引
CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS ix_password_reset_tokens_user_id ON password_reset_tokens(user_id);

-- 添加表注释
COMMENT ON TABLE password_reset_tokens IS '密码重置令牌表';
COMMENT ON COLUMN password_reset_tokens.id IS 'ID';
COMMENT ON COLUMN password_reset_tokens.user_id IS '用户ID';
COMMENT ON COLUMN password_reset_tokens.token IS '重置令牌';
COMMENT ON COLUMN password_reset_tokens.expires_at IS '过期时间';
COMMENT ON COLUMN password_reset_tokens.used IS '是否已使用';
COMMENT ON COLUMN password_reset_tokens.created_at IS '创建时间';

-- ============================================
-- 5. 外部模型表 (external_models)
-- ============================================
CREATE TABLE IF NOT EXISTS external_models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    provider VARCHAR(128) NOT NULL,
    base_url VARCHAR(128) NOT NULL,
    api_key VARCHAR(128) NOT NULL
);

-- 外部模型表索引
CREATE INDEX IF NOT EXISTS ix_external_models_name ON external_models(name);
CREATE INDEX IF NOT EXISTS ix_external_models_provider ON external_models(provider);

-- 添加表注释
COMMENT ON TABLE external_models IS '外部模型表';
COMMENT ON COLUMN external_models.id IS 'ID';
COMMENT ON COLUMN external_models.name IS '模型名称';
COMMENT ON COLUMN external_models.provider IS '模型商';
COMMENT ON COLUMN external_models.base_url IS '访问地址';
COMMENT ON COLUMN external_models.api_key IS 'API-KEY';

-- ============================================
-- 6. 本地模型表 (local_models)
-- ============================================
CREATE TABLE IF NOT EXISTS local_models (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    provider VARCHAR(128) NOT NULL,
    base_url VARCHAR(128) NOT NULL,
    api_key VARCHAR(128) NOT NULL
);

-- 本地模型表索引
CREATE INDEX IF NOT EXISTS ix_local_models_name ON local_models(name);
CREATE INDEX IF NOT EXISTS ix_local_models_provider ON local_models(provider);

-- 添加表注释
COMMENT ON TABLE local_models IS '本地模型表';
COMMENT ON COLUMN local_models.id IS 'ID';
COMMENT ON COLUMN local_models.name IS '模型名称';
COMMENT ON COLUMN local_models.provider IS '模型商';
COMMENT ON COLUMN local_models.base_url IS '访问地址';
COMMENT ON COLUMN local_models.api_key IS 'API-KEY';

-- ============================================
-- 7. 用户模型设置表 (user_model_settings)
--    /home 设置弹窗保存的用户级模型配置，每用户一行
-- ============================================
CREATE TABLE IF NOT EXISTS user_model_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    provider VARCHAR(64) NOT NULL,
    base_url VARCHAR(256) NOT NULL,
    api_key VARCHAR(512) NOT NULL,
    model_name VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_user_model_settings_user_id ON user_model_settings(user_id);

COMMENT ON TABLE user_model_settings IS '用户模型设置表';
COMMENT ON COLUMN user_model_settings.user_id IS '用户ID';
COMMENT ON COLUMN user_model_settings.provider IS '模型厂商';
COMMENT ON COLUMN user_model_settings.base_url IS '访问地址';
COMMENT ON COLUMN user_model_settings.api_key IS 'API-KEY';
COMMENT ON COLUMN user_model_settings.model_name IS '模型名称';

-- ============================================
-- 8. SQL Agent 目标库配置表 (agent_db_settings)
--    取代原 .env 的 AGENT_DB_* 配置项，每行一个可选数据库
-- ============================================
CREATE TABLE IF NOT EXISTS agent_db_settings (
    id SERIAL PRIMARY KEY,
    db_name VARCHAR(128) NOT NULL UNIQUE,
    db_label VARCHAR(128),
    db_host VARCHAR(128) NOT NULL,
    db_port INTEGER NOT NULL DEFAULT 5432,
    db_username VARCHAR(128) NOT NULL,
    db_password VARCHAR(256) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_agent_db_settings_db_name ON agent_db_settings(db_name);

COMMENT ON TABLE agent_db_settings IS 'SQL Agent 目标库配置表';
COMMENT ON COLUMN agent_db_settings.id IS 'ID';
COMMENT ON COLUMN agent_db_settings.db_name IS '目标库名';
COMMENT ON COLUMN agent_db_settings.db_label IS '展示名称';
COMMENT ON COLUMN agent_db_settings.db_host IS '主机地址';
COMMENT ON COLUMN agent_db_settings.db_port IS '端口';
COMMENT ON COLUMN agent_db_settings.db_username IS '用户名';
COMMENT ON COLUMN agent_db_settings.db_password IS '密码（明文，与 external_models.api_key 约定一致）';

-- 示例：写入一个可选数据库（按需修改后执行）
-- INSERT INTO agent_db_settings (db_name, db_label, db_host, db_port, db_username, db_password)
-- VALUES ('analytics', '分析库', '127.0.0.1', 5432, 'readonly', 'secret');

-- ============================================
-- 9. 外部模型提供商配置表 (external_provider)
--    取代原 .env 的 EXTERNAL_API_KEY / EXTERNAL_*_BASE_URL；
--    LLM_PROVIDER=external 时读取 id 最小行作为生效配置
-- ============================================
CREATE TABLE IF NOT EXISTS external_provider (
    id SERIAL PRIMARY KEY,
    api_key VARCHAR(512) NOT NULL,
    llm_base_url VARCHAR(256) NOT NULL,
    embd_base_url VARCHAR(256),
    vl_base_url VARCHAR(256),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE external_provider IS '外部模型提供商配置表';
COMMENT ON COLUMN external_provider.id IS 'ID';
COMMENT ON COLUMN external_provider.api_key IS 'API-KEY（明文，与 external_models 约定一致）';
COMMENT ON COLUMN external_provider.llm_base_url IS 'LLM 访问地址';
COMMENT ON COLUMN external_provider.embd_base_url IS 'Embedding 访问地址';
COMMENT ON COLUMN external_provider.vl_base_url IS '视觉模型访问地址';

-- 示例（按需修改后执行）：
-- INSERT INTO external_provider (api_key, llm_base_url, embd_base_url, vl_base_url)
-- VALUES ('sk-xxx', 'https://api.siliconflow.cn/v1', 'https://api.siliconflow.cn/v1', 'https://api.siliconflow.cn/v1');

-- ============================================
-- 10. 本地模型提供商配置表 (local_provider)
--     取代原 .env 的 LOCAL_API_KEY / LOCAL_*_BASE_URL；
--     LLM_PROVIDER=local 时读取 id 最小行作为生效配置
-- ============================================
CREATE TABLE IF NOT EXISTS local_provider (
    id SERIAL PRIMARY KEY,
    api_key VARCHAR(512) NOT NULL,
    llm_base_url VARCHAR(256) NOT NULL,
    embd_base_url VARCHAR(256),
    vl_base_url VARCHAR(256),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE local_provider IS '本地模型提供商配置表';
COMMENT ON COLUMN local_provider.id IS 'ID';
COMMENT ON COLUMN local_provider.api_key IS 'API-KEY（明文，与 external_models 约定一致）';
COMMENT ON COLUMN local_provider.llm_base_url IS 'LLM 访问地址';
COMMENT ON COLUMN local_provider.embd_base_url IS 'Embedding 访问地址';
COMMENT ON COLUMN local_provider.vl_base_url IS '视觉模型访问地址';

-- 示例（按需修改后执行）：
-- INSERT INTO local_provider (api_key, llm_base_url, embd_base_url, vl_base_url)
-- VALUES ('ollama', 'http://localhost:11434/v1', 'http://localhost:11434/v1', 'http://localhost:11434/v1');

-- ============================================
-- 11. 用量日志表 (usage_logs)
--     每轮流式对话结束后写入一行，记录 token 消耗与估算花费，
--     供前端“流量统计”面板按日聚合展示
-- ============================================
CREATE TABLE IF NOT EXISTS usage_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    conversation_id VARCHAR(64),
    model_name VARCHAR(128),
    model_type VARCHAR(32),
    intent VARCHAR(64),
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS ix_usage_logs_created_at ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_usage_logs_user_created ON usage_logs(user_id, created_at);

COMMENT ON TABLE usage_logs IS '用量日志表（token 消耗与花费）';
COMMENT ON COLUMN usage_logs.user_id IS '用户ID（未登录时为 NULL）';
COMMENT ON COLUMN usage_logs.conversation_id IS '会话 ID';
COMMENT ON COLUMN usage_logs.model_name IS '调用的模型名称';
COMMENT ON COLUMN usage_logs.model_type IS '模型类型: local 或 external';
COMMENT ON COLUMN usage_logs.intent IS '识别的意图（general/sql/code）';
COMMENT ON COLUMN usage_logs.input_tokens IS '输入 token 数';
COMMENT ON COLUMN usage_logs.output_tokens IS '输出 token 数';
COMMENT ON COLUMN usage_logs.total_tokens IS '总 token 数';
COMMENT ON COLUMN usage_logs.cost_usd IS '估算花费（USD），本地模型为 0';
COMMENT ON COLUMN usage_logs.created_at IS '创建时间';

-- ============================================
-- 触发器：自动更新 users 表的 updated_at 字段
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 删除已存在的触发器（如果有）
DROP TRIGGER IF EXISTS update_users_updated_at ON users;

-- 创建触发器
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 完成
-- ============================================
-- 执行完成后，数据库表已创建成功
--
-- 注意：以下 TASK-001 ~ TASK-018 新增的表（table_comments / document_chunks /
-- conversation_summaries / sql_examples / approval_tasks / report_subscriptions /
-- uploaded_images / prompt_templates）不在本 init.sql 中显式 CREATE TABLE，
-- 而是由 SQLAlchemy ``Base.metadata.create_all`` 在应用启动期统一自动建表。
-- 因此：
--   - 全新部署：init.sql 跑完后再启动应用，create_all 会补建这几张新表
--   - 已有库升级：直接重启应用即可，create_all 会按 IF NOT EXISTS 语义补建
-- 新字段（如 users.is_admin / users.password_algo）已通过 ALTER TABLE ADD COLUMN
-- IF NOT EXISTS 在本文件第 26 行附近兼容老库。
--
-- 如需手动建表（不依赖 create_all），可在 psql 中按 src/models/x_models.py
-- 中的 ORM 模型手工 CREATE TABLE。
