"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";
import { SqlApprovalPanel } from "@/components/chat/SqlApprovalPanel";
import { ThinkingDots } from "@/components/chat/ThinkingDots";

type Message = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string; // 思考过程内容
  thinkingTime?: number; // 思考时间（秒）
  modelUsed?: string; // 使用的模型
  pendingSql?: string; // SQL waiting for approval
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled"; // approval status
  contentType?: "sql"; // when set to "sql", content is SQL code
};

interface ChatMessageProps {
  message: Message;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onSqlApprove?: () => void;
  onSqlReject?: () => void;
  onSqlCancel?: () => void;
  isSqlProcessing?: boolean;
}

// 格式化思考内容 - 支持编号列表和嵌套要点
function formatThinkingContent(
  content: string,
  isDark: boolean,
): React.ReactElement[] {
  const lines = content.split("\n");
  const elements: React.ReactElement[] = [];
  let currentNumberedItem: { number: string; content: string[] } | null = null;
  let keyIndex = 0;

  const flushNumberedItem = () => {
    if (currentNumberedItem) {
      elements.push(
        <div key={`num-${keyIndex++}`} className="mb-2 last:mb-0">
          <div className="flex gap-1.5">
            <span
              className="font-bold shrink-0"
              style={{
                color: isDark ? "rgba(255,255,255,0.9)" : "#1d1d1f",
                minWidth: "20px",
              }}
            >
              {currentNumberedItem.number}
            </span>
            <div className="flex-1">
              {currentNumberedItem.content.map((line, idx) => {
                // 检查是否是嵌套要点
                const bulletMatch = line.match(/^(\s*)[\*\-]\s+(.+)$/);
                if (bulletMatch) {
                  return (
                    <div
                      key={idx}
                      className="flex gap-1.5 mb-1"
                      style={{ marginLeft: "6px" }}
                    >
                      <span
                        style={{
                          color: isDark
                            ? "rgba(255,255,255,0.5)"
                            : "rgba(0,0,0,0.5)",
                        }}
                      >
                        •
                      </span>
                      <span
                        style={{
                          color: isDark
                            ? "rgba(255,255,255,0.7)"
                            : "rgba(0,0,0,0.7)",
                        }}
                      >
                        {bulletMatch[2]}
                      </span>
                    </div>
                  );
                }
                return (
                  <span
                    key={idx}
                    className="block leading-relaxed"
                    style={{
                      color: isDark
                        ? "rgba(255,255,255,0.8)"
                        : "rgba(0,0,0,0.8)",
                    }}
                  >
                    {line}
                  </span>
                );
              })}
            </div>
          </div>
        </div>,
      );
      currentNumberedItem = null;
    }
  };

  for (const line of lines) {
    // 检查是否是编号行 (如 "1.  内容" 或 "1.内容")
    const numberMatch = line.match(/^(\d+)\.\s*(.*)$/);

    if (numberMatch) {
      // 先刷新之前的编号项
      flushNumberedItem();

      // 开始新的编号项
      currentNumberedItem = {
        number: `${numberMatch[1]}.`,
        content: numberMatch[2] ? [numberMatch[2]] : [],
      };
    } else if (currentNumberedItem) {
      // 添加到当前编号项的内容
      if (line.trim()) {
        currentNumberedItem.content.push(line);
      }
    } else if (line.trim()) {
      // 非编号内容，直接添加
      flushNumberedItem();
      elements.push(
        <p
          key={`p-${keyIndex++}`}
          className="mb-2 last:mb-0 leading-relaxed"
          style={{
            color: isDark ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.8)",
          }}
        >
          {line}
        </p>,
      );
    }
  }

  // 刷新最后一个编号项
  flushNumberedItem();

  return elements;
}

// 从内容中提取思考过程（完全隐形转换，支持多个 thinking 块）
function extractThinkingContent(content: string): {
  thinking: string | null;
  mainContent: string;
} {
  // 匹配所有 <thinking>...</thinking> 标签（支持多行，忽略大小写）
  const thinkingRegex = /<thinking\s*>([\s\S]*?)<\/thinking>/gi;

  const thinkingParts: string[] = [];
  let match;

  // 收集所有思考内容
  while ((match = thinkingRegex.exec(content)) !== null) {
    const thinkingContent = match[1].trim();
    if (thinkingContent) {
      thinkingParts.push(thinkingContent);
    }
  }

  if (thinkingParts.length > 0) {
    // 合并所有思考内容
    const thinkingContent = thinkingParts.join("\n\n");

    // 从原内容中完全移除所有思考标签部分
    const removeRegex = /<thinking\s*>[\s\S]*?<\/thinking>/gi;
    let mainContent = content.replace(removeRegex, "");

    // 彻底清理多余内容
    mainContent = mainContent
      .replace(/^\s*\n+/, "") // 移除开头的所有空行
      .replace(/\n+\s*$/, "") // 移除结尾的所有空行
      .replace(/\n{3,}/g, "\n\n") // 3个以上换行变为2个
      .split("\n")
      .map((line) => line.trimEnd()) // 移除每行末尾的空白
      .join("\n")
      .trim();

    return { thinking: thinkingContent, mainContent };
  }

  return { thinking: null, mainContent: content };
}

