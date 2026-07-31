/**
 * 流式聊天 API 客户端
 * 使用 GraphQL Subscription over SSE 实现流式响应
 */

import { BASE_URL } from "@/utils/config";

// 流式响应块类型
export interface StreamChunk {
  type:
    | "intent"
    | "start"
    | "thinking"
    | "info"
    | "content"
    | "sql_generated"
    | "sql_approval"
    | "sql_rejected"
    | "sql_cancelled"
    | "done"
    | "error";
  content?: string | null;
  modelUsed?: string | null;
  conversationId?: string | null;
  sql?: string | null;
}

// 流式聊天请求参数
export interface StreamChatParams {
  query: string;
  modelType?: string;
  modelName?: string | null;
  agentType?: string | null; // Agent 类型: general/sql/code
  dbName?: string | null;
  conversationId?: string | null;
  context?: string[] | null;
  onChunk: (chunk: StreamChunk) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
}

// 流式聊天客户端类
class StreamChatClient {
  private abortController: AbortController | null = null;

  /**
   * 获取 GraphQL 流式订阅 URL
   */
  private getStreamUrl(): string {
    return `${BASE_URL}/b/id_x_010/graphql/stream`;
  }

  /**
   * 处理 401 未授权响应
   */
  private handleUnauthorized(): void {
    if (typeof window !== "undefined") {
      // 清除本地存储的 token
      localStorage.removeItem("token");
      localStorage.removeItem("expires_at");
      localStorage.removeItem("user");

      // 重定向到登录页面
      window.location.href = "/f/login";
    }
  }

  /**
   * 获取认证 token
   */
  private getToken(): string | null {
    if (typeof window !== "undefined") {
      return localStorage.getItem("token");
    }
    return null;
  }

  /**
   * 执行流式聊天
   */
  async streamChat(params: StreamChatParams): Promise<() => void> {
    const {
      query,
      modelType = "external",
      modelName = null,
      agentType = null,
      dbName = null,
      conversationId = null,
      context = null,
      onChunk,
      onError,
      onComplete,
    } = params;

    // 创建 AbortController 用于取消请求
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // 构建 GraphQL Subscription 查询
    const graphqlQuery = `
      subscription StreamChat($query: String!, $modelType: String, $modelName: String, $agentType: String, $dbName: String, $conversationId: String, $context: [String!]) {
        streamChat(query: $query, modelType: $modelType, modelName: $modelName, agentType: $agentType, dbName: $dbName, conversationId: $conversationId, context: $context) {
          type
          content
          modelUsed
          conversationId
        }
      }
    `;

    const variables = {
      query,
      modelType,
      modelName,
      agentType,
      dbName,
      conversationId,
      context,
    };

    try {
      const response = await fetch(this.getStreamUrl(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.getToken()
            ? { Authorization: `Bearer ${this.getToken()}` }
            : {}),
        },
        body: JSON.stringify({
          query: graphqlQuery,
          variables,
          operationName: "StreamChat",
        }),
        signal,
      });

      // 检查 401 未授权响应
      if (response.status === 401) {
        this.handleUnauthorized();
        throw new Error("未授权访问，请重新登录");
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Response body is not readable");
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 数据
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));

              // 检查是否是完成事件
              if (data.complete) {
                onComplete?.();
                return () => {};
              }

              // 检查是否有错误
              if (data.errors) {
                const errorMessage = data.errors
                  .map((e: { message: string }) => e.message)
                  .join(", ");
                onChunk({
                  type: "error",
                  content: errorMessage,
                });
                onError?.(new Error(errorMessage));
                return () => {};
              }

              // 解析 GraphQL 响应数据
              const streamChat = data.data?.streamChat;
              if (streamChat) {
                onChunk({
                  type: streamChat.type,
                  content: streamChat.content,
                  modelUsed: streamChat.modelUsed,
                  conversationId: streamChat.conversationId,
                });

                // 如果是完成或错误事件，结束处理
                if (streamChat.type === "done" || streamChat.type === "error") {
                  onComplete?.();
                  return () => {};
                }
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
          }
        }
      }

      onComplete?.();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        console.log("Stream chat aborted");
        return () => {};
      }
      console.error("Stream chat error:", error);
      onChunk({
        type: "error",
        content: (error as Error).message || "Unknown error",
      });
      onError?.(error as Error);
    }

    // 返回取消函数
    return () => {
      this.abort();
    };
  }

  /**
   * Submit SQL approval decision
   */
  async sqlApproval(params: {
    conversationId: string;
    sql: string;
    action: "approve" | "reject" | "cancel";
    question: string;
    modelType?: string;
    modelName?: string | null;
    dbName?: string | null;
    onChunk: (chunk: StreamChunk) => void;
    onError?: (error: Error) => void;
    onComplete?: () => void;
  }): Promise<() => void> {
    const abortController = new AbortController();
    const { signal } = abortController;

    const baseUrl = BASE_URL.replace(/\/graphql.*$/, "");
    const url = `${baseUrl}/b/id_x_010/sql-approval`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.getToken()
            ? { Authorization: `Bearer ${this.getToken()}` }
            : {}),
        },
        body: JSON.stringify({
          conversation_id: params.conversationId,
          sql: params.sql,
          action: params.action,
          question: params.question,
          model_type: params.modelType || "external",
          model_name: params.modelName || null,
          db_name: params.dbName || null,
        }),
        signal,
      });

      if (response.status === 401) {
        this.handleUnauthorized();
        throw new Error("未授权访问，请重新登录");
      }

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("Response body is not readable");
      }

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              params.onChunk({
                type: data.type,
                content: data.content,
                modelUsed: data.model_used,
                conversationId: data.conversation_id,
                sql: data.sql,
              });

              if (
                data.type === "done" ||
                data.type === "error" ||
                data.type === "sql_cancelled"
              ) {
                params.onComplete?.();
                return () => {};
              }
            } catch (e) {
              console.error("Failed to parse SSE data:", e);
            }
          }
        }
      }

      params.onComplete?.();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return () => {};
      }
      console.error("SQL approval error:", error);
      params.onChunk({
        type: "error",
        content: (error as Error).message || "Unknown error",
      });
      params.onError?.(error as Error);
    }

    return () => abortController.abort();
  }

  /**
   * 取消当前请求
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

// 导出流式聊天客户端实例
export const streamChatClient = new StreamChatClient();
