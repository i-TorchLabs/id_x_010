/**
 * 应用配置文件
 * 集中管理所有环境变量和配置项
 */

// 后端 API 基础地址
export const BASE_URL =
    process.env.NEXT_PUBLIC_BASE_URL || "http://127.0.0.1:18080";

// API 版本
export const SUB_VERSION =
    process.env.NEXT_PUBLIC_SUB_VERSION || "/b/id-x-010/graphql";

// 完整的 API 地址
export const API_BASE_URL = `${BASE_URL}${SUB_VERSION}`;
