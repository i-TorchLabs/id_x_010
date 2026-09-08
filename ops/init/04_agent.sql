-- SQL Agent 目标库预置配置
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行（紧随 01_init.sql 之后）。
-- 内容来自 ops/.env 的 AGENT_* 配置项；getDatabases 接口返回本表全部行，
-- AGENT_DB_LIST 中的每个库各写一行，共用 AGENT_DB_HOST/PORT/USERNAME/PASSWORD。

INSERT INTO agent_db_settings (db_name, db_label, db_host, db_port, db_username, db_password)
SELECT 'i', '测试库', '10.20.217.87', 15432, 'i', 'P@ssmickey233!'
WHERE NOT EXISTS (SELECT 1 FROM agent_db_settings WHERE db_name = 'i');

INSERT INTO agent_db_settings (db_name, db_label, db_host, db_port, db_username, db_password)
SELECT 'ex_biaopu_target', '标普数据库', '10.20.217.87', 15432, 'i', 'P@ssmickey233!'
WHERE NOT EXISTS (SELECT 1 FROM agent_db_settings WHERE db_name = 'ex_biaopu_target');
