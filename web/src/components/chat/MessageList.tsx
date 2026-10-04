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
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled";
  contentType?: "sql"; // when set to "sql", content is SQL code
};

interface MessageListProps {
  messages: Message[];
  isTyping?: boolean;
  onRegenerate?: (messageId: string, messageContent: string) => void;
  onSqlApprove?: (messageId: string, sql: string, question: string) => void;
  onSqlReject?: (messageId: string, sql: string, question: string) => void;
  onSqlCancel?: (messageId: string) => void;
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
        padding: "16px",
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
                border: "0.5px solid var(--divider)",
                boxShadow: "var(--shadow-sm)",
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
                  onSqlCancel ? () => onSqlCancel(message.id) : undefined
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
