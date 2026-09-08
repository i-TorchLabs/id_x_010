-- 本地模型提供商预置配置（Ollama）
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行（紧随 01_init.sql 之后）。
-- 内容来自 ops/.env 的 LOCAL_* 配置项；LLM_PROVIDER=local 时，
-- 引擎层读取 local_provider 中 id 最小的行作为生效配置。
-- 注：.env 未定义 LOCAL_API_KEY，api_key 列为 NOT NULL，
--     按 01_init.sql 第 10 节示例以 'ollama' 占位。

INSERT INTO local_provider (api_key, llm_base_url, embd_base_url, vl_base_url)
SELECT 'ollama',
       'http://host.containers.internal:11434',
       'http://host.containers.internal:11434',
       'http://host.containers.internal:11434'
WHERE NOT EXISTS (SELECT 1 FROM local_provider);
