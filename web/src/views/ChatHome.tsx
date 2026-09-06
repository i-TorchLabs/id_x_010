"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { CenterHero } from "@/components/chat/CenterHero";
import { ChatSidebar } from "@/components/chat/ChatSidebar";
import { ModelSettingsDialog } from "@/components/chat/ModelSettingsDialog";
import { useTheme } from "@/context/ThemeContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AnimatePresence, motion } from "framer-motion";
import { streamChatClient, StreamChunk } from "@/api/streamChat";
import { AgentType } from "@/components/chat/AgentSelector";
import { userGraphqlApi, ModelInfo, modelGraphqlApi } from "@/api/graphql";
import { AlertDialog, Button } from "@heroui/react";

type ChatMessage = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string; // 思考过程
  thinkingTime?: number; // 思考时间（秒）
  modelUsed?: string; // 使用的模型
  pendingSql?: string; // SQL waiting for approval
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled"; // approval status
  contentType?: "sql"; // when set to "sql", content is SQL code
};

function SidebarToggle({
  open,
  onToggle,
  isDark,
}: {
  open: boolean;
  onToggle: () => void;
  isDark: boolean;
}) {
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-label={open ? "收起侧边栏" : "展开侧边栏"}
      whileTap={{ x: open ? -2 : 2 }}
      className={`absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 z-50 w-6 h-12 rounded-full flex items-center justify-center shadow-md transition-colors ${
        isDark
          ? "bg-[#1c1c1e] text-[rgba(255,255,255,0.7)] hover:bg-[#2c2c2e] border border-[#3a3a3c]"
          : "bg-white text-[rgba(0,0,0,0.55)] hover:bg-gray-50 border border-black/5"
      }`}
    >
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <motion.path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2.5}
          animate={{ d: open ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7" }}
          transition={{ duration: 0.18 }}
        />
      </svg>
    </motion.button>
  );
}

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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  // 加载模型列表（应用级别，只加载一次）
  useEffect(() => {
    let cancelled = false;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 1000; // 基础重试延迟
    const REQUEST_TIMEOUT = 10000; // 10秒超时

    const loadModels = async (attempt = 0) => {
      if (cancelled) return;
      setIsLoadingModels(true);
      let retrying = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        try {
          const response = await modelGraphqlApi.getModels(controller.signal);
          clearTimeout(timeoutId);
          if (cancelled) return;
          if (response.getModels.success) {
            setModels(response.getModels.models);
            setSelectedModel((prev) =>
              prev === null && response.getModels.models.length > 0
                ? response.getModels.models[0]
                : prev,
            );
          } else if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt);
            console.warn(
              `加载模型列表失败（第 ${attempt + 1} 次）: ${response.getModels.message}，${delay}ms 后重试`,
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
        if (cancelled) return;
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, attempt);
          console.warn(
            `加载模型列表异常（第 ${attempt + 1} 次），${delay}ms 后重试:`,
            error,
          );
          retrying = true;
          setTimeout(() => loadModels(attempt + 1), delay);
          return;
        }
        console.error("加载模型列表最终失败:", error);
      } finally {
        if (!cancelled && !retrying) {
          setIsLoadingModels(false);
        }
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, []);

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
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        type: "assistant",
        content: "",
        timestamp: new Date(),
        thinking: "",
        modelUsed: "",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      // 用于累积思考过程和回复内容
      let thinkingBuffer = "";
      let sqlBuffer = "";
      let contentBuffer = "";
      let modelUsed = "";
      let thinkingStartTime: number | null = null;
      let thinkingEndTime: number | null = null;
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
        onChunk: (chunk: StreamChunk) => {
          switch (chunk.type) {
            case "intent":
              // 意图识别，可以显示或隐藏
              break;

            case "thinking":
              // 思考过程
              // 记录思考开始时间（只记录一次）
              if (thinkingStartTime === null) {
                thinkingStartTime = Date.now();
              }
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
                }
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantMessageId
                      ? {
                          ...msg,
                          content: sqlBuffer,
                          contentType: "sql" as const,
                          modelUsed: modelUsed,
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
                  thinkingEndTime = Date.now();
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

                const thinkingTime =
                  thinkingStartTime && thinkingEndTime
                    ? Math.round((thinkingEndTime - thinkingStartTime) / 1000)
                    : 0;

                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === responseMessageId
                      ? {
                          ...msg,
                          content: contentBuffer,
                          modelUsed: modelUsed,
                          thinkingTime: thinkingTime,
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
                        sqlApprovalStatus: "pending" as const,
                      }
                    : msg,
                ),
              );
              setIsTyping(false);
              break;

            case "done":
              // 完成
              setIsTyping(false);
              break;

            case "error":
              // 错误
              setIsTyping(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === (responseMessageId || assistantMessageId)
                    ? {
                        ...msg,
                        content:
                          chunk.content ||
                          "Sorry, an error occurred. Please try again later.",
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
                      "Sorry, connection failed. Please try again later.",
                  }
                : msg,
            ),
          );
        },
        onComplete: () => {
          setIsTyping(false);
        },
      });
    },
    [currentConversationId, selectedDb],
  );

  const router = useRouter();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [userInfo, setUserInfo] = useState<{
    username: string;
    email: string | null;
  } | null>(null);

  // 读取本地存储的用户信息（仅客户端）
  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      if (raw) {
        const parsed = JSON.parse(raw);
        setUserInfo({
          username: parsed.username ?? "用户",
          email: parsed.email ?? null,
        });
      }
    } catch {
      // 忽略解析错误，使用默认展示
    }
  }, []);

  const handleNewChat = () => {
    setMessages([]);
  };

  const handleLogout = async () => {
    setShowLogoutConfirm(false);
    try {
      // 调用后端登出接口
      await userGraphqlApi.logout();
    } catch (error) {
      console.error("Logout API error:", error);
    } finally {
      // 无论接口是否成功，都清除本地存储并跳转
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
      }
      router.push("/f/login");
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

      streamChatClient.sqlApproval({
        conversationId: currentConversationId || "",
        sql,
        action: "approve",
        question,
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
            case "done":
              setIsSqlProcessing(false);
              break;
            case "error":
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        content: chunk.content || "Execution failed",
                        pendingSql: undefined,
                        sqlApprovalStatus: undefined,
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
        },
      });
    },
    [currentConversationId, messages],
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
                content: "Regenerating SQL...",
                thinking: "",
                pendingSql: undefined,
              }
            : msg,
        ),
      );

      let contentBuffer = "";

      streamChatClient.sqlApproval({
        conversationId: currentConversationId || "",
        sql,
        action: "reject",
        question,
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
                        sqlApprovalStatus: "pending" as const,
                        content: "",
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
            case "done":
              setIsSqlProcessing(false);
              break;
            case "error":
              setIsSqlProcessing(false);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === messageId
                    ? {
                        ...msg,
                        content: chunk.content || "Regeneration failed",
                        pendingSql: undefined,
                        sqlApprovalStatus: undefined,
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
        },
      });
    },
    [currentConversationId, messages],
  );

  const handleSqlCancel = useCallback((messageId: string) => {
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
  }, []);

  const handleRegenerate = useCallback(
    (messageId: string, messageContent: string) => {
      // 找到用户消息的索引
      const messageIndex = messages.findIndex((m) => m.id === messageId);
      if (messageIndex === -1) return;

      // 删除该用户消息及其之后的所有消息（包括用户提问和系统回答）
      const updatedMessages = messages.slice(0, messageIndex);
      setMessages(updatedMessages);

      // 重新发送该用户消息（使用默认模型）
      handleSendMessage(messageContent);
    },
    [messages, handleSendMessage],
  );

  const isEmpty = messages.length === 0;
  const isDark = theme === "dark";

  return (
    <div
      className={`flex h-screen ${isDark ? "bg-[#000000]" : "bg-[#f5f5f7]"}`}
    >
      {/* ── Left Panel: Sidebar ── */}
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <ChatSidebar
            onNewChat={handleNewChat}
            userName={userInfo?.username ?? "用户"}
            userEmail={userInfo?.email ?? "已登录"}
            onLogout={() => setShowLogoutConfirm(true)}
            onSettings={() => setShowSettings(true)}
          />
        )}
      </AnimatePresence>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative min-w-0">
        {/* 侧边栏吸附把手：始终贴在 leftpanel 右缘(收起时贴左屏边) */}
        <SidebarToggle
          open={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          isDark={isDark}
        />

        {/* Chat Content */}
        {isEmpty ? (
          <>
            <div className="absolute top-4 right-4 z-50">
              <ThemeToggle />
            </div>
            <CenterHero
              onSubmit={handleSendMessage}
              selectedDb={selectedDb}
              onDbChange={setSelectedDb}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              models={models}
              isLoadingModels={isLoadingModels}
            />
          </>
        ) : (
          <>
            {/* Chat Header */}
            <motion.header
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={`px-4 py-3 backdrop-blur-md ${
                isDark ? "bg-[#000000]/80" : "bg-[#f5f5f7]/80"
              }`}
              style={{
                borderBottom: isDark ? "none" : "1px solid rgba(0, 0, 0, 0.08)",
              }}
            >
              <div className="w-full flex items-center justify-between px-2">
                {/* Left side - Title */}
                <div className="flex items-center gap-3">
                  <div className="pl-1">
                    <h2
                      className={`text-base font-semibold ${isDark ? "text-white" : "text-[#1d1d1f]"}`}
                    >
                      AI Assistant
                    </h2>
                    <p
                      className={`text-xs ${isDark ? "text-[rgba(255,255,255,0.48)]" : "text-[rgba(0,0,0,0.48)]"}`}
                    >
                      {isTyping ? "Typing..." : "Online"}
                    </p>
                  </div>
                </div>
                {/* Right side - New Chat, Theme Toggle */}
                <div className="flex items-center gap-2">
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onPress={handleNewChat}
                    aria-label="New Chat"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </Button>
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
              isStreaming={isTyping}
              selectedDb={selectedDb}
              onDbChange={setSelectedDb}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              selectedAgent={selectedAgent}
              onAgentChange={setSelectedAgent}
              models={models}
              isLoadingModels={isLoadingModels}
            />
          </>
        )}
      </main>

      {/* Model Settings Dialog (HeroUI) */}
      <ModelSettingsDialog
        isOpen={showSettings}
        onOpenChange={setShowSettings}
      />

      {/* Logout Confirmation Dialog (HeroUI) */}
      <AlertDialog.Backdrop
        isOpen={showLogoutConfirm}
        onOpenChange={setShowLogoutConfirm}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>确认登出</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>您确定要登出吗？登出后需要重新登录才能继续使用。</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot="close" variant="tertiary">
                取消
              </Button>
              <Button slot="close" variant="danger" onPress={handleLogout}>
                确认登出
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}
