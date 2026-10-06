-- id_x_010 兼容性补丁脚本（TASK-001 ~ TASK-019 增量字段）
--
-- 用途：已有库升级到新版时，本脚本补充老表的新字段；新表由应用层
-- Base.metadata.create_all 自动建，无需在此脚本中处理。
-- 执行方式（容器外）：
--   psql -h 127.0.0.1 -p 15432 -U postgres -d id_x_010 -f ops/scripts/migrate_compat.sql
-- 或在 service 容器内：
--   docker exec -it id_x_010-service psql "$DATABASE_URL" -f /app/i-Core/x_models/id_x_010/ops/scripts/migrate_compat.sql
--
-- 幂等：每条 ALTER 都用 ADD COLUMN IF NOT EXISTS，可重复执行。

\echo '=== id_x_010 compat migration start ==='

-- TASK-001 pgvector 扩展（需 superuser；应用启动也会创建，失败时 DBA 手工执行）
CREATE EXTENSION IF NOT EXISTS vector;

-- TASK-013 / TASK-019：users 表新增字段
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN users.is_admin IS '是否管理员（控制 /admin 路由与 admin mutation 访问）';
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_algo VARCHAR(16) DEFAULT 'bcrypt';
COMMENT ON COLUMN users.password_algo IS '密码哈希算法：bcrypt / sha256（老数据）';

-- 把所有 sha256/NULL 老数据标记为 sha256（登录时由 verify_password 自动升级）
UPDATE users
SET password_algo = 'sha256'
WHERE password_algo IS NULL OR password_algo NOT IN ('bcrypt', 'sha256');

\echo '=== id_x_010 compat migration end ==='
