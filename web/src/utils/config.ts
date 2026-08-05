// API 地址声明于 web/.env.local（模板见 .env.local.example），构建期由 Next.js 注入
export const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? "";
export const SUB_VERSION = process.env.NEXT_PUBLIC_SUB_VERSION ?? "/b/id_x_010/graphql";
export const API_BASE_URL = `${BASE_URL}${SUB_VERSION}`;