export function ChatMessage({
  message,
  isStreaming,
  onRegenerate,
  onSqlApprove,
  onSqlReject,
  onSqlCancel,
  isSqlProcessing,
}: ChatMessageProps) {
  const isUser = message.type === "user";
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [copied, setCopied] = useState(false);
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(true);

  // 解析内容，提取思考过程
  const parsedContent = useMemo(() => {
    // 如果已经有 thinking 字段，直接使用
    if (message.thinking) {
      return {
        thinking: message.thinking,
        mainContent: message.content,
      };
    }
    // 否则从 content 中提取 <thinking> 标签
    return extractThinkingContent(message.content);
  }, [message.content, message.thinking]);

  const hasThinking = !!(parsedContent.thinking || message.thinkingTime);

  // 当回答完毕时，自动收起思考过程
  useEffect(() => {
    if (!isStreaming && hasThinking) {
      setIsThinkingExpanded(false);
    }
  }, [isStreaming, hasThinking]);

  const handleCopy = async () => {
    try {
      // 优先使用 navigator.clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message.content);
      } else {
        // 降级方案：使用 execCommand
        const textArea = document.createElement("textarea");
        textArea.value = message.content;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  return (
    <motion.div
      initial={{ opacity: 0, x: isUser ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex mb-4 ${isUser ? "justify-end" : "justify-start"}`}
      style={{ padding: "12px 16px" }}
    >
      {/* AI Message - 单一气泡，头像内嵌 */}
      {!isUser && (
        <div
          style={{ maxWidth: "70%", minWidth: "512px" }}
          className="flex flex-col gap-3"
        >
          {/* AI 统一气泡 */}
          <div className="relative group w-full">
            <div
              className={`rounded-2xl ${
                isDark ? "bg-[#1c1c1e] text-white" : "bg-white text-[#1d1d1f]"
              }`}
              style={{
                minWidth: "512px",
                paddingBottom:
                  message.pendingSql && message.sqlApprovalStatus === "pending"
                    ? "8px"
                    : "0",
                boxShadow: isDark
                  ? "none"
                  : "rgba(0, 0, 0, 0.22) 3px 5px 30px 0px",
              }}
            >
              {/* 气泡头部：头像 + 时间 + 复制按钮 */}
              <div
                className="flex items-center gap-2.5"
                style={{
                  padding: "10px 14px 0 14px",
                }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                  <div
                    className="w-3.25 h-3.25 rounded-full"
                    style={{
                      background: isDark ? "#ffffff" : "#1d1d1f",
                    }}
                  />
                </motion.div>
                <span
                  className={`text-xs ${
                    isDark
                      ? "text-[rgba(255,255,255,0.48)]"
                      : "text-[rgba(0,0,0,0.48)]"
                  }`}
                >
                  {formatTime(message.timestamp)}
                </span>
              </div>

              {/* Thinking Process - 内嵌在气泡中，支持展开/收起 */}
              {hasThinking && parsedContent.thinking && (
                <div style={{ padding: "6px 14px 0 14px" }}>
                  <div
                    className="rounded-xl"
                    style={{
                      padding: "8px",
                      fontFamily: "'Times New Roman', Times, serif",
                      background: isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.03)",
                      border: isDark
                        ? "1px solid rgba(255,255,255,0.1)"
                        : "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    {/* Thinking Header - Clickable to toggle */}
                    <button
                      onClick={() => setIsThinkingExpanded(!isThinkingExpanded)}
                      className="w-full flex items-center justify-between"
                      style={{
                        paddingBottom: isThinkingExpanded ? "4px" : "0",
                      }}
                    >
                      <div className="flex items-center gap-1.5">
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke={
                            isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)"
                          }
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                          />
                        </svg>
                        <span
                          className={`text-[11px] font-semibold tracking-wide uppercase ${
                            isDark
                              ? "text-[rgba(255,255,255,0.5)]"
                              : "text-[rgba(0,0,0,0.4)]"
                          }`}
                        >
                          Thinking
                        </span>
                        {message.thinkingTime != null && (
                          <span
                            className={`text-[10px] ${
                              isDark
                                ? "text-[rgba(255,255,255,0.35)]"
                                : "text-[rgba(0,0,0,0.3)]"
                            }`}
                          >
                            {message.thinkingTime}s
                          </span>
                        )}
                      </div>
                      <motion.svg
                        animate={{ rotate: isThinkingExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke={
                          isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)"
                        }
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 9l-7 7-7-7"
                        />
                      </motion.svg>
                    </button>

                    {/* Thinking Content - Collapsible */}
                    <AnimatePresence initial={false}>
                      {isThinkingExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.25, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div
                            style={{
                              marginTop: "4px",
                              paddingTop: "4px",
                              borderTop: isDark
                                ? "1px solid rgba(255,255,255,0.06)"
                                : "1px solid rgba(0,0,0,0.04)",
                            }}
                          >
                            <div className="text-[13px] leading-relaxed">
                              {formatThinkingContent(
                                parsedContent.thinking,
                                isDark,
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* Message Text */}
              <div
                className="text-base leading-relaxed whitespace-pre-wrap"
                style={{
                  padding: "8px 14px 12px 14px",
                  fontFamily: "inherit",
                }}
              >
                {!parsedContent.mainContent ? (
                  <div
                    className="flex items-center justify-center w-full"
                    style={{ minHeight: "24px" }}
                  >
                    <div className="flex items-center gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          animate={{
                            scale: [1, 1.3, 1],
                            opacity: [0.5, 1, 0.5],
                          }}
                          transition={{
                            duration: 0.8,
                            repeat: Infinity,
                            delay: i * 0.15,
                          }}
                          className={`w-2.5 h-2.5 rounded-full ${
                            isDark ? "bg-gray-400" : "bg-gray-600"
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                ) : message.contentType === "sql" ? (
                  <div className="space-y-2">
                    <div
                      className={`rounded-xl overflow-hidden ${isDark ? "bg-[#0d0d0d]" : "bg-[#e9e9ee]"}`}
                      style={{
                        border: isDark
                          ? "1px solid rgba(255,255,255,0.06)"
                          : "1px solid rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ padding: "8px" }}>
                        <pre
                          className={`text-[13px] whitespace-pre-wrap wrap-break-word font-mono ${isDark ? "text-[#e5e5e5]" : "text-[#1d1d1f]"}`}
                          style={{
                            fontFamily:
                              "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                            lineHeight: "1.65",
                            letterSpacing: "0.01em",
                          }}
                        >
                          {parsedContent.mainContent}
                        </pre>
                      </div>
                    </div>
                    {/* SQL 已生成但还未弹出人工审批时，显示 Thinking */}
                    <ThinkingDots visible={!!isStreaming} label="Thinking" />
                  </div>
                ) : message.pendingSql &&
                  message.sqlApprovalStatus === "pending" ? (
                  <div className="space-y-3">
                    {/* SQL 代码块 - 内嵌在气泡中 */}
                    <div
                      className={`rounded-xl overflow-hidden ${isDark ? "bg-[#0d0d0d]" : "bg-[#e9e9ee]"}`}
                      style={{
                        border: isDark
                          ? "1px solid rgba(255,255,255,0.06)"
                          : "1px solid rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ padding: "8px" }}>
                        <pre
                          className={`text-[13px] whitespace-pre-wrap wrap-break-word font-mono ${isDark ? "text-[#e5e5e5]" : "text-[#1d1d1f]"}`}
                          style={{
                            fontFamily:
                              "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                            lineHeight: "1.65",
                            letterSpacing: "0.01em",
                          }}
                        >
                          {message.pendingSql}
                        </pre>
                      </div>
                    </div>
                    {/* 自然语言内容 */}
                    {parsedContent.mainContent.trim() &&
                      parsedContent.mainContent
                        .split("\n")
                        .map((paragraph, index) => {
                          if (!paragraph.trim()) return <br key={index} />;

                          const formattedText = paragraph
                            .split(/(\*\*[^*]+\*\*)/)
                            .map((part, i) => {
                              if (
                                part.startsWith("**") &&
                                part.endsWith("**")
                              ) {
                                return (
                                  <strong key={i}>{part.slice(2, -2)}</strong>
                                );
                              }
                              return part;
                            });

                          if (
                            paragraph.trim().match(/^\d+\.\s/) ||
                            paragraph.trim().startsWith("- ") ||
                            paragraph.trim().startsWith("* ")
                          ) {
                            return (
                              <div key={index} className="mb-2 ml-4">
                                {formattedText}
                              </div>
                            );
                          }

                          return (
                            <p key={index} className="mb-3 last:mb-0">
                              {formattedText}
                            </p>
                          );
                        })}
                  </div>
                ) : (
                  parsedContent.mainContent
                    .split("\n")
                    .map((paragraph, index) => {
                      if (!paragraph.trim()) return <br key={index} />;

                      const formattedText = paragraph
                        .split(/(\*\*[^*]+\*\*)/)
                        .map((part, i) => {
                          if (part.startsWith("**") && part.endsWith("**")) {
                            return <strong key={i}>{part.slice(2, -2)}</strong>;
                          }
                          return part;
                        });

                      if (
                        paragraph.trim().match(/^\d+\.\s/) ||
                        paragraph.trim().startsWith("- ") ||
                        paragraph.trim().startsWith("* ")
                      ) {
                        return (
                          <div key={index} className="mb-2 ml-4">
                            {formattedText}
                          </div>
                        );
                      }

                      return (
                        <p key={index} className="mb-3 last:mb-0">
                          {formattedText}
                        </p>
                      );
                    })
                )}
              </div>

              {/* SQL Approval Panel */}
              {message.pendingSql &&
                message.sqlApprovalStatus === "pending" && (
                  <SqlApprovalPanel
                    sql={message.pendingSql}
                    onApprove={onSqlApprove}
                    onReject={onSqlReject}
                    onCancel={onSqlCancel}
                    isProcessing={isSqlProcessing}
                  />
                )}

              {/* 执行中 - SQL 审批通过后执行中显示 */}
              <ThinkingDots
                visible={
                  !!isSqlProcessing &&
                  !!message.pendingSql &&
                  message.sqlApprovalStatus === "approved"
                }
                label="Executing"
              />
            </div>
          </div>
        </div>
      )}

      {/* User Message Bubble */}
      {isUser && (
        <div
          className="relative group w-full flex flex-col items-end"
          style={{ maxWidth: "50%" }}
        >
          <div
            className={`rounded-2xl ${
              isDark ? "bg-[#3a3a3c] text-white" : "bg-[#1d1d1f] text-white"
            }`}
            style={{
              padding: "10px 14px 12px 14px",
            }}
          >
            {/* 气泡头部：红点 + 时间 */}
            <div
              className="flex items-center justify-end gap-2.5"
              style={{
                paddingBottom: "4px",
              }}
            >
              <span
                className={`text-xs ${
                  isDark
                    ? "text-[rgba(255,255,255,0.48)]"
                    : "text-[rgba(255,255,255,0.6)]"
                }`}
              >
                {formatTime(message.timestamp)}
              </span>
              <div
                className="w-3.25 h-3.25 rounded-full"
                style={{
                  background: "#ffffff",
                }}
              />
            </div>

            {/* Message Text */}
            <div
              className="text-base leading-relaxed whitespace-pre-wrap"
              style={{
                fontFamily: "'Times New Roman', Times, serif",
              }}
            >
              {parsedContent.mainContent.split("\n").map((paragraph, index) => {
                if (!paragraph.trim()) return <br key={index} />;

                // Simple formatting for bold text
                const formattedText = paragraph
                  .split(/(\*\*[^*]+\*\*)/)
                  .map((part, i) => {
                    if (part.startsWith("**") && part.endsWith("**")) {
                      return <strong key={i}>{part.slice(2, -2)}</strong>;
                    }
                    return part;
                  });

                // Check if it's a list item
                if (
                  paragraph.trim().match(/^\d+\.\s/) ||
                  paragraph.trim().startsWith("- ") ||
                  paragraph.trim().startsWith("* ")
                ) {
                  return (
                    <div key={index} className="mb-2 ml-4">
                      {formattedText}
                    </div>
                  );
                }

                return (
                  <p key={index} className="mb-3 last:mb-0">
                    {formattedText}
                  </p>
                );
              })}
            </div>
          </div>

          {/* Regenerate Button */}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className={`mt-1.75 p-0.75 rounded-md transition-all duration-200 ${
                isDark
                  ? "bg-[#2c2c2e] hover:bg-[#3a3a3c] text-[rgba(255,255,255,0.6)] hover:text-white"
                  : "bg-[#e8e8ed] hover:bg-[#d1d1d6] text-[rgba(0,0,0,0.5)] hover:text-[rgba(0,0,0,0.8)]"
              }`}
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}
