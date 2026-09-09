/**
 * GraphQL API 客户端
 * 用于与后端 GraphQL 接口交互
 */

import { API_BASE_URL } from "@/utils/config";

// GraphQL 请求配置
interface GraphQLRequestConfig {
  query: string;
  variables?: Record<string, any>;
}

// GraphQL 响应类型
interface GraphQLResponse<T = any> {
  data: T;
  errors?: Array<{ message: string }>;
}

/**
 * GraphQL 客户端类
 */
class GraphQLClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * 获取默认请求头
   */
  private getDefaultHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // 如果有 token，添加到请求头
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * 发送 GraphQL 请求
   */
  async request<T = any>(
    config: GraphQLRequestConfig,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.getDefaultHeaders(),
      body: JSON.stringify({
        query: config.query,
        variables: config.variables,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result: GraphQLResponse<T> = await response.json();

    if (result.errors && result.errors.length > 0) {
      throw new Error(result.errors[0].message);
    }

    if (result.data === undefined || result.data === null) {
      throw new Error("GraphQL 响应中缺少 data 字段");
    }

    return result.data;
  }
}

// 导出 GraphQL 客户端实例
export const graphqlClient = new GraphQLClient();

// 用户注册输入类型
export interface RegisterInput {
  email: string;
  password: string;
  confirmPassword: string;
  phone?: string;
}

// 注册响应类型
export interface RegisterPayload {
  register: {
    success: boolean;
    message: string;
    token: string | null;
    user: {
      id: number;
      email: string;
      phone: string | null;
      createdAt: string | null;
    } | null;
  };
}

// 登录输入类型
export interface LoginInput {
  email: string;
  password: string;
}

// 登录响应类型
export interface LoginPayload {
  login: {
    success: boolean;
    message: string;
    token: string | null;
    user: {
      id: number;
      email: string;
      phone: string | null;
      createdAt: string | null;
    } | null;
  };
}

// 忘记密码输入类型
export interface ForgotPasswordInput {
  email: string;
}

// 忘记密码响应类型
export interface ForgotPasswordPayload {
  forgotPassword: {
    success: boolean;
    message: string;
    resetToken: string | null;
  };
}

// 登出响应类型
export interface LogoutPayload {
  logout: {
    success: boolean;
    message: string;
    token: null;
    user: null;
  };
}

// 用户信息类型
export interface UserProfile {
  profile: {
    id: number;
    username: string;
    email: string | null;
    phone: string | null;
    aiApiKey: string | null;
    isActive: boolean;
    createdAt: string | null;
    updatedAt: string | null;
  } | null;
}

/**
 * 用户 GraphQL API
 */
export const userGraphqlApi = {
  /**
   * 用户注册
   */
  register: async (input: RegisterInput): Promise<RegisterPayload> => {
    const mutation = `
      mutation Register($input: RegisterInput!) {
        register(input: $input) {
          success
          message
          token
          user {
            id
            email
            phone
            createdAt
          }
        }
      }
    `;

    return graphqlClient.request<RegisterPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /**
   * 用户登录
   */
  login: async (input: LoginInput): Promise<LoginPayload> => {
    const mutation = `
      mutation Login($input: LoginInput!) {
        login(input: $input) {
          success
          message
          token
          user {
            id
            email
            phone
            createdAt
          }
        }
      }
    `;

    return graphqlClient.request<LoginPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /**
   * 忘记密码
   */
  forgotPassword: async (
    input: ForgotPasswordInput,
  ): Promise<ForgotPasswordPayload> => {
    const mutation = `
      mutation ForgotPassword($input: ForgotPasswordInput!) {
        forgotPassword(input: $input) {
          success
          message
          resetToken
        }
      }
    `;

    return graphqlClient.request<ForgotPasswordPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /**
   * 用户登出
   */
  logout: async (): Promise<LogoutPayload> => {
    const mutation = `
      mutation Logout {
        logout {
          success
          message
          token
          user {
            id
          }
        }
      }
    `;

    return graphqlClient.request<LogoutPayload>({
      query: mutation,
    });
  },

  /**
   * SSO 单点登录（ADFS 授权码授予流，首次自动建档）
   */
  ssoLogin: async (input: SsoLoginInput): Promise<SsoLoginPayload> => {
    const mutation = `
      mutation SsoLogin($input: OauthInput!) {
        ssoLogin(input: $input) {
          success
          message
          token
          expiresAt
          user {
            id
            email
            phone
            createdAt
          }
        }
      }
    `;

    return graphqlClient.request<SsoLoginPayload>({
      query: mutation,
      variables: { input },
    });
  },
};

// SSO 登录输入类型
export interface SsoLoginInput {
  code: string;
  state: string;
}

// SSO 登录响应类型
export interface SsoLoginPayload {
  ssoLogin: {
    success: boolean;
    message: string;
    token: string | null;
    expiresAt: string | null;
    user: {
      id: number;
      email: string;
      phone: string | null;
      createdAt: string | null;
    } | null;
  };
}

// 模型信息类型
export interface ModelInfo {
  id: number;
  name: string;
  provider: string;
  baseUrl: string;
  modelType: string;
}

// 模型列表响应类型
export interface ModelsPayload {
  getModels: {
    success: boolean;
    message: string;
    models: ModelInfo[];
  };
}

/**
 * 模型 GraphQL API
 */
export const modelGraphqlApi = {
  /**
   * 获取可用模型列表
   */
  getModels: async (signal?: AbortSignal): Promise<ModelsPayload> => {
    const query = `
      query GetModels {
        getModels {
          success
          message
          models {
            id
            name
            provider
            baseUrl
            modelType
          }
        }
      }
    `;

    return graphqlClient.request<ModelsPayload>({ query }, signal);
  },
};

// 模型设置类型
export interface ModelSettings {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  updatedAt: string | null;
}

// 模型设置查询响应类型
export interface ModelSettingsPayload {
  getModelSettings: {
    success: boolean;
    message: string;
    settings: ModelSettings | null;
  };
}

// 模型设置保存响应类型
export interface SaveModelSettingsPayload {
  saveModelSettings: {
    success: boolean;
    message: string;
    settings: ModelSettings | null;
  };
}

// 模型设置输入类型
export interface ModelSettingsInput {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

/**
 * 模型设置 GraphQL API
 */
export const settingsGraphqlApi = {
  /**
   * 获取当前用户的模型设置
   */
  getModelSettings: async (): Promise<ModelSettingsPayload> => {
    const query = `
      query GetModelSettings {
        getModelSettings {
          success
          message
          settings {
            provider
            baseUrl
            apiKey
            modelName
            updatedAt
          }
        }
      }
    `;

    return graphqlClient.request<ModelSettingsPayload>({ query });
  },

  /**
   * 保存模型设置（后端先做连通性检测，通过才保存）
   */
  saveModelSettings: async (
    input: ModelSettingsInput,
  ): Promise<SaveModelSettingsPayload> => {
    const mutation = `
      mutation SaveModelSettings($input: ModelSettingsInput!) {
        saveModelSettings(input: $input) {
          success
          message
          settings {
            provider
            baseUrl
            apiKey
            modelName
            updatedAt
          }
        }
      }
    `;

    return graphqlClient.request<SaveModelSettingsPayload>({
      query: mutation,
      variables: { input },
    });
  },
};

// 数据库信息类型
export interface DatabaseInfo {
  key: string;
  label: string;
}

// 数据库列表响应类型
export interface DatabasesPayload {
  getDatabases: {
    success: boolean;
    message: string;
    databases: DatabaseInfo[];
  };
}

/**
 * 数据库 GraphQL API
 */
export const databaseGraphqlApi = {
  /**
   * 获取可用数据库列表
   */
  getDatabases: async (): Promise<DatabasesPayload> => {
    const query = `
      query GetDatabases {
        getDatabases {
          success
          message
          databases {
            key
            label
          }
        }
      }
    `;

    return graphqlClient.request<DatabasesPayload>({
      query,
    });
  },
};
