-- 外部模型预置数据
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行（紧随 04_agent.sql 之后）。
-- getModels 接口返回本表全部行；WHERE NOT EXISTS 保证重复执行不产生重复记录。

INSERT INTO external_models (name, provider, base_url, api_key)
SELECT 'zai-org/GLM-5.2', 'Default', 'https://api.siliconflow.cn/v1', 'sk-wdqcchmtuorxjjdftgrdmzjxqjgzolsegqmlqgaxsuuhwlxk'
WHERE NOT EXISTS (SELECT 1 FROM external_models WHERE name = 'zai-org/GLM-5.2');

-- 系统预置模型种子数据（system_model_settings 表）
-- 管理员维护，用户只读；enabled 行对所有用户在模型选择器中可见。
-- 与 external_models 的种子保持同步，确保未配置用户级模型的用户也能看到默认模型。
INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'zai-org/GLM-5.2', 'SiliconFlow', 'https://api.siliconflow.cn/v1', 'sk-wdqcchmtuorxjjdftgrdmzjxqjgzolsegqmlqgaxsuuhwlxk', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'zai-org/GLM-5.2');
