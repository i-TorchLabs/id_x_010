"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
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
  /** 本轮最终 SQL（持久）：sql_generated / sql_approval / 审批通过时写入，
      不随审核状态流转或回答覆盖而丢失，供"SQL 内容"子气泡强制展示 */
  executedSql?: string;
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
  /** 本轮输入 token 数（done chunk 携带；模型未返回用量时为 undefined） */
  inputTokens?: number;
  /** 本轮输出 token 数（done chunk 携带；模型未返回用量时为 undefined） */
  outputTokens?: number;
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

// 行内 Markdown 渲染：**bold** | `code` | [text](url) | *italic*
// 不引入第三方 markdown 库，手写最小子集足够覆盖思考过程里常见的行内格式。
function renderInline(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex =
    /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`b-${key++}`} style={{ fontWeight: 600 }}>
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`c-${key++}`}
          style={{
            fontFamily:
              "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
            fontSize: "12px",
            padding: "1px 5px",
            borderRadius: 4,
            background: "var(--surface-1)",
            color: "var(--fg1)",
          }}
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (m) {
        nodes.push(
          <a
            key={`l-${key++}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "var(--fg1)", textDecoration: "underline" }}
          >
            {m[1]}
          </a>,
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={`i-${key++}`} style={{ fontStyle: "italic" }}>
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

// 格式化思考内容：支持 fenced 代码块 / 标题 / 有序列表 / 无序列表 / 行内 Markdown。
// 思考文本基色用 --fg2（次要正文），标题与代码用 --fg1（最强），列表标记用 --fg3，
// 形成三级层次：标记 < 正文 < 标题/代码，便于长推理块快速扫读。
function formatThinkingContent(thinking: string) {
  const blocks: React.ReactNode[] = [];
  const lines = thinking.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const trimmed = lines[i].trim();

    // fenced code block —— ```lang ... ```
    const fenceMatch = trimmed.match(/^```(\w*)$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^```$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // 跳过闭合 ```
      blocks.push(
        <pre
          key={`code-${key++}`}
          className="whitespace-pre-wrap wrap-break-word"
          style={{
            fontFamily:
              "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
            fontSize: "12px",
            lineHeight: 1.55,
            padding: "8px 10px",
            margin: "8px 0",
            borderRadius: 8,
            background: "var(--surface-1)",
            border: "0.5px solid var(--divider)",
            color: "var(--fg1)",
            overflowX: "auto",
          }}
        >
          {codeLines.join("\n")}
        </pre>,
      );
      continue;
    }

    if (!trimmed) {
      i++;
      continue;
    }

    // heading —— # ~ ######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizes = [16, 15, 14, 13, 13, 13];
      blocks.push(
        <div
          key={`h-${key++}`}
          className="font-text"
          style={{
            fontSize: `${sizes[level - 1]}px`,
            fontWeight: 600,
            color: "var(--fg1)",
            margin: "10px 0 4px 0",
          }}
        >
          {renderInline(headingMatch[2])}
        </div>,
      );
      i++;
      continue;
    }

    // numbered list item —— 1. ...  (含紧随其后的同缩进 bullet 子项分组)
    const numberMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
    if (numberMatch) {
      const items: React.ReactNode[] = [];
      let itemKey = 0;
      items.push(
        <div
          key={`n-${key}-${itemKey++}`}
          style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}
        >
          <span
            style={{
              color: "var(--fg3)",
              fontWeight: 600,
              minWidth: "18px",
              flexShrink: 0,
            }}
          >
            {numberMatch[1]}.
          </span>
          <span style={{ color: "var(--fg2)", flex: 1 }}>
            {renderInline(numberMatch[2])}
          </span>
        </div>,
      );
      i++;
      // 收集紧随其后的 bullet 子项（缩进或不缩进均可），形成视觉分组
      while (
        i < lines.length &&
        /^([-*•]|[a-z]\))\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim())
      ) {
        const bm = lines[i].trim().match(/^([-*•]|[a-z]\))\s+(.*)/);
        if (bm) {
          items.push(
            <div
              key={`ns-${key}-${itemKey++}`}
              style={{
                display: "flex",
                gap: "6px",
                alignItems: "flex-start",
                marginLeft: "26px",
                color: "var(--fg2)",
              }}
            >
              <span style={{ flexShrink: 0, marginTop: "1px" }}>•</span>
              <span style={{ flex: 1 }}>{renderInline(bm[2])}</span>
            </div>,
          );
        }
        i++;
      }
      blocks.push(
        <div key={`nl-${key++}`} style={{ marginBottom: "6px" }}>
          {items}
        </div>,
      );
      continue;
    }

    // standalone bullet list item —— - / * / • / a)
    const bulletMatch = trimmed.match(/^([-*•]|[a-z]\))\s+(.*)/);
    if (bulletMatch) {
      const items: React.ReactNode[] = [];
      let itemKey = 0;
      items.push(
        <div
          key={`b-${key}-${itemKey++}`}
          style={{
            display: "flex",
            gap: "6px",
            alignItems: "flex-start",
            color: "var(--fg2)",
          }}
        >
          <span style={{ flexShrink: 0, marginTop: "1px" }}>•</span>
          <span style={{ flex: 1 }}>{renderInline(bulletMatch[2])}</span>
        </div>,
      );
      i++;
      while (
        i < lines.length &&
        /^([-*•]|[a-z]\))\s+/.test(lines[i].trim()) &&
        !/^\d+\.\s+/.test(lines[i].trim())
      ) {
        const bm = lines[i].trim().match(/^([-*•]|[a-z]\))\s+(.*)/);
        if (bm) {
          items.push(
            <div
              key={`bb-${key}-${itemKey++}`}
              style={{
                display: "flex",
                gap: "6px",
                alignItems: "flex-start",
                color: "var(--fg2)",
              }}
            >
              <span style={{ flexShrink: 0, marginTop: "1px" }}>•</span>
              <span style={{ flex: 1 }}>{renderInline(bm[2])}</span>
            </div>,
          );
        }
        i++;
      }
      blocks.push(
        <div key={`bl-${key++}`} style={{ marginBottom: "6px" }}>
          {items}
        </div>,
      );
      continue;
    }

    // plain paragraph
    blocks.push(
      <p
        key={`p-${key++}`}
        style={{
          color: "var(--fg2)",
          marginBottom: "6px",
          lineHeight: 1.55,
        }}
      >
        {renderInline(trimmed)}
      </p>,
    );
    i++;
  }

  return blocks;
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
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  // 思考框独立"复制"状态：复制思考过程专用，与正文复制解耦，
  // 共用 setCopied 会让两处互相同步导致 UX 错位。
  const [thinkingCopied, setThinkingCopied] = useState(false);
  // 思考滚动容器：流式追加新 chunk 时自动滚到底部，但用户主动向上
  // 查看历史推理时不打断（仅在已贴近底部时跟随）。
  const thinkingScrollRef = useRef<HTMLDivElement>(null);
  // 思考框最大高度：默认 360px 且随视口高度上限自适应（避免小屏被气泡占满）。
  const thinkingMaxHeight =
    typeof window !== "undefined" && window.innerHeight < 800
      ? "50vh"
      : "360px";

  const parsedContent = useMemo(() => {
    let parsed: { thinking: string | null; mainContent: string };
    if (message.thinking) {
      parsed = {
        thinking: message.thinking,
        mainContent: message.content,
      };
    } else {
      parsed = extractThinkingContent(message.content);
    }

    // 兜底：模型漏发 </thinking> 闭标签时，全部内容会被当作 thinking，
    // 正文为空导致气泡渲染完全空白。流结束后若正文为空且无 SQL/数据
    // 等其它内容，按首个空行把 thinking 拆成"思考 + 正文"；拆不开则整体
    // 降级为正文展示，确保气泡绝不会空白。
    if (
      !isStreaming &&
      !parsed.mainContent &&
      parsed.thinking &&
      !message.pendingSql &&
      !message.sqlMeaning &&
      !message.resultData
    ) {
      const splitIdx = parsed.thinking.indexOf("\n\n");
      if (splitIdx !== -1) {
        parsed = {
          thinking: parsed.thinking.slice(0, splitIdx).trim() || null,
          mainContent: parsed.thinking.slice(splitIdx + 2).trim(),
        };
      } else {
        parsed = { thinking: null, mainContent: parsed.thinking };
      }
    }

    return parsed;
  }, [
    message.content,
    message.thinking,
    message.pendingSql,
    message.sqlMeaning,
    message.resultData,
    isStreaming,
  ]);

  const hasThinking = !!(parsedContent.thinking || message.thinkingTime);

  // SQL Agent 轮次判定：命中后四个子气泡（思考 / SQL 概述 / SQL 内容 / 回答）
  // 强制全部渲染——缺数据的部分用占位文案兜底，保证结构完整。
  const isSqlFlow = !!(
    message.executedSql ||
    message.pendingSql ||
    message.sqlMeaning ||
    message.contentType === "sql" ||
    message.resultData !== undefined
  );
  const isApprovalPending =
    !!message.pendingSql && message.sqlApprovalStatus === "pending";
  // "SQL 内容"展示源：持久化的 executedSql 优先；pending 的 SQL 与
  // contentType==="sql" 的流式中间态兜底
  const sqlText =
    message.executedSql ||
    message.pendingSql ||
    (message.contentType === "sql" ? message.content : "");
  // contentType === "sql" 时 content 是 SQL 流式中间态，不作为回答正文
  const answerText =
    message.contentType === "sql" ? "" : parsedContent.mainContent;

  const isExecuting =
    isStreaming ||
    (isSqlProcessing &&
      (message.sqlApprovalStatus === "approved" ||
        message.sqlApprovalStatus === "rejected"));

  // 默认折叠思考框；流式期间自动展开以展示实时推理，
  // 流式结束后自动折叠保持气泡整洁（用户可随时手动展开回看完整推理）。
  // 仅当 hasThinking 切换或 isStreaming 切换时触发，不会在每个 chunk 上重跑，
  // 因此用户在流式期间手动折叠 / 结束后手动展开都能被尊重。
  useEffect(() => {
    if (!hasThinking) {
      setIsThinkingExpanded(false);
      return;
    }
    setIsThinkingExpanded(!!isStreaming);
  }, [isStreaming, hasThinking]);

  // 流式期间自动跟随新 chunk 滚到底部：仅当思考框展开、正在流式、
  // 且用户当前已贴近底部（距底 < 80px）时跟随，避免打断用户向上回看。
  useEffect(() => {
    const el = thinkingScrollRef.current;
    if (!el || !isStreaming || !isThinkingExpanded) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distance < 80) {
      el.scrollTop = el.scrollHeight;
    }
  }, [parsedContent.thinking, isStreaming, isThinkingExpanded]);

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

  // 复制完整思考过程：与正文复制解耦，避免共享 copied 状态导致两处同步闪烁。
  const handleCopyThinking = async () => {
    const text = parsedContent.thinking ?? "";
    if (!text) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
      }
      setThinkingCopied(true);
      setTimeout(() => setThinkingCopied(false), 2000);
    } catch (error) {
      console.error("Copy thinking failed:", error);
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  // token 数量格式化：<1 万按原值（千分位），1 万~100 万用 K，≥100 万用 M
  const formatTokenCount = (n: number): string => {
    if (!Number.isFinite(n) || n < 0) return "0";
    if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(2))}M`;
    if (n >= 10_000) return `${parseFloat((n / 1_000).toFixed(1))}K`;
    return n.toLocaleString();
  };

  // Shared code block style
  const codeBlockStyle = {
    borderRadius: "12px",
    border: "0.5px solid var(--divider)",
    background: "var(--surface-1)",
    padding: "8px",
  };

  const codeTextStyle: React.CSSProperties = {
    fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
    fontSize: "13px",
    lineHeight: "1.65",
    letterSpacing: "0.01em",
    color: "var(--fg1)",
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
              {(parsedContent.thinking || isSqlFlow) && (
                <div style={{ padding: "12px 16px 0 16px" }}>
                  <div style={subBubbleStyle}>
                    <div
                      className="w-full flex items-center justify-between"
                      style={{
                        paddingBottom: isThinkingExpanded ? "4px" : "0",
                      }}
                    >
                      <button
                        onClick={() =>
                          setIsThinkingExpanded(!isThinkingExpanded)
                        }
                        className="flex items-center gap-1.5 flex-1 min-w-0"
                        aria-expanded={isThinkingExpanded}
                        aria-label={
                          isThinkingExpanded
                            ? t("chat.message.thinkingCollapse")
                            : t("chat.message.thinkingExpand")
                        }
                      >
                        <svg
                          className="w-3.5 h-3.5 flex-shrink-0"
                          fill="none"
                          stroke={
                            isDark
                              ? "rgba(255,255,255,0.5)"
                              : "rgba(0,0,0,0.4)"
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
                        <motion.svg
                          animate={{ rotate: isThinkingExpanded ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
                          className="w-3.5 h-3.5 flex-shrink-0"
                          fill="none"
                          stroke={
                            isDark
                              ? "rgba(255,255,255,0.35)"
                              : "rgba(0,0,0,0.3)"
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

                      {/* 复制思考过程：与底部正文"复制"按钮分离的次级 affordance，
                          让用户一键拿到完整推理链路文本，便于归档 / 二次加工。 */}
                      <button
                        type="button"
                        onClick={handleCopyThinking}
                        aria-label={
                          thinkingCopied
                            ? t("chat.message.copiedThinking")
                            : t("chat.message.copyThinking")
                        }
                        title={t("chat.message.copyThinking")}
                        className="icon-btn-sm flex-shrink-0"
                        style={{ marginLeft: 8 }}
                      >
                        {thinkingCopied ? (
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
                            <rect
                              x="9"
                              y="9"
                              width="11"
                              height="11"
                              rx="2"
                              ry="2"
                            />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                        )}
                      </button>
                    </div>

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
                              borderTop: "0.5px solid var(--divider)",
                            }}
                          >
                            {/* 思考正文：maxHeight 上限 + 内部滚动，
                                让长推理不会把外层气泡顶出屏外，
                                同时流式期间自动跟随到底部。 */}
                            <div
                              ref={thinkingScrollRef}
                              className="thinking-scroll"
                              style={{
                                maxHeight: thinkingMaxHeight,
                                overflowY: "auto",
                                paddingRight: "4px",
                              }}
                            >
                              <div
                                className="font-text"
                                style={{
                                  fontSize: "13px",
                                  lineHeight: 1.55,
                                }}
                              >
                                {formatThinkingContent(
                                  parsedContent.thinking ||
                                    t("chat.message.noThinking"),
                                )}
                              </div>
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
              <SqlExplanationBubble
                sqlMeaning={
                  message.sqlMeaning ||
                  (isSqlFlow
                    ? t("chat.message.sqlOverviewUnavailable")
                    : undefined)
                }
              />

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

              {/* SQL 内容（持久）—— 审核面板仅在 pending 时承担此角色；
                  其余状态（生成中 / 已批准执行 / 已拒绝 / 已取消 / 执行完成）
                  由此块持久展示本轮 SQL，保证"SQL 内容"子气泡强制存在。 */}
              {isSqlFlow && !isApprovalPending && (
                <div style={{ padding: "12px 16px 0 16px" }}>
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
                        {sqlText ||
                          (isStreaming
                            ? t("chat.message.sqlContentGenerating")
                            : t("chat.message.sqlContentEmpty"))}
                      </pre>
                    </div>
                    {message.contentType === "sql" && (
                      <ThinkingDots
                        visible={!!isStreaming}
                        label={t("chat.message.thinkingLabel")}
                      />
                    )}
                  </div>
                </div>
              )}

              {/* 回答内容 —— 气泡内 4 部分之四：正文回答。
                  streaming 中无内容时显示加载点；SQL 轮次无正文时用占位
                  文案强制渲染该子气泡（待审核 / 本轮无回答）。 */}
              {!answerText ? (
                isStreaming || isSqlProcessing ? (
                  <div style={{ padding: "12px 16px 12px 16px" }}>
                    <ThinkingDots visible label={t("chat.message.thinkingLabel")} />
                  </div>
                ) : isSqlFlow && !message.securityBlock ? (
                  <div style={{ padding: "12px 16px 12px 16px" }}>
                    <div style={subBubbleStyle}>
                      <div
                        className="font-text"
                        style={{ ...subBubbleTitleStyle, marginBottom: 6 }}
                      >
                        {t("chat.message.answerTitle")}
                      </div>
                      <p
                        className="font-text"
                        style={{
                          fontSize: "13px",
                          color: "var(--fg3)",
                          margin: 0,
                        }}
                      >
                        {isApprovalPending
                          ? t("chat.message.answerPending")
                          : t("chat.message.answerEmpty")}
                      </p>
                    </div>
                  </div>
                ) : null
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
                      {answerText
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

            <AnimatePresence initial={false}>
              {isExecuting && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.25, ease: "easeInOut" }}
                  className="flex items-center gap-1.5"
                  style={{ marginTop: 8, paddingLeft: 4 }}
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.div
                        key={i}
                        animate={{
                          y: [0, -2.5, 0],
                          scale: [1, 1.2, 1],
                          opacity: [0.4, 1, 0.4],
                        }}
                        transition={{
                          duration: 1.1,
                          repeat: Infinity,
                          delay: i * 0.18,
                          ease: "easeInOut",
                        }}
                        className="rounded-full"
                        style={{
                          width: 5,
                          height: 5,
                          background: isDark
                            ? "rgba(255,255,255,0.5)"
                            : "rgba(0,0,0,0.4)",
                        }}
                      />
                    ))}
                  </div>
                  <motion.span
                    animate={{ opacity: [0.55, 1, 0.55] }}
                    transition={{
                      duration: 1.8,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                    className="font-text"
                    style={{
                      fontSize: "11px",
                      fontWeight: 500,
                      letterSpacing: "0.02em",
                      color: "var(--fg3)",
                    }}
                  >
                    {t("chat.message.executing")}
                  </motion.span>
                </motion.div>
              )}
            </AnimatePresence>

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
                  border: "0.5px solid var(--error-border)",
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

            {/* AI 消息操作栏 —— bubble 外侧底部（bubble-ai 的兄弟节点）：
                左侧元信息（思考耗时 + 输入/输出 token 消耗），
                右侧"复制"按钮靠气泡右下方对齐。
                渲染条件放宽：SQL 轮次可能只有结果表格而无解读正文，
                此时只要存在任一元信息（思考时间/tokens）也要显示 meta 行
                （复制按钮仅在有正文可复制时渲染）。 */}
            {(parsedContent.mainContent ||
              (message.thinkingTime != null && message.thinkingTime > 0) ||
              message.inputTokens != null ||
              message.outputTokens != null) && (
              <div className="flex items-center justify-between gap-1.5 mt-2">
                {/* 回答气泡下方元信息：用时 + 本轮 输入/输出 token 消耗。
                    thinkingTime = 用户发起到最后响应的总时长（在 done/error 等终态 chunk 时写入）；
                    input/output tokens 由 done chunk 的 usage_metadata 回填。 */}
                {(() => {
                  const metaParts: string[] = [];
                  if (message.thinkingTime != null && message.thinkingTime > 0) {
                    metaParts.push(
                      t("chat.message.metaThinkingTime", {
                        seconds: message.thinkingTime,
                      }),
                    );
                  }
                  if (message.inputTokens != null) {
                    metaParts.push(
                      t("chat.message.metaInputTokens", {
                        count: formatTokenCount(message.inputTokens),
                      }),
                    );
                  }
                  if (message.outputTokens != null) {
                    metaParts.push(
                      t("chat.message.metaOutputTokens", {
                        count: formatTokenCount(message.outputTokens),
                      }),
                    );
                  }
                  // 左侧占位：无元信息时也保留空 span，保证 justify-between
                  // 把复制按钮稳定推到气泡右下方
                  if (metaParts.length === 0) return <span aria-hidden />;
                  return (
                    <span
                      className="font-text"
                      style={{
                        fontSize: "11px",
                        color: "var(--fg4)",
                        letterSpacing: "0.01em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {metaParts.join(" · ")}
                    </span>
                  );
                })()}

                {/* 复制按钮仅在有解读正文时渲染；纯结果表格轮次无可复制文本 */}
                {parsedContent.mainContent ? (
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
                ) : (
                  <span aria-hidden />
                )}
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
        className={`chip-btn${submitted === "up" ? " chip-btn-active" : ""}`}
        style={{ padding: "3px 10px", fontSize: 12, lineHeight: "16px" }}
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
        className={`chip-btn${submitted === "down" ? " chip-btn-active" : ""}`}
        style={{ padding: "3px 10px", fontSize: 12, lineHeight: "16px" }}
      >
        👎
      </button>
      {submitted && !showFeedbackInput && (
        <span style={{ fontSize: 10 }}>{t("chat.feedback.submitted")}</span>
      )}
      {showFeedbackInput && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flex: 1 }}>
          <input
            type="text"
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            placeholder={t("chat.feedback.commentsPlaceholder")}
            className="field-input"
            style={{
              flex: 1,
              fontSize: 11,
              padding: "4px 10px",
            }}
          />
          <button
            type="button"
            onClick={() => handleSubmit(-1)}
            className="chip-btn"
            style={{
              fontSize: 11,
              padding: "4px 12px",
              borderRadius: 980,
              whiteSpace: "nowrap",
            }}
          >
            {t("chat.feedback.submit")}
          </button>
        </div>
      )}
    </div>
  );
}
