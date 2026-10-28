"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { CenterHero } from "@/components/chat/CenterHero";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ModelSettingsDialog } from "@/components/chat/ModelSettingsDialog";
import { UsageStatsDialog } from "@/components/chat/UsageStatsDialog";
import { ProfileDialog } from "@/components/chat/ProfileDialog";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LangToggle } from "@/components/LangToggle";
import { useI18n } from "@/context/I18nContext";
import { motion } from "framer-motion";
import { streamChatClient, StreamChunk } from "@/api/streamChat";
import { AgentType } from "@/components/chat/AgentSelector";
import {
  userGraphqlApi,
  ModelInfo,
  modelGraphqlApi,
  MarkdownPromptItem,
  type User,
} from "@/api/graphql";
import { AlertDialog, Button } from "@heroui/react";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import {
  clearSsoLoginFlag,
  isSsoLogin,
  redirectToAdfsLogout,
} from "@/utils/sso";

type ChatMessage = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string; // 思考过程
  thinkingTime?: number; // 思考时间（秒）
  modelUsed?: string; // 使用的模型
  pendingSql?: string; // SQL waiting for approval
  sqlMeaning?: string; // SQL 的一句话自然语言含义
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled"; // approval status
  contentType?: "sql"; // when set to "sql", content is SQL code
  resultColumns?: string[]; // SQL 查询结果列
  resultData?: Record<string, unknown>[]; // SQL 查询结果行（≤512）
  resultRowCount?: number; // 总行数（可能 > resultData.length）
  chartConfig?: {
    type: "bar" | "line" | "pie" | "area" | "scatter";
    x_column: string;
    y_columns: string[];
    title?: string;
    intent?: string;
    reason?: string;
  }; // 图表配置（后端深度意图识别后主动推荐）
  /** 安全拦截告警：保护机制触发后由后端 security_block chunk 注入 */
  securityBlock?: {
    reason: string; // 拒绝原因
    sql?: string;   // 被拒绝的 SQL（若有）
  };
  /** General Agent 工具调用记录（TASK-004）：按顺序展示每个工具的执行状态 */
  toolCalls?: {
    name: string;       // 工具名
    status: "running" | "done"; // 状态
    output?: string;    // 工具输出摘要（done 时填充）
  }[];
  /** TASK-017：反馈按钮定位所需——会话 ID 与消息序号 */
  conversationId?: string;
  index?: number;
  /** 本轮输入 token 数（done chunk 携带；模型未返回用量时为 undefined） */
  inputTokens?: number;
  /** 本轮输出 token 数（done chunk 携带；模型未返回用量时为 undefined） */
  outputTokens?: number;
};

function SidebarToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-50 flex items-center justify-center"
      style={{
        width: "22px",
        height: "22px",
        borderRadius: "8px",
        background: "var(--surface-2)",
        border: "0.5px solid var(--divider-strong)",
        color: "var(--fg2)",
        boxShadow: "var(--shadow-inset), var(--shadow-md)",
      }}
    >
      <motion.svg
        className="w-3 h-3"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        animate={{ rotate: open ? 0 : 180 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <path d="M15 18l-6-6 6-6" />
      </motion.svg>
    </motion.button>
  );
}
// NOTE: SidebarToggle is no longer used — the ChatSidebar component now handles
// collapse/expand internally via isCollapsed + onToggleCollapse props.
// Keeping the import-compatible shape in case IntelligentQueryHome still references it.

