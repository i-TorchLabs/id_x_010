-- id_x_010 兼容性补丁（与 ops/scripts/migrate_compat.sql 同步）
-- docker-entrypoint-initdb.d 自动执行；幂等。
\echo '=== id_x_010 compat patch (06_compat.sql) ==='

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN users.is_admin IS '是否管理员（admin ∈ role 的派生标志，兼容老校验）';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo VARCHAR(16) DEFAULT 'bcrypt';
COMMENT ON COLUMN users.password_algo IS '密码哈希算法：bcrypt / sha256（老数据）';
ALTER TABLE users ADD COLUMN IF NOT EXISTS system_model_quota_usd DOUBLE PRECISION;
COMMENT ON COLUMN users.system_model_quota_usd IS '系统预置模型月度配额上限（USD）；NULL 不限额，仅限系统模型';
-- 用户角色（多角色，逗号分隔）：user=普通用户, admin=管理员。同一用户可同时拥有多角色。
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(64) NOT NULL DEFAULT 'user';
COMMENT ON COLUMN users.role IS '用户角色（逗号分隔多角色）：user / admin / user,admin';
-- 老库迁移：已 is_admin=TRUE 的行回填 role='user,admin'（幂等，仅更新 role 仍为旧单值或 NULL 的行）
UPDATE users SET role = 'user,admin' WHERE is_admin = TRUE AND (role IS NULL OR role = 'user' OR role = 'admin');
UPDATE users SET is_admin = TRUE WHERE role LIKE '%admin%' AND is_admin IS NOT TRUE;

-- usage_logs 增量字段：is_system_model
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS is_system_model BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN usage_logs.is_system_model IS '是否为系统预置模型调用（配额与统计仅计入系统模型）';
COMMENT ON COLUMN users.password_algo IS '密码哈希算法：bcrypt / sha256（老数据）';

UPDATE users
SET password_algo = 'sha256'
WHERE password_algo IS NULL OR password_algo NOT IN ('bcrypt', 'sha256');

-- 用户模型设置表增量字段：model_name_list（模型列表）+ quota_limit_monthly_usd（月度额度）
ALTER TABLE user_model_settings ADD COLUMN IF NOT EXISTS model_name_list JSONB NOT NULL DEFAULT '[]'::jsonb;
COMMENT ON COLUMN user_model_settings.model_name_list IS '可选模型名称列表（JSON 数组），模型选择器据此渲染';
ALTER TABLE user_model_settings ADD COLUMN IF NOT EXISTS quota_limit_monthly_usd DOUBLE PRECISION;
COMMENT ON COLUMN user_model_settings.quota_limit_monthly_usd IS '月度额度上限（USD，自然月聚合）；NULL 表示不限额';

-- 用户自定义模型 Provider 表（user_model_providers）
CREATE TABLE IF NOT EXISTS user_model_providers (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    provider VARCHAR(64) NOT NULL,
    base_url VARCHAR(256) NOT NULL,
    api_key VARCHAR(512) NOT NULL,
    model_name_list JSONB NOT NULL DEFAULT '[]'::jsonb,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_model_provider UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS ix_user_model_providers_user_id ON user_model_providers(user_id);
COMMENT ON TABLE user_model_providers IS '用户自定义模型 Provider 表（每用户多行）';
COMMENT ON COLUMN user_model_providers.provider IS '模型厂商，如 siliconflow/openai/deepseek';
COMMENT ON COLUMN user_model_providers.model_name_list IS '该 Provider 下可选的模型名称列表（JSON 数组）';

-- 系统预置模型表（system_model_settings）：管理员维护，用户只读
CREATE TABLE IF NOT EXISTS system_model_settings (
    id SERIAL PRIMARY KEY,
    name VARCHAR(128) NOT NULL UNIQUE,
    provider VARCHAR(64) NOT NULL,
    base_url VARCHAR(256) NOT NULL,
    api_key VARCHAR(512) NOT NULL,
    model_type VARCHAR(32) NOT NULL DEFAULT 'external',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_system_model_settings_name ON system_model_settings(name);
CREATE INDEX IF NOT EXISTS ix_system_model_settings_enabled ON system_model_settings(enabled);
COMMENT ON TABLE system_model_settings IS '系统预置模型表（管理员维护，用户只读）';
COMMENT ON COLUMN system_model_settings.name IS '模型名称';
COMMENT ON COLUMN system_model_settings.provider IS '模型厂商';
COMMENT ON COLUMN system_model_settings.base_url IS '访问地址';
COMMENT ON COLUMN system_model_settings.api_key IS 'API-KEY';
COMMENT ON COLUMN system_model_settings.model_type IS '模型类型: local 或 external';
COMMENT ON COLUMN system_model_settings.is_default IS '是否为系统默认模型（用户未配置时的回退默认）';
COMMENT ON COLUMN system_model_settings.enabled IS '是否启用（禁用后不在选择器展示）';
COMMENT ON COLUMN system_model_settings.sort_order IS '排序序号（小在前）';

-- 用户对系统预置模型的 API Key 映射表（system_model_user_mappings）
CREATE TABLE IF NOT EXISTS system_model_user_mappings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    system_model_id INTEGER NOT NULL REFERENCES system_model_settings(id) ON DELETE CASCADE,
    api_key VARCHAR(512) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_user_system_model UNIQUE (user_id, system_model_id)
);
CREATE INDEX IF NOT EXISTS ix_system_model_user_mappings_user_id ON system_model_user_mappings(user_id);
CREATE INDEX IF NOT EXISTS ix_system_model_user_mappings_system_model_id ON system_model_user_mappings(system_model_id);
COMMENT ON TABLE system_model_user_mappings IS '用户对系统预置模型的 API Key 映射表';
COMMENT ON COLUMN system_model_user_mappings.user_id IS '用户 ID';
COMMENT ON COLUMN system_model_user_mappings.system_model_id IS '系统预置模型 ID';
COMMENT ON COLUMN system_model_user_mappings.api_key IS '用户个人 API Key（覆盖系统模型全局 key）';

