-- 09_admin.sql —— 预置管理员账户（手动初始化外部第三方库参考）
-- 默认部署（外部第三方 PostgreSQL）由应用启动时 x_seed.seed_initial_admin
-- 幂等播种（Python bcrypt，账号/口令取环境变量 ADMIN_EMAIL / ADMIN_PASSWORD，
-- 默认 sme@cuhk.edu.cn / P@sssme!），本脚本无须执行。
-- 手动执行（连接目标库后）：
--   psql -h <DB_HOST> -p <DB_PORT> -U <DB_USERNAME> -d <DB_NAME> -f init/09_admin.sql
--
-- 哈希方案：pgcrypto bcrypt（$2a$，cost 12），与后端
-- src/controllers/x_controllers.py::verify_password 的 bcrypt 分支
-- （password_algo='bcrypt'）及 hash_password 的 rounds=12 对齐；
-- $2a$ 前缀哈希可被 Python bcrypt.checkpw 正常校验。
--
-- 幂等：ON CONFLICT (email) DO NOTHING，重复执行不会覆盖已修改的密码/角色。

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- 9. 预置管理员账户 (users)
-- ============================================
INSERT INTO users (email, password_hash, password_algo, display_name, is_active, is_admin, role)
VALUES (
    'sme@cuhk.edu.cn',
    crypt('P@sssme!', gen_salt('bf', 12)),  -- 明文仅在此处出现，建议首次登录后修改
    'bcrypt',
    '管理员',
    TRUE,
    TRUE,
    'admin'
)
ON CONFLICT (email) DO NOTHING;

-- 如需将管理员账户重置回初始密码/角色（覆盖式），手工执行以下语句：
-- UPDATE users
--    SET password_hash = crypt('P@sssme!', gen_salt('bf', 12)),
--        password_algo = 'bcrypt',
--        is_admin      = TRUE,
--        role          = 'admin',
--        is_active     = TRUE,
--        updated_at    = CURRENT_TIMESTAMP
--  WHERE email = 'sme@cuhk.edu.cn';
