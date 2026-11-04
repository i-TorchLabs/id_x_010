-- 系统预置模型种子数据（system_model_settings 表）
-- 管理员维护，用户只读；enabled 行对所有用户在模型选择器中可见。
-- 与 external_models 的种子保持同步，确保未配置用户级模型的用户也能看到默认模型。
INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-fable-5', 'Anthropic', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-fable-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-opus-5', 'Anthropic', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-opus-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-opus-5-5', 'Anthropic', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-opus-5-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-sonnet-5', 'Anthropic', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-sonnet-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-sonnet-5-5', 'Anthropic', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-sonnet-5-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-5.5', 'OpenAI', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-5.5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-5.6-sol', 'OpenAI', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-5.6-sol');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-5.6-terra', 'OpenAI', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-5.6-terra');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-6-astra', 'OpenAI', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-6-astra');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-6-sol', 'OpenAI', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-6-sol');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'glm-5.3', 'GLM', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'glm-5.3');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'deepseek-v4-flash-0731', 'DeepSeek', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'deepseek-v4-flash-0731');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'deepseek-v4-pro-0813', 'DeepSeek', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'deepseek-v4-pro-0813');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'deepseek-v4.1-flash', 'DeepSeek', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'deepseek-v4.1-flash');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'deepseek-v4.1-flash-1017', 'DeepSeek', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'deepseek-v4.1-flash-1017');

-- INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
-- SELECT 'kimi-k3', 'Moonshot', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
-- WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'kimi-k3');

-- INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
-- SELECT 'kimi-k3.1-pro', 'Moonshot', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
-- WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'kimi-k3.1-pro');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'qwen3.8-flash', 'Qwen', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'qwen3.8-flash');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'qwen3.8-max', 'Qwen', 'https://apihk.chinarouter.net/v1', 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'qwen3.8-max');
