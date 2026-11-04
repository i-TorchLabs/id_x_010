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
    'claude-fable-5',
    'claude-opus-5',
    'gpt-6-astra',
    'gpt-6-sol',
    'glm-5.3',
    'deepseek-v4-flash-0731',
    'deepseek-v4-pro-0813',
    'deepseek-v4.1-flash',
    'deepseek-v4.1-flash-1017',
    'kimi-k3',
    'kimi-k2.7-code',
    'kimi-k2.6',
    'kimi-k2.5'
);

-- 预置价格目录（与网关实际可用模型同步）。
-- ON CONFLICT DO UPDATE：重复执行时以本文件价格为准，保证价格可随镜像升级。
INSERT INTO model_prices (model_key, input_price_per_1m, output_price_per_1m) VALUES
    ('claude-fable-5',9.0,45.0),
    ('claude-opus-5',4.5,22.5),
    ('claude-opus-5-5',3.6,18),
    ('claude-sonnet-5',1.8,9),
    ('claude-sonnet-5-5',1.8,9),
    ('gpt-5.5',4,24),
    ('gpt-5.6-sol',3.2,16),
    ('gpt-5.6-terra',1.6,9.6),
    ('gpt-6-astra',8.0,40.0),
    ('gpt-6-sol',1.6,8.0),
    ('glm-5.3',1.062,3.708),
    ('deepseek-v4-flash-0731',0.352941,1.0588),
    ('deepseek-v4-pro-0813',1.0588,3.1765),
    ('deepseek-v4.1-flash',0.235294,0.941176),
    ('deepseek-v4.1-flash-1017',0.235294,0.941176),
    ('kimi-k3',2.6471,13.2353),
    ('kimi-k3.1-pro',1.7206,9.0),
    ('qwen3.8-flash',0.111765,0.377206),
    ('qwen3.8-max',1.6767,5.0294),
ON CONFLICT (model_key) DO UPDATE SET
    input_price_per_1m = EXCLUDED.input_price_per_1m,
    output_price_per_1m = EXCLUDED.output_price_per_1m,
    enabled = TRUE,
    updated_at = NOW();

\echo '=== 08_model_prices.sql done ==='
