-- SSO 单点登录预置配置（ADFS OAuth2）
-- 由 db 容器 docker-entrypoint-initdb.d 在首次启动时自动执行（紧随 06_compat.sql 之后）。
-- 内容来自 .env 的 AA_OAUTH_CLIENT_ID / AA_OAUTH_CLIENT_SECRET /
-- AA_OAUTH_REDIRECT_URI；SSO 登录时读取 sso_settings 中 id 最小的行作为生效配置。

INSERT INTO sso_settings (client_id, client_secret, redirect_uri)
SELECT '373d4823-7c0b-4375-a16c-e902f979ee34',
       'xKczBbxvKZ2kELoUiuEfkLPkmYF2yN2V0jAHpgD0',
       'https://sme-tx-studio.cuhk.edu.cn/f/010/oauth2'
WHERE NOT EXISTS (SELECT 1 FROM sso_settings);
