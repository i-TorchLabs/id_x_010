/**
 * 用户相关 API 接口
 */

import { http } from "./http";

// 用户登录接口参数
export interface LoginParams {
  username: string;
  password: string;
}

// 用户注册接口参数
export interface RegisterParams {
  username: string;
  password: string;
  email?: string;
  phone?: string;
}

// 用户信息
export interface UserInfo {
  id: number;
  username: string;
  email: string | null;
  phone: string | null;
  ai_api_key: string | null;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
}

// 登录响应
export interface LoginResponse {
  token: string;
  user: UserInfo;
}

// 注册响应
export interface RegisterResponse {
  user_id: number;
  username: string;
}

/**
 * 用户 API
 */
export const userApi = {
  /**
   * 用户登录
   */
  login: async (params: LoginParams): Promise<LoginResponse> => {
    return http.post<LoginResponse>("/login", { body: params });
  },

  /**
   * 用户注册
   */
  register: async (params: RegisterParams): Promise<RegisterResponse> => {
    return http.post<RegisterResponse>("/register", { body: params });
  },

  /**
   * 用户登出
   */
  logout: async (token: string): Promise<{ success: boolean; message: string }> => {
    return http.post("/logout", { body: { token } });
  },

  /**
   * 获取用户信息
   */
  getProfile: async (): Promise<UserInfo> => {
    return http.get<UserInfo>("/profile");
  },

  /**
   * 根据 ID 获取用户信息
   */
  getUserById: async (userId: number): Promise<UserInfo> => {
    return http.get<UserInfo>(`/users/${userId}`);
  },
};
