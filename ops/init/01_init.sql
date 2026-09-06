-- PostgreSQL 初始化脚本
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行。
-- entrypoint 已在 POSTGRES_DB 指定的库内建立连接，本脚本不再
-- 硬编码库名（改 POSTGRES_DB 即可整体切换目标库）。

-- ============================================
-- 1. 用户表 (users)
-- 优先创建，因为其他表依赖此表
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(128) NOT NULL UNIQUE,
    phone VARCHAR(20),
    password_hash VARCHAR(256) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 用户表索引
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);
CREATE INDEX IF NOT EXISTS ix_users_phone ON users(phone);

-- 添加表注释
COMMENT ON TABLE users IS '用户表';
COMMENT ON COLUMN users.id IS '用户ID';
COMMENT ON COLUMN users.email IS '邮箱';
COMMENT ON COLUMN users.phone IS '电话号码';
COMMENT ON COLUMN users.password_hash IS '密码哈希';
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
