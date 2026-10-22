/**
 * GraphQL API 客户端
 * 用于与后端 GraphQL 接口交互
 */

import { API_BASE_URL } from "@/utils/config";

// GraphQL 请求配置
interface GraphQLRequestConfig {
  query: string;
  variables?: Record<string, any>;
  /** 超时（毫秒）。不传则不限时，由浏览器/网关决定。 */
  timeoutMs?: number;
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
    // 超时保护：避免后端长耗时任务（如连通性检测）挂住时，
    // 调用方的 loading 状态永远无法复位、按钮持续禁用。
    const { timeoutMs } = config;
    let controller: AbortController | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    let requestSignal = signal;

    if (timeoutMs != null && timeoutMs > 0) {
      controller = new AbortController();
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller?.abort();
      }, timeoutMs);
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener("abort", () => controller?.abort(), {
            once: true,
          });
        }
      }
      requestSignal = controller.signal;
    }

    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.getDefaultHeaders(),
        body: JSON.stringify({
          query: config.query,
          variables: config.variables,
        }),
        signal: requestSignal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result: GraphQLResponse<T> = await response.json();

      if (result.errors && result.errors.length > 0) {
        throw new Error(result.errors[0].message);
      }

      if (result.data === undefined || result.data === null) {
        throw new Error("GraphQL response missing data field");
      }

      return result.data;
    } catch (err) {
      if (timedOut) {
        throw new Error(
          `请求超时（${Math.round((timeoutMs ?? 0) / 1000)}s），请稍后重试`,
        );
      }
      throw err;
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
    }
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

// 用户信息（与后端 UserInfoType 对应，登录/注册/SSO/资料更新共用）
export interface User {
  id: number;
  email: string;
  phone: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: string | null;
  createdAt: string | null;
}

// 注册响应类型
export interface RegisterPayload {
  register: {
    success: boolean;
    message: string;
    token: string | null;
    user: User | null;
  };
}

// 登录输入类型
export interface LoginInput {
  email: string;
  password: string;
  // 可选角色校验："admin" 仅允许管理员登录，"user" 仅允许普通用户登录；
  // 留空表示不校验（兼容旧客户端）。由不同登录页传入。
  role?: string;
}

