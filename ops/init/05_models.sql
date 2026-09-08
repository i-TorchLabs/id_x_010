-- 外部模型预置数据
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行（紧随 04_agent.sql 之后）。
-- getModels 接口返回本表全部行；WHERE NOT EXISTS 保证重复执行不产生重复记录。

INSERT INTO external_models (name, provider, base_url, api_key)
SELECT 'kimi-k3', '月之暗面', 'https://api.moonshot.cn/v1', 'sk-IKNdAYUbQqCPZzUmbWXDVwiWyg3FyVs9FRdHi8N2lA0gbJJo'
WHERE NOT EXISTS (SELECT 1 FROM external_models WHERE name = 'kimi-k3');

INSERT INTO external_models (name, provider, base_url, api_key)
SELECT 'zai-org/GLM-5.2', '硅基流动', 'https://api.siliconflow.cn/v1', 'sk-wdqcchmtuorxjjdftgrdmzjxqjgzolsegqmlqgaxsuuhwlxk'
WHERE NOT EXISTS (SELECT 1 FROM external_models WHERE name = 'zai-org/GLM-5.2');
