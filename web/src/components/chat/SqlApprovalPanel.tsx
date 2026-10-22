"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";

/**
 * TASK-015：SQL 语句人工确认面板。
 *
 * 气泡内 4 部分之三：SQL 内容 + 人工确认。
 * 展示待审核的 SQL 代码 + Approve/Regenerate/Cancel 按钮，仅在 pending 状态显示。
 *
 * 风格与其他 3 个子气泡（思考过程 / SQL 概述 / 回答内容）统一：
 * surface-1 背景 + divider 边 + xs 阴影 + 12px 圆角。
 */
interface SqlApprovalPanelProps {
  sql: string;
  onApprove?: () => void;
  onReject?: () => void;
  onCancel?: () => void;
  isProcessing?: boolean;
}

export function SqlApprovalPanel({
  sql,
  onApprove = () => {},
  onReject = () => {},
  onCancel = () => {},
  isProcessing = false,
}: SqlApprovalPanelProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const [isExpanded, setIsExpanded] = useState(true);

  // 三按钮共用的布局样式；外观(底色/描边/阴影/过渡)交给
  // globals.css 的 .btn-cta / .btn-ghost 工具类统一管理。
  const btnBase: React.CSSProperties = {
    padding: "10px 0",
    borderRadius: "12px",
    fontSize: "13px",
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
  };

  return (
    <div style={{ padding: "12px 16px 0 16px" }}>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        style={{
          borderRadius: "12px",
          padding: "10px 12px",
          background: "var(--surface-1)",
          border: "0.5px solid var(--divider)",
          boxShadow: "var(--shadow-xs)",
        }}
      >
        {/* Header —— 标题样式与其他子气泡统一 */}
        <div
          className="flex items-center justify-between cursor-pointer select-none transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke={isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)"}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            <span
              className="font-text"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)",
              }}
            >
              SQL Content
            </span>
            <span
              className="font-text"
              style={{
                fontSize: "11px",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                padding: "3px 10px",
                borderRadius: "980px",
                background: isDark
                  ? "rgba(255,255,255,0.10)"
                  : "rgba(0,0,0,0.06)",
                color: isDark
                  ? "rgba(255,255,255,0.5)"
                  : "rgba(0,0,0,0.4)",
                marginLeft: 4,
              }}
            >
              Awaiting
            </span>
          </div>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke={isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)"}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Collapsible body */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="overflow-hidden"
            >
              {/* SQL Code Block */}
              <div
                className="mt-2 overflow-hidden"
                style={{
                  borderRadius: "12px",
                  border: "0.5px solid var(--divider)",
                  background: "var(--surface-1)",
                  padding: "8px",
                }}
              >
                <pre
                  className="whitespace-pre-wrap wrap-break-word"
                  style={{
                    fontFamily:
                      "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                    fontSize: "13px",
                    lineHeight: "1.65",
                    letterSpacing: "0.01em",
                    color: "var(--fg1)",
                  }}
                >
                  {sql}
                </pre>
              </div>

              {/* Prompt */}
              <div className="pt-3 pb-1">
                <p
                  className="font-text"
                  style={{
                    fontSize: "13px",
                    color: isDark
                      ? "rgba(255,255,255,0.5)"
                      : "rgba(0,0,0,0.45)",
                  }}
                >
                  Please confirm whether to execute this query:
                </p>
              </div>

              {/* Action Buttons —— Execute 用 accent 实色 CTA，
                  Regenerate / Cancel 用浅底描边 ghost，统一立体反馈 */}
              <div className="pb-1 pt-2 grid grid-cols-3 gap-2">
                <button
                  className="btn-cta"
                  onClick={onApprove}
                  disabled={isProcessing}
                  style={btnBase}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                  Execute
                </button>

                <button
                  className="btn-ghost"
                  onClick={onReject}
                  disabled={isProcessing}
                  style={btnBase}
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Regenerate
                </button>

                <button
                  className="btn-ghost"
                  onClick={onCancel}
                  disabled={isProcessing}
                  style={btnBase}
                >
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