// 登录响应类型
export interface LoginPayload {
  login: {
    success: boolean;
    message: string;
    token: string | null;
    user: User | null;
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

// 更新资料输入类型
export interface UpdateProfileInput {
  displayName?: string | null;
}

// 更新资料响应类型
export interface UpdateProfilePayload {
  updateProfile: {
    success: boolean;
    message: string;
    user: User | null;
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
            displayName
            avatarUrl
            role
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
            displayName
            avatarUrl
            role
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
            displayName
            avatarUrl
            role
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

  /**
   * 更新当前用户资料（显示名称）。
   * 头像上传走 uploadAvatar() REST 端点（multipart/form-data）。
   */
  updateProfile: async (
    input: UpdateProfileInput,
  ): Promise<UpdateProfilePayload> => {
    const mutation = `
      mutation UpdateProfile($input: UpdateProfileInput!) {
        updateProfile(input: $input) {
          success
          message
          user {
            id
            email
            phone
            displayName
            avatarUrl
            role
            createdAt
          }
        }
      }
    `;
    return graphqlClient.request<UpdateProfilePayload>({
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
    user: User | null;
  };
}

// 模型信息类型
export interface ModelInfo {
  id: number;
  name: string;
  provider: string;
  baseUrl: string;
  modelType: string;
  isDefault?: boolean;
  isSystem?: boolean;
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
            isDefault
            isSystem
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
  modelNameList: string[];
  quotaLimitMonthlyUsd: number | null;
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

// 模型设置输入类型（配额由管理员在管理后台设置，不再由用户提交）
export interface ModelSettingsInput {
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  modelNameList: string[];
}

// 连通性测试输入类型
export interface TestConnectionInput {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

// 连通性测试响应类型
export interface TestConnectionPayload {
  testConnection: {
    success: boolean;
    message: string;
  };
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
            modelNameList
            quotaLimitMonthlyUsd
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
            modelNameList
            quotaLimitMonthlyUsd
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

  /**
   * 测试模型连通性（不落库），用于保存前的独立检测
   */
  testConnection: async (
    input: TestConnectionInput,
  ): Promise<TestConnectionPayload> => {
    const mutation = `
      mutation TestConnection($input: TestConnectionInput!) {
        testConnection(input: $input) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<TestConnectionPayload>({
      query: mutation,
      variables: { input },
    });
  },
};

// ── 用户自定义模型 Provider（多 Provider，每 Provider 多模型）──

export interface UserModelPropertyItem {
  id: number;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelNameList: string[];
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface MyModelProvidersPayload {
  myModelProviders: {
    success: boolean;
    message: string;
    providers: UserModelPropertyItem[];
  };
}

export interface UserModelPropertySaveInput {
  id?: number | null;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelNameList: string[];
  sortOrder?: number;
  testConnection?: boolean;
}

export interface SaveModelProviderPayload {
  saveModelProvider: {
    success: boolean;
    message: string;
    provider: UserModelPropertyItem | null;
  };
}

export interface DeleteModelProviderPayload {
  deleteModelProvider: {
    success: boolean;
    message: string;
  };
}

export interface SaveDefaultModelInput {
  modelName: string;
}

export interface SaveDefaultModelPayload {
  saveDefaultModel: {
    success: boolean;
    message: string;
    modelName: string | null;
  };
}

export const userModelProviderGraphqlApi = {
  /** 获取当前用户的全部自定义模型 Provider */
  myModelProviders: async (): Promise<MyModelProvidersPayload> => {
    const query = `
      query MyModelProviders {
        myModelProviders {
          success
          message
          providers {
            id
            provider
            baseUrl
            apiKey
            modelNameList
            sortOrder
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<MyModelProvidersPayload>({ query });
  },

  /** 新增/更新用户 Provider（含连通性检测） */
  saveModelProvider: async (
    input: UserModelPropertySaveInput,
  ): Promise<SaveModelProviderPayload> => {
    const mutation = `
      mutation SaveModelProvider($input: UserModelPropertyInput!) {
        saveModelProvider(input: $input) {
          success
          message
          provider {
            id
            provider
            baseUrl
            apiKey
            modelNameList
            sortOrder
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<SaveModelProviderPayload>({
      query: mutation,
      variables: { input },
      // 后端保存前会对第一个模型做连通性检测（含重试最长约 40s），
      // 这里留足余量；超时后抛错，避免保存按钮永久卡在禁用态。
      timeoutMs: 60_000,
    });
  },

  /** 删除用户 Provider */
  deleteModelProvider: async (
    providerId: number,
  ): Promise<DeleteModelProviderPayload> => {
    const mutation = `
      mutation DeleteModelProvider($providerId: Int!) {
        deleteModelProvider(providerId: $providerId) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<DeleteModelProviderPayload>({
      query: mutation,
      variables: { providerId },
    });
  },

  /** 设置默认模型名（配额由管理员在管理后台设置） */
  saveDefaultModel: async (
    input: SaveDefaultModelInput,
  ): Promise<SaveDefaultModelPayload> => {
    const mutation = `
      mutation SaveDefaultModel($input: SaveDefaultModelInput!) {
        saveDefaultModel(input: $input) {
          success
          message
          modelName
        }
      }
    `;
    return graphqlClient.request<SaveDefaultModelPayload>({
      query: mutation,
      variables: { input },
    });
  },
};

// ── 外部模型管理（多模型 + Provider 自定义）──

export interface ExternalModelItem {
  id: number;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
}

export interface ExternalModelListPayload {
  externalModels: {
    success: boolean;
    message: string;
    models: ExternalModelItem[];
  };
}

export interface ExternalModelSaveInput {
  id?: number | null;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  testConnection?: boolean;
}

export interface ExternalModelMutationPayload {
  saveExternalModel: {
    success: boolean;
    message: string;
    model: ExternalModelItem | null;
  };
}

export interface DeleteExternalModelPayload {
  deleteExternalModel: {
    success: boolean;
    message: string;
  };
}

export interface SetActiveModelPayload {
  setActiveModel: {
    success: boolean;
    message: string;
  };
}

export const externalModelGraphqlApi = {
  /** 列出 external_models 全部记录 */
  listExternalModels: async (): Promise<ExternalModelListPayload> => {
    const query = `
      query ExternalModels {
        externalModels {
          success
          message
          models {
            id
            name
            provider
            baseUrl
            apiKey
          }
        }
      }
    `;
    return graphqlClient.request<ExternalModelListPayload>({ query });
  },

  /** 新增/更新外部模型（可选连通性检测） */
  saveExternalModel: async (
    input: ExternalModelSaveInput,
  ): Promise<ExternalModelMutationPayload> => {
    const mutation = `
      mutation SaveExternalModel($input: ExternalModelInput!) {
        saveExternalModel(input: $input) {
          success
          message
          model {
            id
            name
            provider
            baseUrl
            apiKey
          }
        }
      }
    `;
    return graphqlClient.request<ExternalModelMutationPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /** 删除外部模型 */
  deleteExternalModel: async (
    modelId: number,
  ): Promise<DeleteExternalModelPayload> => {
    const mutation = `
      mutation DeleteExternalModel($modelId: Int!) {
        deleteExternalModel(modelId: $modelId) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<DeleteExternalModelPayload>({
      query: mutation,
      variables: { modelId },
    });
  },

  /** 设为活跃模型（写入 user_model_settings，orchestrator 据此建连） */
  setActiveModel: async (
    modelId: number,
  ): Promise<SetActiveModelPayload> => {
    const mutation = `
      mutation SetActiveModel($modelId: Int!) {
        setActiveModel(modelId: $modelId) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<SetActiveModelPayload>({
      query: mutation,
      variables: { modelId },
    });
  },
};

// ── 系统预置模型管理（system_model_settings 表，管理员 CRUD；用户只读）──

export interface SystemModelItem {
  id: number;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelType: string;
  isDefault: boolean;
  enabled: boolean;
  sortOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SystemModelListPayload {
  systemModels: {
    success: boolean;
    message: string;
    models: SystemModelItem[];
  };
}

export interface SystemModelSaveInput {
  id?: number | null;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelType?: string;
  isDefault?: boolean;
  enabled?: boolean;
  sortOrder?: number;
  testConnection?: boolean;
}

export interface SystemModelMutationPayload {
  saveSystemModel: {
    success: boolean;
    message: string;
    model: SystemModelItem | null;
  };
}

export interface DeleteSystemModelPayload {
  deleteSystemModel: {
    success: boolean;
    message: string;
  };
}

export const systemModelGraphqlApi = {
  /** 列出系统预置模型（管理员） */
  listSystemModels: async (): Promise<SystemModelListPayload> => {
    const query = `
      query SystemModels {
        systemModels {
          success
          message
          models {
            id
            name
            provider
            baseUrl
            apiKey
            modelType
            isDefault
            enabled
            sortOrder
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<SystemModelListPayload>({ query });
  },

  /** 新增/更新系统预置模型（管理员，可选连通性检测） */
  saveSystemModel: async (
    input: SystemModelSaveInput,
  ): Promise<SystemModelMutationPayload> => {
    const mutation = `
      mutation SaveSystemModel($input: SystemModelInput!) {
        saveSystemModel(input: $input) {
          success
          message
          model {
            id
            name
            provider
            baseUrl
            apiKey
            modelType
            isDefault
            enabled
            sortOrder
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<SystemModelMutationPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /** 删除系统预置模型（管理员） */
  deleteSystemModel: async (
    modelId: number,
  ): Promise<DeleteSystemModelPayload> => {
    const mutation = `
      mutation DeleteSystemModel($modelId: Int!) {
        deleteSystemModel(modelId: $modelId) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<DeleteSystemModelPayload>({
      query: mutation,
      variables: { modelId },
    });
  },
};

// ── 用户对系统预置模型的 API Key 映射（per-user key override）──

export interface SystemModelUserMappingItem {
  id: number;
  userId: number;
  systemModelId: number;
  systemModelName?: string | null;
  apiKey: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface SystemModelUserKeyListPayload {
  mySystemModelKeys: {
    success: boolean;
    message: string;
    mappings: SystemModelUserMappingItem[];
  };
}

export interface SystemModelUserKeySaveInput {
  systemModelId: number;
  apiKey: string;
  testConnection?: boolean;
}

export interface SystemModelUserKeyMutationPayload {
  saveSystemModelUserKey: {
    success: boolean;
    message: string;
    mapping: SystemModelUserMappingItem | null;
  };
}

export interface DeleteSystemModelUserKeyPayload {
  deleteSystemModelUserKey: {
    success: boolean;
    message: string;
  };
}

export const systemModelUserKeyGraphqlApi = {
  /** 获取当前用户对系统预置模型的 API Key 映射列表 */
  mySystemModelKeys: async (): Promise<SystemModelUserKeyListPayload> => {
    const query = `
      query MySystemModelKeys {
        mySystemModelKeys {
          success
          message
          mappings {
            id
            userId
            systemModelId
            systemModelName
            apiKey
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<SystemModelUserKeyListPayload>({ query });
  },

  /** 保存当前用户对系统预置模型的个人 API Key */
  saveSystemModelUserKey: async (
    input: SystemModelUserKeySaveInput,
  ): Promise<SystemModelUserKeyMutationPayload> => {
    const mutation = `
      mutation SaveSystemModelUserKey($input: SystemModelUserKeyInput!) {
        saveSystemModelUserKey(input: $input) {
          success
          message
          mapping {
            id
            userId
            systemModelId
            systemModelName
            apiKey
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<SystemModelUserKeyMutationPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /** 删除当前用户对系统预置模型的个人 API Key（回退到全局 key） */
  deleteSystemModelUserKey: async (
    systemModelId: number,
  ): Promise<DeleteSystemModelUserKeyPayload> => {
    const mutation = `
      mutation DeleteSystemModelUserKey($systemModelId: Int!) {
        deleteSystemModelUserKey(systemModelId: $systemModelId) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<DeleteSystemModelUserKeyPayload>({
      query: mutation,
      variables: { systemModelId },
    });
  },
};

// ── 管理员：替指定用户管理系统预置模型的 API Key ──

export interface AdminUserSystemModelKeyListPayload {
  adminListUserSystemModelKeys: {
    success: boolean;
    message: string;
    mappings: SystemModelUserMappingItem[];
  };
}

export interface AdminSystemModelUserKeySaveInput {
  userId: number;
  systemModelId: number;
  apiKey: string;
  testConnection?: boolean;
}

export interface AdminSaveUserSystemModelKeyPayload {
  adminSaveUserSystemModelKey: {
    success: boolean;
    message: string;
    mapping: SystemModelUserMappingItem | null;
  };
}

export interface AdminDeleteUserSystemModelKeyPayload {
  adminDeleteUserSystemModelKey: {
    success: boolean;
    message: string;
  };
}

export const adminSystemModelUserKeyGraphqlApi = {
  /** 管理员：列出指定用户对系统预置模型的 API Key 映射 */
  adminListUserSystemModelKeys: async (
    userId: number,
  ): Promise<AdminUserSystemModelKeyListPayload> => {
    const query = `
      query AdminListUserSystemModelKeys($userId: Int!) {
        adminListUserSystemModelKeys(userId: $userId) {
          success
          message
          mappings {
            id
            userId
            systemModelId
            systemModelName
            apiKey
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<AdminUserSystemModelKeyListPayload>({
      query,
      variables: { userId },
    });
  },

  /** 管理员：为指定用户保存系统预置模型的个人 API Key */
  adminSaveUserSystemModelKey: async (
    input: AdminSystemModelUserKeySaveInput,
  ): Promise<AdminSaveUserSystemModelKeyPayload> => {
    const mutation = `
      mutation AdminSaveUserSystemModelKey($input: AdminSystemModelUserKeyInput!) {
        adminSaveUserSystemModelKey(input: $input) {
          success
          message
          mapping {
            id
            userId
            systemModelId
            systemModelName
            apiKey
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<AdminSaveUserSystemModelKeyPayload>({
      query: mutation,
      variables: { input },
    });
  },

  /** 管理员：删除指定用户对系统预置模型的个人 API Key */
  adminDeleteUserSystemModelKey: async (
    userId: number,
    systemModelId: number,
  ): Promise<AdminDeleteUserSystemModelKeyPayload> => {
    const mutation = `
      mutation AdminDeleteUserSystemModelKey($userId: Int!, $systemModelId: Int!) {
        adminDeleteUserSystemModelKey(userId: $userId, systemModelId: $systemModelId) {
          success
          message
        }
      }
    `;
    return graphqlClient.request<AdminDeleteUserSystemModelKeyPayload>({
      query: mutation,
      variables: { userId, systemModelId },
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

// ── Markdown 提示词库 ──

// 提示词记录类型（与后端 MarkdownPromptType 对应）
export interface MarkdownPromptItem {
  id: number;
  filename: string;
  noteName: string | null;
  content: string;
  isActive: boolean;
  charCount: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ListMarkdownPromptsPayload {
  listMarkdownPrompts: {
    success: boolean;
    message: string;
    prompts: MarkdownPromptItem[];
  };
}

export interface ActiveMarkdownPromptPayload {
  getActiveMarkdownPrompt: {
    success: boolean;
    message: string;
    prompt: MarkdownPromptItem | null;
  };
}

export interface SelectMarkdownPromptPayload {
  selectMarkdownPrompt: {
    success: boolean;
    message: string;
    prompt: MarkdownPromptItem | null;
  };
}

export interface DeleteMarkdownPromptPayload {
  deleteMarkdownPrompt: {
    success: boolean;
    message: string;
    prompt: MarkdownPromptItem | null;
  };
}

export interface RenameMarkdownPromptPayload {
  renameMarkdownPrompt: {
    success: boolean;
    message: string;
    prompt: MarkdownPromptItem | null;
  };
}

export interface UpdateMarkdownContentPayload {
  updateMarkdownContent: {
    success: boolean;
    message: string;
    prompt: MarkdownPromptItem | null;
  };
}

/**
 * 提示词库 GraphQL API
 */
export const promptGraphqlApi = {
  /** 列出当前用户的全部 Markdown 提示词 */
  listPrompts: async (
    signal?: AbortSignal,
  ): Promise<ListMarkdownPromptsPayload> => {
    const query = `
      query ListMarkdownPrompts {
        listMarkdownPrompts {
          success
          message
          prompts {
            id
            filename
            noteName
            content
            isActive
            charCount
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<ListMarkdownPromptsPayload>({ query }, signal);
  },

  /** 获取当前用户选中的提示词 */
  getActivePrompt: async (): Promise<ActiveMarkdownPromptPayload> => {
    const query = `
      query GetActiveMarkdownPrompt {
        getActiveMarkdownPrompt {
          success
          message
          prompt {
            id
            filename
            noteName
            content
            isActive
            charCount
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<ActiveMarkdownPromptPayload>({ query });
  },

  /** 选中一个提示词作为当前提示词 */
  selectPrompt: async (
    promptId: number,
  ): Promise<SelectMarkdownPromptPayload> => {
    const mutation = `
      mutation SelectMarkdownPrompt($promptId: Int!) {
        selectMarkdownPrompt(promptId: $promptId) {
          success
          message
          prompt {
            id
            filename
            noteName
            content
            isActive
            charCount
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<SelectMarkdownPromptPayload>({
      query: mutation,
      variables: { promptId },
    });
  },

  /** 删除一个提示词 */
  deletePrompt: async (
    promptId: number,
  ): Promise<DeleteMarkdownPromptPayload> => {
    const mutation = `
      mutation DeleteMarkdownPrompt($promptId: Int!) {
        deleteMarkdownPrompt(promptId: $promptId) {
          success
          message
          prompt {
            id
          }
        }
      }
    `;
    return graphqlClient.request<DeleteMarkdownPromptPayload>({
      query: mutation,
      variables: { promptId },
    });
  },

  /** 更新提示词的备注名称（传 null 或空串清空备注，回退展示 filename） */
  renamePrompt: async (
    promptId: number,
    noteName: string | null,
  ): Promise<RenameMarkdownPromptPayload> => {
    const mutation = `
      mutation RenameMarkdownPrompt($promptId: Int!, $noteName: String) {
        renameMarkdownPrompt(promptId: $promptId, noteName: $noteName) {
          success
          message
          prompt {
            id
            filename
            noteName
            content
            isActive
            charCount
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<RenameMarkdownPromptPayload>({
      query: mutation,
      variables: { promptId, noteName },
    });
  },

  /** 更新提示词的 Markdown 正文内容（编辑功能） */
  updateContent: async (
    promptId: number,
    content: string,
  ): Promise<UpdateMarkdownContentPayload> => {
    const mutation = `
      mutation UpdateMarkdownContent($promptId: Int!, $content: String!) {
        updateMarkdownContent(promptId: $promptId, content: $content) {
          success
          message
          prompt {
            id
            filename
            noteName
            content
            isActive
            charCount
            createdAt
            updatedAt
          }
        }
      }
    `;
    return graphqlClient.request<UpdateMarkdownContentPayload>({
      query: mutation,
      variables: { promptId, content },
    });
  },
};

// ── 用量统计（流量统计面板）──

export interface UsageDailyItem {
  date: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageModelBreakdownItem {
  modelName: string;
  requestCount: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageStatsPayload {
  usageStats: {
    success: boolean;
    message: string;
    days: number;
    daily: UsageDailyItem[];
    byModel: UsageModelBreakdownItem[];
    totalRequests: number;
    totalTokens: number;
    totalCostUsd: number;
  };
}

export const usageGraphqlApi = {
  /** 获取当前用户近 N 天的用量统计（按日 + 按模型聚合） */
  getUsageStats: async (days: number = 30): Promise<UsageStatsPayload> => {
    const query = `
      query UsageStats($days: Int!) {
        usageStats(days: $days) {
          success
          message
          days
          daily {
            date
            requestCount
            inputTokens
            outputTokens
            totalTokens
            costUsd
          }
          byModel {
            modelName
            requestCount
            totalTokens
            costUsd
          }
          totalRequests
          totalTokens
          totalCostUsd
        }
      }
    `;
    return graphqlClient.request<UsageStatsPayload>({
      query,
      variables: { days },
    });
  },
};
