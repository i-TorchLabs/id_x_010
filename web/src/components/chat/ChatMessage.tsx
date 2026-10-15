"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { motion, AnimatePresence } from "framer-motion";
import { SqlApprovalPanel } from "@/components/chat/SqlApprovalPanel";
import { SqlExplanationBubble } from "@/components/chat/SqlExplanationBubble";
import { ThinkingDots } from "@/components/chat/ThinkingDots";
import { ResultView } from "@/components/chat/ResultView";

type Message = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  thinking?: string;
  thinkingTime?: number;
  modelUsed?: string;
  pendingSql?: string;
  sqlMeaning?: string;
  sqlApprovalStatus?: "pending" | "approved" | "rejected" | "cancelled";
  contentType?: "sql";
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
  /** TASK-017：反馈组件所需字段——会话 ID 与消息序号 */
  conversationId?: string;
  index?: number;
  /** 安全拦截告警：保护机制触发后由后端 security_block chunk 注入 */
  securityBlock?: {
    reason: string;
    sql?: string;
  };
  /** General Agent 工具调用状态（TASK-004）：按顺序展示 */
  toolCalls?: {
    name: string;
    status: "running" | "done";
    output?: string;
  }[];
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
  const { t } = useI18n();
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

  // TASK-015：SQL Agent 气泡内 4 个子气泡的统一风格。
  // 四部分（思考过程 / SQL 概述 / SQL 内容 / 回答内容）共用同一容器 + 标题样式，
  // 形成视觉一致的卡片列。
  const subBubbleStyle: React.CSSProperties = {
    borderRadius: "12px",
    padding: "10px 12px",
    background: "var(--surface-1)",
    border: "0.5px solid var(--divider)",
    boxShadow: "var(--shadow-xs)",
  };

  const subBubbleTitleStyle: React.CSSProperties = {
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)",
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
              className="bubble-ai"
              style={{
                minWidth: "512px",
                paddingBottom:
                  message.pendingSql && message.sqlApprovalStatus === "pending"
                    ? "8px"
                    : "0",
              }}
            >
              {/* Thinking Process —— 气泡内 4 部分之一：思考过程。
                  顶 padding 12px 直接给视觉呼吸空间（Header 已移除）。
                  气泡内顺序：Thinking → SQL 概述 → SQL 内容 → 回答内容，
                  四部分共用 subBubbleStyle 统一风格。 */}
              {hasThinking && parsedContent.thinking && (
                <div style={{ padding: "12px 16px 0 16px" }}>
                  <div style={subBubbleStyle}>
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
                          {t("chat.message.thinkingLabel")}
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

              {/* SQL 概述 —— 气泡内 4 部分之二：SQL 语句功能概述。
                  与审核状态解耦：审核期间/通过/拒绝后只要有 sqlMeaning 就显示。 */}
              <SqlExplanationBubble sqlMeaning={message.sqlMeaning} />

              {/* SQL 内容 + 人工确认 —— 气泡内 4 部分之三：SQL 语句人工确认。
                  展示 SQL 代码 + Approve/Regenerate/Cancel 按钮，仅在 pending 状态显示。 */}
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

              {/* 回答内容 —— 气泡内 4 部分之四：正文回答。
                  streaming 中无内容时显示加载点；有内容时包装进统一子气泡。
                  contentType === "sql" 是 SQL 流式生成中间态，预览 SQL 代码。 */}
              {!parsedContent.mainContent ? (
                isStreaming ? (
                  <div style={{ padding: "12px 16px 12px 16px" }}>
                    <ThinkingDots visible label={t("chat.message.thinkingLabel")} />
                  </div>
                ) : null
              ) : message.contentType === "sql" ? (
                <div style={{ padding: "12px 16px 12px 16px" }}>
                  <div style={subBubbleStyle}>
                    <div
                      className="font-text"
                      style={{ ...subBubbleTitleStyle, marginBottom: 6 }}
                    >
                      {t("chat.message.sqlContentTitle")}
                    </div>
                    <div style={codeBlockStyle}>
                      <pre
                        className="whitespace-pre-wrap wrap-break-word"
                        style={codeTextStyle}
                      >
                        {parsedContent.mainContent}
                      </pre>
                    </div>
                    <ThinkingDots visible={!!isStreaming} label={t("chat.message.thinkingLabel")} />
                  </div>
                </div>
              ) : (
                <div style={{ padding: "12px 16px 12px 16px" }}>
                  <div style={subBubbleStyle}>
                    <div
                      className="font-text"
                      style={{ ...subBubbleTitleStyle, marginBottom: 6 }}
                    >
                      {t("chat.message.answerTitle")}
                    </div>
                    <div
                      className="font-text leading-relaxed whitespace-pre-wrap"
                      style={{
                        fontSize: "15px",
                        lineHeight: 1.65,
                        letterSpacing: "-0.15px",
                        color: "var(--fg1)",
                      }}
                    >
                      {parsedContent.mainContent
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
                  </div>
                </div>
              )}

            </div>

            {/* Security Alert Banner —— 移出 bubble，作为独立兄弟元素保持红色告警语义。
                安全机制拦截时由后端 security_block chunk 触发，
                显式呈现拒绝原因 + 被拦截的 SQL，区别于普通 error 的灰色文案。 */}
            {message.securityBlock && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: "easeOut" }}
                role="alert"
                aria-live="assertive"
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  borderRadius: 10,
                  // 红色语义色：边框/背景/文字三档叠加，浅红底 + 深红字 + 中红边
                  background: "var(--error-bg)",
                  border: "1px solid var(--error-border)",
                  boxShadow: "var(--shadow-xs)",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                }}
              >
                {/* 警告图标 — 用 SVG 绘制三角警告，颜色取全局 --error */}
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  style={{
                    flexShrink: 0,
                    marginTop: 1,
                    color: "var(--error)",
                  }}
                  aria-hidden="true"
                >
                  <path
                    d="M12 2.5L22.5 21H1.5L12 2.5z"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                    fill="none"
                  />
                  <line
                    x1="12"
                    y1="9.5"
                    x2="12"
                    y2="14"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                  <circle cx="12" cy="17" r="1" fill="currentColor" />
                </svg>

                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* 标题：红色加粗，明确"安全拦截"语义 */}
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 600,
                      color: "var(--error)",
                      letterSpacing: "0.01em",
                      marginBottom: 4,
                    }}
                  >
                    {t("chat.message.securityBlockTitle")}
                  </div>
                  {/* 原因文字：红色（较标题稍弱），便于阅读 */}
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--error)",
                      opacity: 0.85,
                      lineHeight: 1.5,
                      wordBreak: "break-word",
                    }}
                  >
                    {message.securityBlock.reason}
                  </div>
                  {/* 被拦截的 SQL（若有）：等宽字体显示在告警卡内底部 */}
                  {message.securityBlock.sql && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: "8px 10px",
                        background: "rgba(220, 38, 38, 0.04)",
                        border: "0.5px solid var(--error-border)",
                        borderRadius: 6,
                        fontFamily:
                          "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
                        fontSize: "11px",
                        color: "var(--error)",
                        opacity: 0.75,
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        maxHeight: 120,
                        overflowY: "auto",
                      }}
                    >
                      {message.securityBlock.sql}
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Result View —— 查询结果表格/图表（移出 bubble，作为独立兄弟元素）
                后端 SQL Agent 通过深度意图识别主动推荐图表；
                无论是否有 chartConfig，只要 resultData 存在就渲染此视图，
                比之前仅在 chartConfig 存在时显示更完整。
                TASK-015：defaultMode="table" 让表格成为默认视图（用户要求"渲染为表格"），
                用户仍可点击切换到图表视图。 */}
            {message.resultData && message.resultColumns && (
              <div className="mt-3">
                <ResultView
                  columns={message.resultColumns}
                  data={message.resultData}
                  rowCount={message.resultRowCount}
                  chartConfig={message.chartConfig || null}
                  defaultMode="table"
                />
              </div>
            )}

            {/* AI 消息操作栏:复制 —— 移至 bubble 外侧底部（bubble-ai 的兄弟节点），
                mt-2 (8px) 提供与 bubble 的间距；与 user 消息 Action Buttons 风格一致 */}
            {parsedContent.mainContent && (
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={copied ? t("chat.message.ariaCopied") : t("chat.message.ariaCopy")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-200"
                  style={{
                    background: copied ? "var(--surface-1)" : "transparent",
                    border: "0.5px solid var(--divider-strong)",
                    color: copied ? "var(--fg1)" : "var(--fg3)",
                    fontSize: "11px",
                    fontWeight: 500,
                    letterSpacing: "0.01em",
                    boxShadow: copied
                      ? "var(--shadow-inset), var(--shadow-xs)"
                      : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (copied) return;
                    e.currentTarget.style.background = "var(--hover-bg)";
                    e.currentTarget.style.boxShadow =
                      "var(--shadow-inset), var(--shadow-xs)";
                    e.currentTarget.style.color = "var(--fg1)";
                  }}
                  onMouseLeave={(e) => {
                    if (copied) return;
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.color = "var(--fg3)";
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.96)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  {copied ? (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <rect x="9" y="9" width="11" height="11" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                  <span>{copied ? t("chat.message.copied") : t("chat.message.copy")}</span>
                </button>
              </div>
            )}
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
            className="bubble-user"
            style={{
              padding: "12px 16px 14px 16px",
            }}
          >
            <div
              className="flex items-center justify-end gap-2.5"
              style={{ paddingBottom: "4px" }}
            >
              <span
                className="font-text"
                style={{
                  fontSize: "11px",
                  fontWeight: 500,
                  letterSpacing: "0.02em",
                  color: "var(--accent-fg)",
                  opacity: 0.7,
                }}
              >
                {formatTime(message.timestamp)}
              </span>
              <div
                className="rounded-full"
                style={{
                  width: "8px",
                  height: "8px",
                  background: "var(--accent-fg)",
                  opacity: 0.9,
                }}
              />
            </div>

            <div
              className="font-text leading-relaxed whitespace-pre-wrap"
              style={{
                fontSize: "15px",
                lineHeight: 1.65,
                letterSpacing: "-0.15px",
                color: "var(--accent-fg)",
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

          {/* Action Buttons —— 重新生成 + 复制 */}
          {(onRegenerate || parsedContent.mainContent) && (
            <div className="flex items-center gap-1.5 mt-2">
              {onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  aria-label={t("chat.message.ariaRegenerate")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-200"
                  style={{
                    background: "transparent",
                    border: "0.5px solid var(--divider-strong)",
                    color: "var(--fg2)",
                    fontSize: "11px",
                    fontWeight: 500,
                    letterSpacing: "0.01em",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--hover-bg)";
                    e.currentTarget.style.boxShadow =
                      "var(--shadow-inset), var(--shadow-xs)";
                    e.currentTarget.style.color = "var(--fg1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.color = "var(--fg2)";
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.96)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.8}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    aria-hidden
                  >
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>{t("chat.message.regenerate")}</span>
                </button>
              )}

              {parsedContent.mainContent && (
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={copied ? t("chat.message.ariaCopied") : t("chat.message.ariaCopy")}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all duration-200"
                  style={{
                    background: copied ? "var(--surface-1)" : "transparent",
                    border: copied
                      ? "0.5px solid var(--divider-strong)"
                      : "0.5px solid var(--divider-strong)",
                    color: copied ? "var(--fg1)" : "var(--fg2)",
                    fontSize: "11px",
                    fontWeight: 500,
                    letterSpacing: "0.01em",
                    boxShadow: copied
                      ? "var(--shadow-inset), var(--shadow-xs)"
                      : "none",
                  }}
                  onMouseEnter={(e) => {
                    if (copied) return;
                    e.currentTarget.style.background = "var(--hover-bg)";
                    e.currentTarget.style.boxShadow =
                      "var(--shadow-inset), var(--shadow-xs)";
                    e.currentTarget.style.color = "var(--fg1)";
                  }}
                  onMouseLeave={(e) => {
                    if (copied) return;
                    e.currentTarget.style.background = "transparent";
                    e.currentTarget.style.boxShadow = "none";
                    e.currentTarget.style.color = "var(--fg2)";
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = "scale(0.96)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  {copied ? (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg
                      className="w-3 h-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                      aria-hidden
                    >
                      <rect x="9" y="9" width="11" height="11" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                  )}
                  <span>{copied ? t("chat.message.copied") : t("chat.message.copy")}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

// TASK-017：每条 assistant 消息底部的反馈按钮（👍/踩）
function FeedbackBar({
  conversationId,
  messageIndex,
}: {
  conversationId?: string;
  messageIndex?: number;
}) {
  const [submitted, setSubmitted] = useState<"up" | "down" | null>(null);
  const [showFeedbackInput, setShowFeedbackInput] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [_, setLastRating] = useState<1 | -1 | null>(null);
  const { t } = useI18n();

  if (!conversationId || messageIndex === undefined) {
    return null; // 缺少定位信息时不显示
  }

  const handleSubmit = async (rating: 1 | -1) => {
    setLastRating(rating);
    try {
      const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
      const url = `${process.env.NEXT_PUBLIC_BASE_URL || ""}/b/id_x_010/graphql`;
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          query: `mutation($cid: String!, $idx: Int!, $r: Int!, $t: String) {
            submitFeedback(conversationId: $cid, messageIndex: $idx, rating: $r, feedbackText: $t) {
              success message
            }
          }`,
          variables: {
            cid: conversationId,
            idx: messageIndex,
            r: rating,
            t: feedbackText || null,
          },
        }),
      });
      setSubmitted(rating === 1 ? "up" : "down");
      setShowFeedbackInput(false);
    } catch (e) {
      console.error("submitFeedback failed", e);
    }
  };

  return (
    <div
      style={{
        // 上 12 与上一区块下 0 形成 12px 间距；
        // 下 12 给 MessageList 留呼吸空间（FeedbackBar 是最后一个区块）
        padding: "12px 16px 12px 16px",
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontSize: 11,
        color: "var(--fg3)",
      }}
    >
      <button
        type="button"
        onClick={() => handleSubmit(1)}
        title={t("chat.feedback.tooltipHelpful")}
        style={{
          background: submitted === "up" ? "var(--surface-2)" : "transparent",
          border: "0.5px solid var(--divider)",
          borderRadius: 6,
          padding: "2px 8px",
          cursor: "pointer",
          color: submitted === "up" ? "var(--success, #16a34a)" : "var(--fg3)",
        }}
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => {
          setShowFeedbackInput((s) => !s);
          setLastRating(-1);
        }}
        title={t("chat.feedback.tooltipNeedsImprovement")}
        style={{
          background: submitted === "down" ? "var(--surface-2)" : "transparent",
          border: "0.5px solid var(--divider)",
          borderRadius: 6,
          padding: "2px 8px",
          cursor: "pointer",
          color: submitted === "down" ? "var(--error, #dc2626)" : "var(--fg3)",
        }}
      >
        👎
      </button>
      {submitted && !showFeedbackInput && (
        <span style={{ fontSize: 10 }}>{t("chat.feedback.submitted")}</span>
      )}
      {showFeedbackInput && (
        <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1 }}>
          <input
            type="text"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t("chat.feedback.commentsPlaceholder")}
            style={{
              flex: 1,
              fontSize: 11,
              padding: "2px 6px",
              borderRadius: 4,
              border: "0.5px solid var(--divider)",
              background: "var(--surface-1)",
              color: "var(--fg2)",
            }}
          />
          <button
            type="button"
            onClick={() => handleSubmit(-1)}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              background: "var(--surface-2)",
              border: "0.5px solid var(--divider)",
              cursor: "pointer",
            }}
          >
            {t("chat.feedback.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
