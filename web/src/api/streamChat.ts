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
    | "sql_explanation" // TASK-015：SQL 自然语言阐述气泡（独立于审核状态）
    | "sql_approval"
    | "sql_rejected"
    | "sql_cancelled"
    | "security_block" // 安全机制拦截（受保护表/列、危险 SQL）
    | "tool_call" // General Agent 工具调用通知（TASK-004）
    | "result"
    | "chart"
    | "done"
    | "error";
  content?: string | null;
  modelUsed?: string | null;
  conversationId?: string | null;
  sql?: string | null;
  sqlMeaning?: string | null;
  columns?: string[] | null;
  data?: Record<string, unknown>[] | null;
  rowCount?: number | null;
  chartConfig?: ChartConfig | null;
  /** 安全拦截标记：true 表示此 chunk 为安全机制拒绝执行后的告警 */
  securityBlock?: boolean | null;
  /** 工具名称：tool_call chunk 携带，标识当前调用的工具 */
  toolName?: string | null;
  /** 工具输出摘要：tool_call end chunk 携带，便于前端展示简短结果 */
  toolOutput?: string | null;
  /** 本轮输入 token 数：done chunk 携带（模型未返回用量时为 null） */
  inputTokens?: number | null;
  /** 本轮输出 token 数：done chunk 携带（模型未返回用量时为 null） */
  outputTokens?: number | null;
}

export interface ChartConfig {
  type: "bar" | "line" | "pie" | "area" | "scatter";
  x_column: string;
  y_columns: string[];
  title?: string;
  /** 后端意图分析：用户分析目的（trend/comparison/distribution/...） */
  intent?: string;
  /** 后端意图分析：为何选此图表的一句话理由 */
  reason?: string;
}

/** 数据视图模式：表格 / 图表。ResultView 用于切换。 */
export type ResultViewMode = "auto" | "table" | "chart";

// 流式聊天请求参数
export interface StreamChatParams {
  query: string;
  modelType?: string;
  modelName?: string | null;
  agentType?: string | null; // Agent 类型: general/sql/code
  dbName?: string | null;
  conversationId?: string | null;
  context?: string[] | null;
  /** 用户在前端点击取消提示词时置 true；为 true 时本轮不注入 Markdown 提示词 */
  promptDisabled?: boolean;
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
      window.location.href = "/f/010/user-login";
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
      promptDisabled = false,
      onChunk,
      onError,
      onComplete,
    } = params;

    // 创建 AbortController 用于取消请求
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // 构建 GraphQL Subscription 查询
    // TASK-015：补齐 sql/sqlMeaning/columns/data/rowCount/chartConfig/securityBlock/
    // toolName/toolOutput 字段——之前只查 4 个字段，导致审核气泡的 sql、SQL 阐述气泡的
    // sqlMeaning、result chunk 的数据、chart 配置等全部丢失。
    const graphqlQuery = `
      subscription StreamChat($query: String!, $modelType: String, $modelName: String, $agentType: String, $dbName: String, $conversationId: String, $context: [String!], $promptDisabled: Boolean) {
        streamChat(query: $query, modelType: $modelType, modelName: $modelName, agentType: $agentType, dbName: $dbName, conversationId: $conversationId, context: $context, promptDisabled: $promptDisabled) {
          type
          content
          modelUsed
          conversationId
          sql
          sqlMeaning
          columns
          data
          rowCount
          chartConfig
          securityBlock
          toolName
          toolOutput
          inputTokens
          outputTokens
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
      promptDisabled,
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
        throw new Error("Unauthorized. Please sign in again.");
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
                // TASK-015：转发后端 StreamChunkType 全部字段，
                // 特别是 sqlMeaning（sql_explanation/sql_approval/sql_generated 携带）、
                // sql（审核气泡需要）、columns/data/rowCount/chartConfig（result/chart chunk）。
                let parsedData: Record<string, unknown>[] | null = null;
                if (streamChat.data) {
                  try {
                    parsedData =
                      typeof streamChat.data === "string"
                        ? JSON.parse(streamChat.data)
                        : streamChat.data;
                  } catch {
                    parsedData = null;
                  }
                }
                let parsedChartConfig: ChartConfig | null = null;
                if (streamChat.chartConfig) {
                  try {
                    parsedChartConfig =
                      typeof streamChat.chartConfig === "string"
                        ? JSON.parse(streamChat.chartConfig)
                        : streamChat.chartConfig;
                  } catch {
                    parsedChartConfig = null;
                  }
                }
                // TASK-015: onChunk 单独 try/catch，防止回调异常吞掉 done/error
                // 终止信号——之前整个块被外层 catch 静默吞掉，导致 isTyping 永远 true。
                try {
                  onChunk({
                    type: streamChat.type,
                    content: streamChat.content,
                    modelUsed: streamChat.modelUsed,
                    conversationId: streamChat.conversationId,
                    sql: streamChat.sql ?? null,
                    sqlMeaning: streamChat.sqlMeaning ?? null,
                    columns: streamChat.columns ?? null,
                    data: parsedData,
                    rowCount: streamChat.rowCount ?? null,
                    chartConfig: parsedChartConfig,
                    securityBlock: streamChat.securityBlock ?? null,
                    toolName: streamChat.toolName ?? null,
                    toolOutput: streamChat.toolOutput ?? null,
                    inputTokens: streamChat.inputTokens ?? null,
                    outputTokens: streamChat.outputTokens ?? null,
                  });
                } catch (e) {
                  console.error("onChunk callback threw:", e);
                }

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
        onComplete?.();
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
    this.abortController = new AbortController();
    const { signal } = this.abortController;

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
        throw new Error("Unauthorized. Please sign in again.");
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
                sqlMeaning: data.sql_meaning,
                columns: data.columns,
                data: data.data
                  ? typeof data.data === "string"
                    ? JSON.parse(data.data)
                    : data.data
                  : null,
                rowCount: data.row_count,
                chartConfig: data.chart_config
                  ? typeof data.chart_config === "string"
                    ? JSON.parse(data.chart_config)
                    : data.chart_config
                  : null,
                securityBlock: data.security_block ?? null,
                inputTokens: data.input_tokens ?? null,
                outputTokens: data.output_tokens ?? null,
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
        params.onComplete?.();
        return () => {};
      }
      console.error("SQL approval error:", error);
      params.onChunk({
        type: "error",
        content: (error as Error).message || "Unknown error",
      });
      params.onError?.(error as Error);
    }

    return () => this.abort();
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
