-- id_x_010 兼容性补丁（与 ops/scripts/migrate_compat.sql 同步）
-- docker-entrypoint-initdb.d 自动执行；幂等。
\echo '=== id_x_010 compat patch (06_compat.sql) ==='

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN users.is_admin IS '是否管理员（控制 /admin 路由与 admin mutation 访问）';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo VARCHAR(16) DEFAULT 'bcrypt';
COMMENT ON COLUMN users.password_algo IS '密码哈希算法：bcrypt / sha256（老数据）';

UPDATE users
SET password_algo = 'sha256'
WHERE password_algo IS NULL OR password_algo NOT IN ('bcrypt', 'sha256');
