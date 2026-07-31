/**
 * HTTP 客户端
 * 统一管理所有 HTTP 请求
 */

import { API_BASE_URL } from "@/utils/config";

interface RequestConfig {
  headers?: Record<string, string>;
  params?: Record<string, string | number | boolean>;
}

interface PostConfig extends RequestConfig {
  body?: any;
}

/**
 * HTTP 客户端类
 * 提供统一的 HTTP 请求方法
 */
class HttpClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * 构建 URL
   */
  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean>): string {
    const url = new URL(`${this.baseUrl}${endpoint}`);
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, String(value));
      });
    }
    return url.toString();
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
   * GET 请求
   */
  async get<T = any>(endpoint: string, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(endpoint, config?.params);
    const response = await fetch(url, {
      method: "GET",
      headers: { ...this.getDefaultHeaders(), ...config?.headers },
    });

    return this.handleResponse<T>(response);
  }

  /**
   * POST 请求
   */
  async post<T = any>(endpoint: string, config?: PostConfig): Promise<T> {
    const url = this.buildUrl(endpoint, config?.params);
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this.getDefaultHeaders(), ...config?.headers },
      body: JSON.stringify(config?.body),
    });

    return this.handleResponse<T>(response);
  }

  /**
   * PUT 请求
   */
  async put<T = any>(endpoint: string, config?: PostConfig): Promise<T> {
    const url = this.buildUrl(endpoint, config?.params);
    const response = await fetch(url, {
      method: "PUT",
      headers: { ...this.getDefaultHeaders(), ...config?.headers },
      body: JSON.stringify(config?.body),
    });

    return this.handleResponse<T>(response);
  }

  /**
   * DELETE 请求
   */
  async delete<T = any>(endpoint: string, config?: RequestConfig): Promise<T> {
    const url = this.buildUrl(endpoint, config?.params);
    const response = await fetch(url, {
      method: "DELETE",
      headers: { ...this.getDefaultHeaders(), ...config?.headers },
    });

    return this.handleResponse<T>(response);
  }

  /**
   * 处理响应
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: "请求失败" }));
      throw new Error(error.message || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}

// 导出 HTTP 客户端实例
export const http = new HttpClient();

// 导出类，以便创建自定义实例
export { HttpClient };