export default function ChatHome() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isSqlProcessing, setIsSqlProcessing] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<AgentType>("general");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  // 当前用户选中的 Markdown 提示词（每轮对话由后端自动注入为系统提示词）
  const [activePrompt, setActivePrompt] = useState<MarkdownPromptItem | null>(
    null,
  );
  // 用户主动取消提示词注入：默认 false（携带）；切换 activePrompt 时自动复位。
  // 三种 Agent 模式 + 自动路由均默认携带；用户在 MessageInput 徽标上点 × 后置 true。
  const [promptDismissed, setPromptDismissed] = useState(false);
  useEffect(() => {
    // 切换提示词（含置空）时复位取消状态，让新提示词默认携带
    setPromptDismissed(false);
  }, [activePrompt?.id]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 加载模型列表（应用级别，初次加载 + 设置保存后刷新复用）
  const reloadModels = useCallback(
    async (opts?: { forceReselect?: boolean }) => {
      const MAX_RETRIES = 5;
      const BASE_DELAY = 1000; // 基础重试延迟
      const REQUEST_TIMEOUT = 10000; // 10秒超时

      const loadModels = async (attempt = 0) => {
        setIsLoadingModels(true);
        let retrying = false;
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

          try {
            const response = await modelGraphqlApi.getModels(controller.signal);
            clearTimeout(timeoutId);
            if (response.getModels.success) {
              const list = response.getModels.models;
              setModels(list);
              setSelectedModel((prev) => {
                // 设置保存后（forceReselect）或之前未选中时，按 is_default / 首项重选
                if (opts?.forceReselect || prev === null) {
                  if (list.length === 0) return null;
                  return list.find((m) => m.isDefault) ?? list[0];
                }
                // 之前选中的模型若仍在新列表中则保留
                if (prev && list.some((m) => m.name === prev.name)) return prev;
                return list.find((m) => m.isDefault) ?? list[0] ?? null;
              });
            } else if (attempt < MAX_RETRIES) {
              const delay = BASE_DELAY * Math.pow(2, attempt);
              console.warn(
                `Failed to load models (attempt ${attempt + 1}): ${response.getModels.message}; retrying in ${delay}ms`,
              );
              retrying = true;
              setTimeout(() => loadModels(attempt + 1), delay);
              return;
            }
          } catch (fetchError) {
            clearTimeout(timeoutId);
            throw fetchError;
          }
        } catch (error) {
          if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt);
            console.warn(
              `Model list load error (attempt ${attempt + 1}); retrying in ${delay}ms:`,
              error,
            );
            retrying = true;
            setTimeout(() => loadModels(attempt + 1), delay);
            return;
          }
          console.error("Final model list load failure:", error);
        } finally {
          if (!retrying) {
            setIsLoadingModels(false);
          }
        }
      };

      await loadModels();
    },
    [],
  );

  useEffect(() => {
    void reloadModels();
  }, [reloadModels]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = useCallback(
    (
      content: string,
      selectedModel?: any,
      agentType?: AgentType,
      dbName?: string | null,
      promptDisabled?: boolean,
    ) => {
      if (!content.trim()) return;

      const userMessage: ChatMessage = {
        id: String(Date.now()),
        type: "user",
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsTyping(true);

      // 创建 AI 回复消息的占位符
      const assistantMessageId = String(Date.now() + 1);
      const assistantMessageIndex = messages.length + 1; // 占位 user 消息已经 push 进去后的下一条
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        type: "assistant",
        content: "",
        timestamp: new Date(),
        thinking: "",
        modelUsed: "",
        // TASK-017：反馈按钮定位所需——conversation_id 后续 chunk 回填时同步更新
        conversationId: currentConversationId || undefined,
        index: assistantMessageIndex,
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // 用于累积思考过程和回复内容
      let thinkingBuffer = "";
      let sqlBuffer = "";
      let contentBuffer = "";
      let modelUsed = "";
      // 请求发出时刻：用于计算"用时"（= 用户发起到最后响应的总时长）
      const requestStartTime = Date.now();
      let isFirstContent = true;
      let responseMessageId: string | null = null; // 第二个气泡的ID

      // 调用流式聊天 API
      streamChatClient.streamChat({
        query: content.trim(),
        modelType: selectedModel?.modelType,
        modelName: selectedModel?.name,
        agentType: agentType, // 传递 Agent 类型
        dbName: dbName,
        conversationId: currentConversationId,
        promptDisabled,
        onChunk: (chunk: StreamChunk) => {
          switch (chunk.type) {
            case "intent":
              // 意图识别，可以显示或隐藏
              break;

            case "tool_call": {
              // General Agent 工具调用通知（TASK-004）
              // 仅展示用：把状态卡追加到当前 assistant 消息
              const toolName = chunk.toolName || "";
              const toolOutput = chunk.toolOutput || "";
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMessageId) return msg;
                  const list = msg.toolCalls ? [...msg.toolCalls] : [];
                  if (toolOutput) {
                    // tool_end：把同名 running 项改为 done 并附 output
                    const idx = list.findIndex(
                      (t) => t.name === toolName && t.status === "running",
                    );
                    if (idx >= 0) {
                      list[idx] = { ...list[idx], status: "done", output: toolOutput };
                    } else {
                      list.push({ name: toolName, status: "done", output: toolOutput });
                    }
                  } else {
                    list.push({ name: toolName, status: "running" });
                  }
                  return { ...msg, toolCalls: list };
                }),
              );
              break;
            }

            case "thinking":
              // 思考过程
              if (chunk.content) {
                thinkingBuffer += chunk.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          thinking: thinkingBuffer,
                        }
                      : msg,
                  ),
                );
              }
              break;

            case "sql_generated":
              // SQL 内容累积到第一个气泡
              if (chunk.content) {
                sqlBuffer += chunk.content;
                if (chunk.modelUsed) {
                  modelUsed = chunk.modelUsed;
                }
                if (chunk.conversationId) {
                  setCurrentConversationId(chunk.conversationId);
                  // TASK-017：同步给消息本身，供 FeedbackBar 用。
                  // chunk.conversationId 类型为 string | null，这里 if 已保证非空，
                  // 但 TS 推断不到，显式 String() 转一次保证类型稳定
                  const cid = String(chunk.conversationId);
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId
                        ? { ...msg, conversationId: cid }
                        : msg,
                    ),
                  );
                }
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: sqlBuffer,
                          contentType: "sql" as const,
                          modelUsed: modelUsed,
                          sqlMeaning: chunk.sqlMeaning || undefined,
                        }
                      : msg,
                  ),
                );
              }
              break;

            case "content":
              // 自然语言回复内容 - 统一复用第一个气泡
              if (chunk.content) {
                if (isFirstContent) {
                  isFirstContent = false;

                  // 统一复用第一个气泡，不再创建第二个气泡
                  responseMessageId = assistantMessageId;

                  // 如果第一个气泡已包含 SQL 内容，将 contentType 切换回普通文本
                  setMessages((prev) =>
                    prev.map((msg) =>
                      msg.id === assistantMessageId && msg.contentType === "sql"
                        ? { ...msg, contentType: undefined }
                        : msg,
                    ),
                  );
                }

                contentBuffer += chunk.content;
                if (chunk.modelUsed) {
                  modelUsed = chunk.modelUsed;
                }
                if (chunk.conversationId) {
                  setCurrentConversationId(chunk.conversationId);
                }

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === responseMessageId
                      ? {
                          ...msg,
                          content: contentBuffer,
                          modelUsed: modelUsed,
                        }
                      : msg,
                  ),
                );
              }
              break;

            case "sql_approval":
              // SQL needs user approval - 在第一个气泡(SQL气泡)上显示
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        pendingSql: chunk.sql || chunk.content || "",
                        sqlMeaning: chunk.sqlMeaning || undefined,
                        sqlApprovalStatus: "pending" as const,
                        thinkingTime: Math.max(
                          0.1,
                          Math.round((Date.now() - requestStartTime) / 100) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              setIsTyping(false);
              break;

            case "sql_explanation":
              // TASK-015：SQL 自然语言"阐述气泡"——独立于审核状态。
              // 后端在 sql_approval / sql_generated 之后立即发送，
              // 以及 continue_with_approval approved=True 开头重发。
              // 这里只更新 sqlMeaning，不动 pendingSql/sqlApprovalStatus，
              // 让阐述气泡在审核通过/拒绝/取消后仍能保留显示。
              if (chunk.sqlMeaning) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? { ...msg, sqlMeaning: chunk.sqlMeaning || undefined }
                      : msg,
                  ),
                );
              }
              break;

            case "sql_rejected":
              // 后端 continue_with_approval(approved=False) 开头发出，
              // 表示用户拒绝了 SQL，正在重新生成。当前 content 已带提示文案，
              // 这里仅做状态信号——真正的 pendingSql 在随后的 sql_approval 来时刷新。
              setIsSqlProcessing(true);
              break;

            case "sql_cancelled":
              // 后端 sql_approval(action=cancel) 终止 chunk。
              setIsTyping(false);
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        sqlApprovalStatus: "cancelled" as const,
                        pendingSql: undefined,
                        content: chunk.content || t("chat.messageQueryCancelled"),
                      }
                    : msg,
                ),
              );
              break;

            case "result":
              // SQL 查询结果（表格数据）
              // TASK-015：用 ?? 替代 ||，避免空数组 [] / 行数 0 被吞为 undefined，
              // 导致 ResultView 不渲染。空结果也应展示"查询结果为空"。
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        resultColumns: chunk.columns ?? undefined,
                        resultData: chunk.data ?? undefined,
                        resultRowCount: chunk.rowCount ?? undefined,
                      }
                    : msg,
                ),
              );
              break;

            case "chart":
              // 图表配置（用户要求可视化时由后端 LLM 生成）
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        chartConfig: chunk.chartConfig || undefined,
                      }
                    : msg,
                ),
              );
              break;

            case "done":
              // 完成：用时 = 用户发起到 done 的总时长（保留 1 位小数，下限 0.1s）。
              // done chunk 还携带本轮 token 用量（LLM usage_metadata），一并回填。
              setIsTyping(false);
              {
                const totalTime = Math.max(
                  0.1,
                  Math.round((Date.now() - requestStartTime) / 100) / 10,
                );
                // 上游网关可能中途掀断流（实测只收到 "<thin" 残片就 done），
                // 此时既无正文也无有效 thinking/SQL——给出明确提示而非空白气泡
                const isEmptyResponse =
                  isFirstContent &&
                  !sqlBuffer &&
                  !thinkingBuffer.trim() &&
                  !contentBuffer.trim();
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === (responseMessageId || assistantMessageId)
                      ? {
                          ...msg,
                          ...(isEmptyResponse &&
                          !msg.pendingSql &&
                          !msg.resultData &&
                          !msg.content
                            ? { content: t("chat.errorEmptyResponse") }
                            : {}),
                          ...(chunk.inputTokens != null ||
                          chunk.outputTokens != null
                            ? {
                                inputTokens: chunk.inputTokens ?? undefined,
                                outputTokens: chunk.outputTokens ?? undefined,
                              }
                            : {}),
                          thinkingTime: totalTime,
                        }
                      : msg,
                  ),
                );
              }
              break;

            case "security_block":
              // 安全机制拦截：保护表/列、危险 SQL 等被拒——以独立红色告警呈现
              // 区别于 "error"（LLM 调用失败等系统错误），此 chunk 由后端在
              // SQL 被拒绝执行后显式发送，附 securityBlock=true 标记
              setIsTyping(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        securityBlock: {
                          reason: chunk.content || t("chat.errorSqlBlocked"),
                          sql: chunk.sql || undefined,
                        },
                        thinkingTime: Math.max(
                          0.1,
                          Math.round((Date.now() - requestStartTime) / 100) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;

            case "error":
              // 错误：除回填文案外必须清掉 contentType——若本轮已经过
              // sql_generated（contentType="sql"），不清会把错误文本渲染进
              // SQL 代码块，出现“报错显示在 SQL 框里”的问题。
              setIsTyping(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === (responseMessageId || assistantMessageId)
                    ? {
                        ...msg,
                        content:
                          chunk.content ||
                          t("chat.errorGeneric"),
                        contentType: undefined,
                        thinkingTime: Math.max(
                          0.1,
                          Math.round((Date.now() - requestStartTime) / 100) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;
          }
        },
        onError: (error: Error) => {
          console.error("Stream chat error:", error);
          setIsTyping(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === (responseMessageId || assistantMessageId)
                ? {
                    ...msg,
                    content:
                      t("chat.errorConnectionFailed"),
                    thinkingTime: Math.max(
                      0.1,
                      Math.round((Date.now() - requestStartTime) / 100) / 10,
                    ),
                  }
                : msg,
            ),
          );
        },
        onComplete: () => {
          setIsTyping(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === (responseMessageId || assistantMessageId) &&
              msg.thinkingTime == null
                ? {
                    ...msg,
                    thinkingTime: Math.max(
                      0.1,
                      Math.round((Date.now() - requestStartTime) / 100) / 10,
                    ),
                  }
                : msg,
            ),
          );
        },
      });
    },
    [currentConversationId, selectedDb],
  );

  const router = useRouter();
  const { t } = useI18n();
  const { handleProps: logoutDragHandleProps } = useDraggableDialog();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUsageStats, setShowUsageStats] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [userInfo, setUserInfo] = useState<User | null>(null);

  // 读取本地存储的用户信息（仅客户端）
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const parsed = JSON.parse(raw) as User;
        setUserInfo({
          id: parsed.id,
          email: parsed.email,
          phone: parsed.phone ?? null,
          displayName: parsed.displayName ?? null,
          avatarUrl: parsed.avatarUrl ?? null,
          role: parsed.role ?? null,
          createdAt: parsed.createdAt ?? null,
        });
      }
    } catch {
      // 忽略解析错误，使用默认展示
    }
  }, []);

  // 个人资料更新回调：刷新侧边栏展示（同时 ProfileDialog 已同步 localStorage）
  const handleProfileSaved = useCallback((updated: User) => {
    setUserInfo(updated);
  }, []);

  const handleNewChat = () => {
    setMessages([]);
  };

  const handleStopStreaming = useCallback(() => {
    streamChatClient.abort();
    setIsTyping(false);
    setIsSqlProcessing(false);
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const lastIdx = prev.length - 1;
      const last = prev[lastIdx];
      if (
        last.type === "assistant" &&
        !last.content &&
        !last.thinking &&
        !last.pendingSql
      ) {
        const updated = [...prev];
        updated[lastIdx] = { ...last, content: t("chat.messageStopped") };
        return updated;
      }
      return prev;
    });
  }, [t]);

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    const ssoSession = isSsoLogin();
    try {
      // 调用后端登出接口
      await userGraphqlApi.logout();
    } catch (error) {
      console.error("Logout API error:", error);
    } finally {
      // 无论接口是否成功，都清除本地存储
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        clearSsoLoginFlag();
      }
      // SSO 登录的用户：连同 ADFS 一起登出（跳转 ADFS 登出端点后回跳登录页）
      if (ssoSession) {
        redirectToAdfsLogout();
      } else {
        router.push("/f/010/user-login");
      }
    }
  };

  const handleSqlApprove = useCallback(
    (messageId: string, sql: string, _question: string) => {
      // Find the user question from the preceding user message
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      let question = _question;
      if (msgIndex > 0) {
        for (let i = msgIndex - 1; i >= 0; i--) {
          if (messages[i].type === "user") {
            question = messages[i].content;
            break;
          }
        }
      }
      setIsSqlProcessing(true);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, sqlApprovalStatus: "approved" as const }
            : msg,
        ),
      );

      let contentBuffer = "";
      // 用时统计起点：从点击批准到流结束（done/error）的总时长
      const approvalStartTime = Date.now();

      streamChatClient.sqlApproval({
        conversationId: currentConversationId || "",
        sql,
        action: "approve",
        question,
        // 必须透传当前选中模型：之前漏传导致后端回退到
        // DEFAULT_EXTERNAL_MODEL，撞上网关 503 model_not_found
        modelType: selectedModel?.modelType,
        modelName: selectedModel?.name,
        dbName: selectedDb,
        onChunk: (chunk) => {
          switch (chunk.type) {
            case "thinking":
              if (chunk.content) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          thinking: (msg.thinking || "") + chunk.content,
                        }
                      : msg,
                  ),
                );
              }
              break;
            case "content":
              if (chunk.content) {
                contentBuffer += chunk.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          content: contentBuffer,
                          pendingSql: undefined,
                          sqlApprovalStatus: undefined,
                          contentType: undefined,
                        }
                      : msg,
                  ),
                );
              }
              break;
            // TASK-015：审核通过后 continue_with_approval 产出的 result/chart chunk
            // 必须在此处理——之前缺这两个 case，导致审核通过的查询结果永远不渲染。
            case "result":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        resultColumns: chunk.columns ?? undefined,
                        resultData: chunk.data ?? undefined,
                        resultRowCount: chunk.rowCount ?? undefined,
                      }
                    : msg,
                ),
              );
              break;
            case "chart":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        chartConfig: chunk.chartConfig || undefined,
                      }
                    : msg,
                ),
              );
              break;
            case "sql_explanation":
              // 审核通过时后端重发 sql_explanation chunk 刷新阐述气泡
              if (chunk.sqlMeaning) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, sqlMeaning: chunk.sqlMeaning || undefined }
                      : msg,
                  ),
                );
              }
              break;
            case "done":
              setIsSqlProcessing(false);
              // 用时 = 点击批准到 done 的总时长；同时回填 token 用量
              {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          ...(chunk.inputTokens != null ||
                          chunk.outputTokens != null
                            ? {
                                inputTokens: chunk.inputTokens ?? undefined,
                                outputTokens: chunk.outputTokens ?? undefined,
                              }
                            : {}),
                          thinkingTime: Math.max(
                            0.1,
                            Math.round(
                              (Date.now() - approvalStartTime) / 100,
                            ) / 10,
                          ),
                        }
                      : msg,
                  ),
                );
              }
              break;
            case "security_block":
              // 审批后执行仍可能被安全机制拦截（如重新生成的 SQL 触及受保护表）
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        securityBlock: {
                          reason: chunk.content || t("chat.errorSqlBlocked"),
                          sql: chunk.sql || undefined,
                        },
                        thinkingTime: Math.max(
                          0.1,
                          Math.round(
                            (Date.now() - approvalStartTime) / 100,
                          ) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;
            case "error":
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        content: chunk.content || t("chat.errorExecutionFailed"),
                        pendingSql: undefined,
                        sqlApprovalStatus: undefined,
                        thinkingTime: Math.max(
                          0.1,
                          Math.round(
                            (Date.now() - approvalStartTime) / 100,
                          ) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;
          }
        },
        onError: () => {
          setIsSqlProcessing(false);
        },
        onComplete: () => {
          setIsSqlProcessing(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId && msg.thinkingTime == null
                ? {
                    ...msg,
                    thinkingTime: Math.max(
                      0.1,
                      Math.round(
                        (Date.now() - approvalStartTime) / 100,
                      ) / 10,
                    ),
                  }
                : msg,
            ),
          );
        },
      });
    },
    [currentConversationId, messages, selectedDb, selectedModel],
  );

  const handleSqlReject = useCallback(
    (messageId: string, sql: string, _question: string) => {
      // Find the user question from the preceding user message
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      let question = _question;
      if (msgIndex > 0) {
        for (let i = msgIndex - 1; i >= 0; i--) {
          if (messages[i].type === "user") {
            question = messages[i].content;
            break;
          }
        }
      }
      setIsSqlProcessing(true);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                sqlApprovalStatus: "rejected" as const,
                content: t("chat.messageRegeneratingSql"),
                thinking: "",
                pendingSql: undefined,
              }
            : msg,
        ),
      );

      let contentBuffer = "";
      // 用时统计起点：从点击拒绝到流结束（done/sql_approval/error）的总时长
      const rejectStartTime = Date.now();

      streamChatClient.sqlApproval({
        conversationId: currentConversationId || "",
        sql,
        action: "reject",
        question,
        // 同 approve：透传当前选中模型，避免重新生成 SQL 时回退默认模型
        modelType: selectedModel?.modelType,
        modelName: selectedModel?.name,
        dbName: selectedDb,
        onChunk: (chunk) => {
          switch (chunk.type) {
            case "thinking":
              if (chunk.content) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          thinking: (msg.thinking || "") + chunk.content,
                        }
                      : msg,
                  ),
                );
              }
              break;
            case "sql_approval":
              // New SQL generated, waiting for approval again
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        pendingSql: chunk.sql || chunk.content || "",
                        sqlMeaning: chunk.sqlMeaning || undefined,
                        sqlApprovalStatus: "pending" as const,
                        content: "",
                        thinkingTime: Math.max(
                          0.1,
                          Math.round((Date.now() - rejectStartTime) / 100) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;
            case "content":
              if (chunk.content) {
                contentBuffer += chunk.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          content: contentBuffer,
                          pendingSql: undefined,
                          sqlApprovalStatus: undefined,
                          contentType: undefined,
                        }
                      : msg,
                  ),
                );
              }
              break;
            // TASK-015：reject 后重新生成的 SQL 经二次审核通过，会产出 result/chart。
            case "result":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        resultColumns: chunk.columns ?? undefined,
                        resultData: chunk.data ?? undefined,
                        resultRowCount: chunk.rowCount ?? undefined,
                      }
                    : msg,
                ),
              );
              break;
            case "chart":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? { ...msg, chartConfig: chunk.chartConfig || undefined }
                    : msg,
                ),
              );
              break;
            case "sql_explanation":
              if (chunk.sqlMeaning) {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, sqlMeaning: chunk.sqlMeaning || undefined }
                      : msg,
                  ),
                );
              }
              break;
            case "done":
              setIsSqlProcessing(false);
              // 用时 = 点击拒绝到 done 的总时长；同时回填 token 用量
              {
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          ...(chunk.inputTokens != null ||
                          chunk.outputTokens != null
                            ? {
                                inputTokens: chunk.inputTokens ?? undefined,
                                outputTokens: chunk.outputTokens ?? undefined,
                              }
                            : {}),
                          thinkingTime: Math.max(
                            0.1,
                            Math.round((Date.now() - rejectStartTime) / 100) / 10,
                          ),
                        }
                      : msg,
                  ),
                );
              }
              break;
            case "security_block":
              // 重新生成 SQL 后被安全机制拦截
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        securityBlock: {
                          reason: chunk.content || t("chat.errorSqlBlocked"),
                          sql: chunk.sql || undefined,
                        },
                        thinkingTime: Math.max(
                          0.1,
                          Math.round((Date.now() - rejectStartTime) / 100) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;
            case "error":
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        content: chunk.content || t("chat.errorRegenerationFailed"),
                        pendingSql: undefined,
                        sqlApprovalStatus: undefined,
                        thinkingTime: Math.max(
                          0.1,
                          Math.round((Date.now() - rejectStartTime) / 100) / 10,
                        ),
                      }
                    : msg,
                ),
              );
              break;
          }
        },
        onError: () => {
          setIsSqlProcessing(false);
        },
        onComplete: () => {
          setIsSqlProcessing(false);
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId && msg.thinkingTime == null
                ? {
                    ...msg,
                    thinkingTime: Math.max(
                      0.1,
                      Math.round((Date.now() - rejectStartTime) / 100) / 10,
                    ),
                  }
                : msg,
            ),
          );
        },
      });
    },
    [currentConversationId, messages, selectedDb, selectedModel],
  );

  const handleSqlCancel = useCallback(
    (messageId: string, sql: string, _question: string) => {
      // TASK-015：cancel 之前是纯前端 state，ApprovalTask 一直挂为 pending，
      // 后端 stream 流也持续等待——这是个 bug。这里改为调用后端 cancel API，
      // 让 ApprovalTask 同步标记 cancelled，并把前端状态切到 cancelled 关闭 loading。
      const msgIndex = messages.findIndex((m) => m.id === messageId);
      let question = _question || "";
      if (msgIndex > 0) {
        for (let i = msgIndex - 1; i >= 0; i--) {
          if (messages[i].type === "user") {
            question = messages[i].content;
            break;
          }
        }
      }
      const pendingSql = sql || "";

      // 乐观更新：立即关闭审核 UI，避免用户点了 Cancel 后还要等网络回包才消失
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                sqlApprovalStatus: "cancelled" as const,
                content: msg.content || "Query cancelled",
                pendingSql: undefined,
              }
            : msg,
        ),
      );
      setIsSqlProcessing(false);

      // 异步通知后端：让 ApprovalTask 标记 cancelled（DB 一致性 + WS 推送给 ApprovalCenter）
      if (pendingSql) {
        streamChatClient.sqlApproval({
          conversationId: currentConversationId || "",
          sql: pendingSql,
          action: "cancel",
          question,
          dbName: selectedDb,
          onChunk: () => {
            /* cancel 流以 sql_cancelled chunk 终止，无需额外处理 */
          },
          onError: (error) => {
            console.warn("SQL cancel API call failed:", error);
          },
          onComplete: () => {
            /* 后端已确认 cancel，无额外动作 */
          },
        });
      }
    },
    [currentConversationId, messages, selectedDb],
  );

  const handleRegenerate = useCallback(
    (messageId: string, messageContent: string) => {
      // 找到用户消息的索引
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      // 删除该用户消息及其之后的所有消息（包括用户提问和系统回答）
      const updatedMessages = messages.slice(0, messageIndex);
      setMessages(updatedMessages);

      // 重新发送该用户消息（透传当前选中的模型/Agent/数据库/提示词取消状态，
      // 避免回退默认值与按钮上展示的"已取消/已携带"不一致）
      handleSendMessage(
        messageContent,
        selectedModel || undefined,
        selectedAgent,
        selectedDb,
        promptDismissed,
      );
    },
    [messages, handleSendMessage, selectedModel, selectedAgent, selectedDb, promptDismissed],
  );

  const isEmpty = messages.length === 0;

  return (
    <div
      className="flex h-screen theme-transition"
      style={{ background: "var(--bg)" }}
    >
      {/* ── Left Panel: Sidebar (always mounted, collapse to rail) ── */}
      <ChatSidebar
        onNewChat={handleNewChat}
        userName={
          userInfo?.displayName ??
          (userInfo?.email
            ? userInfo.email.split("@")[0]
            : "User")
        }
        userEmail={userInfo?.email ?? "Signed in"}
        avatarUrl={userInfo?.avatarUrl ?? null}
        onLogout={() => setShowLogoutConfirm(true)}
        onSettings={() => setShowSettings(true)}
        onUsageStats={() => setShowUsageStats(true)}
        onEditProfile={() => setShowProfile(true)}
        onActivePromptChange={setActivePrompt}
        isCollapsed={!isSidebarOpen}
        onToggleCollapse={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* Chat Content */}
        {isEmpty ? (
          <>
            <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
              <LangToggle />
              <ThemeToggle />
            </div>
            <CenterHero
              onSubmit={handleSendMessage}
              selectedDb={selectedDb}
              onDbChange={setSelectedDb}
              selectedModel={selectedModel}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              models={models}
              isLoadingModels={isLoadingModels}
              onModelChange={setSelectedModel}
              activePrompt={activePrompt}
              promptDismissed={promptDismissed}
              onPromptDismissedChange={setPromptDismissed}
            />
          </>
        ) : (
          <>
            {/* Chat Header */}
            <motion.header
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="px-4 py-3 backdrop-blur-md"
              style={{
                background: "var(--nav-bg)",
                WebkitBackdropFilter: "var(--backdrop)",
                backdropFilter: "var(--backdrop)",
                borderBottom: "0.5px solid var(--divider)",
              }}
            >
              <div className="w-full flex items-center justify-between px-1">
                {/* Left side - Title + status dot（模型选择器已移至输入框右下角） */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="inline-block rounded-full shrink-0"
                      style={{
                        width: "6px",
                        height: "6px",
                        background: isTyping ? "var(--fg3)" : "var(--accent)",
                        opacity: isTyping ? 0.6 : 1,
                        transition: "opacity 200ms ease, background 200ms ease",
                      }}
                      aria-hidden
                    />
                    <div className="flex flex-col min-w-0">
                      <h2
                        className="font-display leading-tight truncate"
                        style={{
                          fontSize: "15px",
                          fontWeight: 600,
                          letterSpacing: "-0.01em",
                          color: "var(--fg1)",
                        }}
                      >
                        {t("chat.headerTitle")}
                      </h2>
                      <p
                        className="font-text leading-tight"
                        style={{
                          fontSize: "11px",
                          color: "var(--fg3)",
                        }}
                      >
                        {isTyping ? t("chat.statusTyping") : t("chat.statusOnline")}
                      </p>
                    </div>
                  </div>
                </div>
                {/* Right side - New Chat, Theme Toggle */}
                <div className="flex items-center gap-1">
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onPress={handleNewChat}
                    aria-label={t("chat.ariaClearConversation")}
                    className="icon-btn"
                  >
                    <svg
                      className="w-[18px] h-[18px]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                  <LangToggle />
                  <ThemeToggle />
                </div>
              </div>
            </motion.header>

            {/* Messages Container */}
            <div className="flex-1 overflow-hidden">
              <MessageList
                messages={messages}
                isTyping={isTyping}
                onRegenerate={handleRegenerate}
                onSqlApprove={handleSqlApprove}
                onSqlReject={handleSqlReject}
                onSqlCancel={handleSqlCancel}
                isSqlProcessing={isSqlProcessing}
              />

              <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <MessageInput
              variant="footer"
              onSendMessage={handleSendMessage}
              onStop={handleStopStreaming}
              isStreaming={isTyping || isSqlProcessing}
              selectedDb={selectedDb}
              onDbChange={setSelectedDb}
              selectedModel={selectedModel}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              models={models}
              isLoadingModels={isLoadingModels}
              onModelChange={setSelectedModel}
              activePrompt={activePrompt}
              promptDismissed={promptDismissed}
              onPromptDismissedChange={setPromptDismissed}
            />
          </>
        )}
      </main>

      {/* Model Settings Dialog (HeroUI) */}
      <ModelSettingsDialog
        isOpen={showSettings}
        onOpenChange={setShowSettings}
        onSaved={() => {
          void reloadModels({ forceReselect: true });
        }}
      />

      {/* Usage Stats Dialog (流量统计) */}
      <UsageStatsDialog
        isOpen={showUsageStats}
        onOpenChange={setShowUsageStats}
      />

      {/* Profile Dialog (头像 + 显示名称) */}
      <ProfileDialog
        isOpen={showProfile}
        onOpenChange={setShowProfile}
        user={userInfo}
        onSaved={handleProfileSaved}
      />

      {/* Logout Confirmation Dialog (HeroUI) */}
      <AlertDialog.Backdrop
        isOpen={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header {...logoutDragHandleProps}>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>{t("chat.logoutConfirmTitle")}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{t("chat.logoutConfirmBody")}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                {t("common.cancel")}
              </Button>
              <Button slot="close" variant="danger" onPress={handleLogout}>
                {t("common.confirm")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
