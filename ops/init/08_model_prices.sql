-- id_x_010 模型价格预置（08_model_prices.sql）
-- docker-entrypoint-initdb.d 自动执行；幂等。
--
-- model_prices 表结构由 01_init.sql / 06_compat.sql 创建；
-- 本文件仅负责预置价格数据（USD / 1M tokens），
-- 计费时按 model_key 小写子串匹配（最长匹配优先），
-- 未命中时回退到应用内置目录（src/utils/x_pricing.py）。
\echo '=== id_x_010 model prices seed (08_model_prices.sql) ==='

-- 清理历史预置记录（旧版 01_init.sql / 06_compat.sql 曾内置的目录）。
-- 仅删除明确列出的旧 key，避免误删管理员后续自定义的记录；
-- 新初始化的库此表为空，DELETE 为空操作，保持幂等。
DELETE FROM model_prices WHERE model_key IN (
    'gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4-turbo',
    'o1-mini', 'o1',
    'claude-3-5-haiku', 'claude-3-5-sonnet', 'claude-3-opus', 'claude-3-haiku',
    'deepseek-reasoner', 'deepseek-chat', 'deepseek-coder',
    'glm-4v', 'glm-4-air', 'glm-4-flash', 'glm-4-plus', 'glm-4', 'glm-5',
    'qwen-max', 'qwen-plus', 'qwen-turbo',
    'llama-3.1-405b', 'llama-3.1-70b', 'llama-3.1-8b',
    'mistral-large', 'mistral-small'
);

-- 预置价格目录（与网关实际可用模型同步）。
-- ON CONFLICT DO UPDATE：重复执行时以本文件价格为准，保证价格可随镜像升级。
INSERT INTO model_prices (model_key, input_price_per_1m, output_price_per_1m) VALUES
    ('claude-fable-5',          9.0,     45.0),
    ('claude-haiku-5-5',        0.09,    0.45),
    ('claude-opus-5',           4.5,     22.5),
    ('gpt-5.5',                 4.0,     24.0),
    ('gpt-6-astra',             8.0,     40.0),
    ('gemini-3.1-flash-image',  0.4,     48.0),
    ('gemini-3-pro-image',      1.6,     96.0),
    ('kimi-k3',                 2.6471,  13.2353),
    ('kimi-k2.7-code',          0.86031, 3.5735),
    ('glm-5.3',                 1.062,   3.708)
ON CONFLICT (model_key) DO UPDATE SET
    input_price_per_1m = EXCLUDED.input_price_per_1m,
    output_price_per_1m = EXCLUDED.output_price_per_1m,
    enabled = TRUE,
    updated_at = NOW();

\echo '=== 08_model_prices.sql done ==='
