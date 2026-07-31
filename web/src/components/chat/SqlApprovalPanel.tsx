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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`rounded-2xl overflow-hidden mt-3 ${
        isDark ? "bg-[#1c1c1e]" : "bg-[#f5f5f7]"
      }`}
      style={{
        border: isDark
          ? "1px solid rgba(255,255,255,0.08)"
          : "1px solid rgba(0,0,0,0.06)",
        boxShadow: isDark
          ? "0 2px 12px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04) inset"
          : "0 2px 12px rgba(0,0,0,0.06), 0 0 0 1px rgba(255,255,255,0.8) inset",
      }}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between py-3 cursor-pointer select-none transition-colors ${
          isDark ? "hover:bg-[#2c2c2e]/60" : "hover:bg-[#ebebf0]"
        }`}
        style={{ paddingLeft: "8px", paddingRight: "16px" }}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span
          className={`text-[13px] font-semibold tracking-tight ${
            isDark ? "text-[rgba(255,255,255,0.9)]" : "text-[#1d1d1f]"
          }`}
        >
          SQL Query Confirmation
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full tracking-wide ${
              isDark ? "text-[rgba(255,255,255,0.5)]" : "text-[rgba(0,0,0,0.4)]"
            }`}
          >
            Awaiting Confirmation
          </span>
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: isDark
                ? "linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.08))"
                : "linear-gradient(135deg, rgba(0,0,0,0.1), rgba(0,0,0,0.05))",
            }}
          >
            <svg
              className={`w-3.5 h-3.5 ${
                isDark ? "text-[#e5e5e5]" : "text-[#1d1d1f]"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            } ${isDark ? "text-[rgba(255,255,255,0.4)]" : "text-[rgba(0,0,0,0.35)]"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>

      {/* SQL Content (collapsible) */}
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
              className={`mx-3 rounded-none overflow-hidden ${
                isDark ? "bg-[#0d0d0d]" : "bg-[#e9e9ee]"
              }`}
              style={{
                border: isDark
                  ? "1px solid rgba(255,255,255,0.06)"
                  : "1px solid rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ padding: "8px" }}>
                <pre
                  className={`text-[13px] whitespace-pre-wrap wrap-break-word font-mono ${
                    isDark ? "text-[#e5e5e5]" : "text-[#1d1d1f]"
                  }`}
                  style={{
                    fontFamily:
                      "'SF Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
                    lineHeight: "1.65",
                    letterSpacing: "0.01em",
                  }}
                >
                  {sql}
                </pre>
              </div>
            </div>

            {/* Prompt Text */}
            <div
              className="pt-3.5 pb-1"
              style={{ paddingLeft: "16px", paddingRight: "16px" }}
            >
              <p
                className={`text-[13px] ${
                  isDark
                    ? "text-[rgba(255,255,255,0.5)]"
                    : "text-[rgba(0,0,0,0.45)]"
                }`}
              >
                Please confirm whether to execute this query:
              </p>
            </div>

            {/* Action Buttons */}
            <div
              className="pb-3 pt-2 grid grid-cols-3 gap-2"
              style={{ paddingLeft: "16px", paddingRight: "16px" }}
            >
              {/* Confirm Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onApprove}
                disabled={isProcessing}
                className="py-2.5 rounded-xl text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isDark ? "#48484a" : "#8e8e93",
                  color: "#ffffff",
                }}
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                Execute
              </motion.button>

              {/* Regenerate Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onReject}
                disabled={isProcessing}
                className="py-2.5 rounded-xl text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isDark ? "#48484a" : "#8e8e93",
                  color: "#ffffff",
                }}
              >
                <svg
                  className="w-4 h-4"
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
                Regenerate
              </motion.button>

              {/* Cancel Button */}
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={onCancel}
                disabled={isProcessing}
                className="py-2.5 rounded-xl text-[13px] font-semibold transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  background: isDark ? "#48484a" : "#8e8e93",
                  color: "#ffffff",
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
                    strokeWidth={2.5}
                    d="M6 18L18 6M6 6l12 12"
                  />
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
