// API 地址声明于 web/.env.local（模板见 .env.local.example），构建期由 Next.js 注入
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";
export const SUB_VERSION = process.env.NEXT_PUBLIC_SUB_VERSION ?? "/b/id_x_010/graphql";
export const API_BASE_URL = `${BASE_URL}${SUB_VERSION}`;

/**
 * SSO 单点登录（ADFS OAuth2 授权码授予流）配置
 *
 * - client_id 为公开标识（出现在浏览器跳转 URL 中），可直接写死；
 * - client_secret 仅服务端持有，严禁写入前端代码 / 环境变量；
 * - redirect_uri 必须与 ADFS 注册地址、后端 AA_OAUTH_REDIRECT_URI 完全一致；
 * - next.config.ts 的 BASE_URL 不可在此引用（运行期差异），ADFS 端点单独维护。
 *
 * 注意：Docker 构建未传 --build-arg 时 ARG 为空串，?? 不会回退默认值，
 * 故此处用 ||（空串视为未配置，回退默认）。
 */
export const SITE_URL =
    process.env.NEXT_PUBLIC_SITE_URL || "https://localhost:8010";

/** ADFS OAuth2 端点（CUHK 统一身份认证） */
export const ADFS_BASE_URL =
    process.env.NEXT_PUBLIC_ADFS_BASE_URL ||
    "https://sts.cuhk.edu.cn/adfs/oauth2";
export const ADFS_AUTHORIZE_URL = `${ADFS_BASE_URL}/authorize`;
export const ADFS_LOGOUT_URL = `${ADFS_BASE_URL}/logout`;

/** ADFS 应用公开标识（client_secret 仅服务端持有） */
export const ADFS_CLIENT_ID =
    process.env.NEXT_PUBLIC_ADFS_CLIENT_ID ||
    "373d4823-7c0b-4375-a16c-e902f979ee34";
/** 回调地址需与 ADFS 注册及后端 AA_OAUTH_REDIRECT_URI 完全一致 */
export const ADFS_REDIRECT_URI =
    process.env.NEXT_PUBLIC_ADFS_REDIRECT_URI || `${SITE_URL}/f/010/oauth2`;
/** resource 参数：自己业务的 https 域名（默认取 SITE_URL） */
export const ADFS_RESOURCE =
    process.env.NEXT_PUBLIC_ADFS_RESOURCE || SITE_URL;
