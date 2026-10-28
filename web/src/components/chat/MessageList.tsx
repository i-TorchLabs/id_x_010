"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "@/context/ThemeContext";
import { ChatMessage as ChatMessageBubble } from "@/components/chat/ChatMessage";
import { motion, AnimatePresence } from "framer-motion";

type Message = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string;
  thinkingTime?: number;
  modelUsed?: string;
  pendingSql?: string;
  // 本轮最终 SQL（持久）：供 ChatMessage 的"SQL 内容"子气泡强制展示
  executedSql?: string;
  // TASK-015：sqlMeaning 由 sql_explanation / sql_approval / sql_generated chunk 携带，
  // 独立 SqlExplanationBubble 据此渲染。审核状态变化时不应被清除。
  sqlMeaning?: string;
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled";
  contentType?: "sql"; // when set to "sql", content is SQL code
  // 安全拦截告警：从 ChatHome 透传到 ChatMessage 渲染红色告警卡
  securityBlock?: {
    reason: string;
    sql?: string;
  };
  // TASK-015：SQL 查询结果字段——审核通过后 continue_with_approval 产出 result chunk，
  // ChatHome 写入这些字段，ChatMessage 据此渲染 ResultView 表格/图表。
  resultColumns?: string[];
  resultData?: Record<string, unknown>[];
  resultRowCount?: number;
  chartConfig?: {
    type: "bar" | "line" | "pie" | "area" | "scatter";
    x_column: string;
    y_columns: string[];
    title?: string;
    intent?: string;
    reason?: string;
  };
  /** 本轮输入 token 数（done chunk 携带，透传给 ChatMessage 渲染底部用量） */
  inputTokens?: number;
  /** 本轮输出 token 数（done chunk 携带，透传给 ChatMessage 渲染底部用量） */
  outputTokens?: number;
};

interface MessageListProps {
  messages: Message[];
  isTyping?: boolean;
  onRegenerate?: (messageId: string, messageContent: string) => void;
  onSqlApprove?: (messageId: string, sql: string, question: string) => void;
  onSqlReject?: (messageId: string, sql: string, question: string) => void;
  // TASK-015：cancel 也需要 sql + question 调后端，让 ApprovalTask 标记 cancelled
  onSqlCancel?: (messageId: string, sql: string, question: string) => void;
  isSqlProcessing?: boolean;
}

export function MessageList({
  messages,
  isTyping,
  onRegenerate,
  onSqlApprove,
  onSqlReject,
  onSqlCancel,
  isSqlProcessing,
}: MessageListProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Smooth scroll to bottom when new messages arrive
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div
      ref={containerRef}
      className="h-full overflow-y-auto scroll-smooth"
      style={{
        scrollbarWidth: "thin",
        scrollbarColor: "var(--divider) transparent",
        padding: "20px 24px",
      }}
    >
      <div className="w-full">
        {/* Welcome message for empty state */}
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-16"
          >
            <div
              className="inline-flex items-center justify-center w-14 h-14 mb-5"
              style={{
                borderRadius: "18px",
                background: "var(--surface-1)",
                border: "0.5px solid var(--divider-strong)",
                boxShadow: "var(--shadow-inset), var(--shadow-md)",
              }}
            >
              <svg
                className="w-7 h-7"
                fill="currentColor"
                viewBox="0 0 20 20"
                style={{ color: "var(--fg2)" }}
              >
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </div>
            <h3
              className="font-display"
              style={{
                fontSize: "22px",
                fontWeight: 600,
                letterSpacing: "-0.28px",
                color: "var(--fg1)",
                marginBottom: "6px",
              }}
            >
              Welcome to AI Assistant
            </h3>
            <p
              className="font-text"
              style={{
                fontSize: "13px",
                lineHeight: 1.5,
                color: "var(--fg3)",
                maxWidth: "360px",
                margin: "0 auto",
              }}
            >
              Start a conversation and I'll help you with anything you need
            </p>
          </motion.div>
        )}

        {/* Message list with animations */}
        <AnimatePresence mode="popLayout">
          {messages.map((message, index) => (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{
                type: "spring",
                stiffness: 500,
                damping: 30,
                delay: index * 0.05,
              }}
              className="mb-6 last:mb-0"
            >
              <ChatMessageBubble
                message={message}
                isStreaming={
                  isTyping &&
                  index === messages.length - 1 &&
                  message.type === "assistant"
                }
                onRegenerate={
                  message.type === "user" && onRegenerate
                    ? () => onRegenerate(message.id, message.content)
                    : undefined
                }
                onSqlApprove={
                  onSqlApprove && message.pendingSql
                    ? () =>
                        onSqlApprove(
                          message.id,
                          message.pendingSql || "",
                          message.content,
                        )
                    : undefined
                }
                onSqlReject={
                  onSqlReject && message.pendingSql
                    ? () =>
                        onSqlReject(
                          message.id,
                          message.pendingSql || "",
                          message.content,
                        )
                    : undefined
                }
                onSqlCancel={
                  onSqlCancel && message.pendingSql
                    ? () =>
                        onSqlCancel(
                          message.id,
                          message.pendingSql || "",
                          message.content,
                        )
                    : undefined
                }
                isSqlProcessing={isSqlProcessing}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Scroll to bottom reference */}
        <div ref={messagesEndRef} className="h-4" />
      </div>
    </div>
  );
}
