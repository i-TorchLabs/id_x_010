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
  thinking?: string;
  thinkingTime?: number;
  modelUsed?: string;
  pendingSql?: string;
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled";
  contentType?: "sql";
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

// 格式化思考内容
function formatThinkingContent(thinking: string, isDark: boolean) {
  const lines = thinking.split("\n");
  const elements: React.ReactNode[] = [];
  let currentNumberedItem: {
    number: string;
    content: string;
    bullets: string[];
  } | null = null;
  let keyIndex = 0;

  const flushNumberedItem = () => {
    if (currentNumberedItem) {
      elements.push(
        <div key={`item-${keyIndex++}`} style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <span
              style={{
                color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)",
                fontWeight: 600,
                minWidth: "18px",
                flexShrink: 0,
              }}
            >
              {currentNumberedItem.number}.
            </span>
            <span style={{ color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)" }}>
              {currentNumberedItem.content}
            </span>
          </div>
          {currentNumberedItem.bullets.length > 0 && (
            <div style={{ marginLeft: "26px", marginTop: "4px" }}>
              {currentNumberedItem.bullets.map((bullet, idx) => {
                const bulletMatch = bullet.match(/^([a-z]\)|-|\*)\s*(.*)/);
                const bulletText = bulletMatch ? bulletMatch[2] : bullet;
                return (
                  <div
                    key={`bullet-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "6px",
                      marginBottom: "2px",
                      color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)",
                    }}
                  >
                    <span style={{ flexShrink: 0, marginTop: "1px" }}>•</span>
                    <span>{bulletText}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>,
      );
      currentNumberedItem = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushNumberedItem();
      continue;
    }

    const numberMatch = trimmed.match(/^(\d+)\.\s*(.*)/);
    if (numberMatch) {
      flushNumberedItem();
      currentNumberedItem = {
        number: numberMatch[1],
        content: numberMatch[2],
        bullets: [],
      };
      continue;
    }

    const bulletMatch = trimmed.match(/^([-*•]|[a-z]\))\s*(.*)/);
    if (bulletMatch && currentNumberedItem) {
      currentNumberedItem.bullets.push(trimmed);
      continue;
    }

    flushNumberedItem();
    elements.push(
      <p
        key={`p-${keyIndex++}`}
        style={{
          color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.45)",
          marginBottom: "6px",
        }}
      >
        {trimmed}
      </p>,
    );
  }

  flushNumberedItem();
  return elements;
}

// 从内容中提取 <thinking> 标签
function extractThinkingContent(content: string): {
  thinking: string | null;
  mainContent: string;
} {
  const thinkingRegex = /<thinking>([\s\S]*?)<\/thinking>/g;
  const thinkingParts: string[] = [];
  let match;

  while ((match = thinkingRegex.exec(content)) !== null) {
    thinkingParts.push(match[1].trim());
  }

  let thinking = thinkingParts.length > 0 ? thinkingParts.join("\n\n") : null;

  if (!thinking) {
    const unclosedMatch = content.match(/<thinking>([\s\S]*)$/);
    if (unclosedMatch) {
      thinking = unclosedMatch[1].trim();
    }
  }

  const removeRegex = /<thinking>[\s\S]*?(<\/thinking>|$)/g;
  let mainContent = content.replace(removeRegex, "").trim();

  if (!thinking && !mainContent) {
    return { thinking: null, mainContent: "" };
  }

  return { thinking, mainContent };
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

  const parsedContent = useMemo(() => {
    if (message.thinking) {
      return {
        thinking: message.thinking,
        mainContent: message.content,
      };
    }
    return extractThinkingContent(message.content);
  }, [message.content, message.thinking]);

  const hasThinking = !!(parsedContent.thinking || message.thinkingTime);

  useEffect(() => {
    if (!isStreaming && hasThinking) {
      setIsThinkingExpanded(false);
    }
  }, [isStreaming, hasThinking]);

  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(message.content);
      } else {
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

  // Shared code block style
  const codeBlockStyle = {
    borderRadius: "12px",
    border: isDark
      ? "1px solid rgba(255,255,255,0.06)"
      : "1px solid rgba(0,0,0,0.04)",
    background: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
    padding: "8px",
  };

  const codeTextStyle: React.CSSProperties = {
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    fontSize: "13px",
    lineHeight: "1.65",
    letterSpacing: "0.01em",
    color: isDark ? "rgba(255,255,255,0.8)" : "#1d1d1f",
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: isUser ? 20 : -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={`flex mb-4 ${isUser ? "justify-end" : "justify-start"}`}
      style={{ padding: "12px 16px" }}
    >
      {/* AI Message */}
      {!isUser && (
        <div
          style={{ maxWidth: "70%", minWidth: "512px" }}
          className="flex flex-col gap-3"
        >
          <div className="relative group w-full">
            <div
              style={{
                borderRadius: "16px",
                background: isDark ? "#1c1c1e" : "#ffffff",
                boxShadow: isDark
                  ? "none"
                  : "0 4px 48px rgba(0,0,0,0.08)",
                minWidth: "512px",
                paddingBottom:
                  message.pendingSql && message.sqlApprovalStatus === "pending"
                    ? "8px"
                    : "0",
              }}
            >
              {/* Header: dot + time */}
              <div
                className="flex items-center gap-2.5"
                style={{ padding: "10px 14px 0 14px" }}
              >
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                  <div
                    className="w-3.25 h-3.25 rounded-full"
                    style={{ background: isDark ? "#ffffff" : "#1d1d1f" }}
                  />
                </motion.div>
                <span
                  className="font-text"
                  style={{
                    fontSize: "12px",
                    color: isDark
                      ? "rgba(255,255,255,0.45)"
                      : "rgba(0,0,0,0.45)",
                  }}
                >
                  {formatTime(message.timestamp)}
                </span>
              </div>

              {/* Thinking Process */}
              {hasThinking && parsedContent.thinking && (
                <div style={{ padding: "6px 14px 0 14px" }}>
                  <div
                    style={{
                      borderRadius: "12px",
                      padding: "8px",
                      background: isDark
                        ? "rgba(255,255,255,0.05)"
                        : "rgba(0,0,0,0.03)",
                      border: isDark
                        ? "1px solid rgba(255,255,255,0.08)"
                        : "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
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
                            strokeWidth={1.5}
                            d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                          />
                        </svg>
                        <span
                          className="font-text"
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: isDark
                              ? "rgba(255,255,255,0.5)"
                              : "rgba(0,0,0,0.4)",
                          }}
                        >
                          Thinking
                        </span>
                        {message.thinkingTime != null && (
                          <span
                            style={{
                              fontSize: "10px",
                              color: isDark
                                ? "rgba(255,255,255,0.35)"
                                : "rgba(0,0,0,0.3)",
                            }}
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
                          strokeWidth={1.5}
                          d="M19 9l-7 7-7-7"
                        />
                      </motion.svg>
                    </button>

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
                            <div
                              className="font-text"
                              style={{ fontSize: "13px", lineHeight: 1.4 }}
                            >
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
                className="font-text leading-relaxed whitespace-pre-wrap"
                style={{
                  padding: "8px 14px 12px 14px",
                  fontSize: "16px",
                  letterSpacing: "-0.20px",
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
                          className="w-2.5 h-2.5 rounded-full"
                          style={{
                            background: isDark
                              ? "rgba(255,255,255,0.5)"
                              : "rgba(0,0,0,0.45)",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : message.contentType === "sql" ? (
                  <div className="space-y-2">
                    <div style={codeBlockStyle}>
                      <pre
                        className="whitespace-pre-wrap wrap-break-word"
                        style={codeTextStyle}
                      >
                        {parsedContent.mainContent}
                      </pre>
                    </div>
                    <ThinkingDots visible={!!isStreaming} label="Thinking" />
                  </div>
                ) : message.pendingSql &&
                  message.sqlApprovalStatus === "pending" ? (
                  <div className="space-y-3">
                    <div style={codeBlockStyle}>
                      <pre
                        className="whitespace-pre-wrap wrap-break-word"
                        style={codeTextStyle}
                      >
                        {message.pendingSql}
                      </pre>
                    </div>
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

              {/* Executing indicator */}
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

      {/* User Message */}
      {isUser && (
        <div
          className="relative group w-full flex flex-col items-end"
          style={{ maxWidth: "50%" }}
        >
          <div
            style={{
              borderRadius: "16px",
              background: isDark ? "#3a3a3c" : "#1d1d1f",
              padding: "10px 14px 12px 14px",
            }}
          >
            <div
              className="flex items-center justify-end gap-2.5"
              style={{ paddingBottom: "4px" }}
            >
              <span
                className="font-text"
                style={{
                  fontSize: "12px",
                  color: isDark
                    ? "rgba(255,255,255,0.48)"
                    : "rgba(255,255,255,0.6)",
                }}
              >
                {formatTime(message.timestamp)}
              </span>
              <div
                className="w-3.25 h-3.25 rounded-full"
                style={{ background: "#ffffff" }}
              />
            </div>

            <div
              className="font-text leading-relaxed whitespace-pre-wrap"
              style={{
                fontSize: "16px",
                letterSpacing: "-0.20px",
                color: "#ffffff",
              }}
            >
              {parsedContent.mainContent.split("\n").map((paragraph, index) => {
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
              })}
            </div>
          </div>

          {/* Regenerate Button */}
          {onRegenerate && (
            <button
              onClick={onRegenerate}
              className="mt-1.75 p-0.75 rounded-md transition-all duration-200"
              style={{
                background: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
                color: isDark
                  ? "rgba(255,255,255,0.6)"
                  : "rgba(0,0,0,0.5)",
              }}
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
                  strokeWidth={1.5}
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
