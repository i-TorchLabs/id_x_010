-- 系统预置模型种子数据（system_model_settings 表）
-- 管理员维护，用户只读；enabled 行对所有用户在模型选择器中可见。
-- 与 external_models 的种子保持同步，确保未配置用户级模型的用户也能看到默认模型。
INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-fable-5', 'Anthropic', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-fable-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-haiku-5-5', 'Anthropic', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-haiku-5-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-haiku-5-5', 'Anthropic', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-haiku-5-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'claude-opus-5', 'Anthropic', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'claude-opus-5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'deepseek-v4-pro', 'DeepSeek', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'deepseek-v4-pro');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'deepseek-v4-flash', 'DeepSeek', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'deepseek-v4-flash');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-6-astra', 'OpenAI', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-6-astra');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gpt-5.5', 'OpenAI', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gpt-5.5');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gemini-3.1-flash-image', 'Gemini', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gemini-3.1-flash-image');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'gemini-3-pro-image', 'Gemini', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'gemini-3-pro-image');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'kimi-k3', 'Moonshot', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'kimi-k3');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'kimi-k2.7-code', 'Moonshot', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'kimi-k2.7-code');

INSERT INTO system_model_settings (name, provider, base_url, api_key, model_type, is_default, enabled, sort_order)
SELECT 'glm-5.3', '智谱', 'https://kjapi.botsmart.net/v1', 'sk-VHxaJGsLTlgvHJRYLMRLmyfjenaZgg3AsIp64mQfzDa75WLn', 'external', true, true, 1
WHERE NOT EXISTS (SELECT 1 FROM system_model_settings WHERE name = 'glm-5.3');
