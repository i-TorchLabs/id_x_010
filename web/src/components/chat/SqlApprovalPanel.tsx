"use client";

import { useState } from "react";
import { useTheme } from "@/context/ThemeContext";
import { motion, AnimatePresence } from "framer-motion";

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

  const btnBase: React.CSSProperties = {
    padding: "10px 0",
    borderRadius: "12px",
    fontSize: "13px",
    fontWeight: 600,
    transition: "opacity 200ms",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    background: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
    color: isDark ? "#ffffff" : "#1d1d1f",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      style={{
        borderRadius: "16px",
        overflow: "hidden",
        marginTop: "12px",
        background: isDark ? "#1c1c1e" : "#f5f5f7",
        border: isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.06)",
        boxShadow: isDark
          ? "0 4px 48px rgba(0,0,0,0.5)"
          : "0 4px 48px rgba(0,0,0,0.08)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer select-none transition-colors"
        style={{
          padding: "12px 16px",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span
          className="font-display"
          style={{
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "-0.15px",
            color: isDark ? "rgba(255,255,255,0.9)" : "#1d1d1f",
          }}
        >
          SQL Query Confirmation
        </span>
        <div className="flex items-center gap-2">
          <span
            className="font-text"
            style={{
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "5px 14px",
              borderRadius: "980px",
              background: isDark
                ? "rgba(255,255,255,0.10)"
                : "rgba(0,0,0,0.06)",
              color: isDark
                ? "rgba(255,255,255,0.5)"
                : "rgba(0,0,0,0.4)",
            }}
          >
            Awaiting
          </span>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
            fill="none"
            stroke={isDark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.35)"}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* SQL Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
          >
            {/* SQL Code Block */}
            <div
              className="mx-3 overflow-hidden"
              style={{
                borderRadius: "12px",
                background: isDark
                  ? "rgba(255,255,255,0.03)"
                  : "rgba(0,0,0,0.02)",
                border: isDark
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "1px solid rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ padding: "8px" }}>
                <pre
                  className="whitespace-pre-wrap wrap-break-word"
                  style={{
                    fontFamily:
                      "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                    fontSize: "13px",
                    lineHeight: "1.65",
                    letterSpacing: "0.01em",
                    color: isDark ? "rgba(255,255,255,0.8)" : "#1d1d1f",
                  }}
                >
                  {sql}
                </pre>
              </div>
            </div>

            {/* Prompt */}
            <div className="pt-3.5 pb-1 px-4">
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

            {/* Action Buttons */}
            <div className="pb-3 pt-2 px-4 grid grid-cols-3 gap-2">
              <motion.button
                whileHover={{ opacity: 0.85 }}
                whileTap={{ opacity: 0.7 }}
                onClick={onApprove}
                disabled={isProcessing}
                style={{
                  ...btnBase,
                  background: isDark ? "#ffffff" : "#000000",
                  color: isDark ? "#000000" : "#ffffff",
                  opacity: isProcessing ? 0.4 : 1,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
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
              </motion.button>

              <motion.button
                whileHover={{ opacity: 0.85 }}
                whileTap={{ opacity: 0.7 }}
                onClick={onReject}
                disabled={isProcessing}
                style={{
                  ...btnBase,
                  opacity: isProcessing ? 0.4 : 1,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
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
              </motion.button>

              <motion.button
                whileHover={{ opacity: 0.85 }}
                whileTap={{ opacity: 0.7 }}
                onClick={onCancel}
                disabled={isProcessing}
                style={{
                  ...btnBase,
                  opacity: isProcessing ? 0.4 : 1,
                  cursor: isProcessing ? "not-allowed" : "pointer",
                }}
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
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
