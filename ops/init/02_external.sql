-- 外部模型提供商预置配置
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行（紧随 01_init.sql 之后）。
-- 内容来自 ops/.env 的 EXTERNAL_* 配置项；LLM_PROVIDER=external 时，
-- 引擎层读取 external_provider 中 id 最小的行作为生效配置。

INSERT INTO external_provider (api_key, llm_base_url, embd_base_url, vl_base_url)
SELECT 'sk-c0NWVjzh9yAto2piPdsJ0ccHEKzXKjrEmlckXvEuAbdlbo5K',
       'https://api.chinarouter.net/v1',
       'https://api.chinarouter.net/v1',
       'https://api.chinarouter.net/v1'
WHERE NOT EXISTS (SELECT 1 FROM external_provider);

