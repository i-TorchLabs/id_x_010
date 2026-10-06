"use client";

import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";

/**
 * TASK-015：SQL 自然语言"阐述气泡"。
 *
 * 气泡内 4 部分之二：SQL 语句功能概述。
 * 与 SqlApprovalPanel 解耦——只关心 sqlMeaning 是否存在，不依赖审核状态：
 *  - 审核期间：阐述气泡 + 审核面板同时显示
 *  - 审核通过后：审核面板消失，阐述气泡保留（执行中 / 结果出来后仍可见）
 *  - 审核拒绝后：原阐述气泡随新 SQL 重新生成更新
 *
 * 风格与其他 3 个子气泡（思考过程 / SQL 内容 / 回答内容）统一：
 * surface-1 背景 + divider 边 + xs 阴影 + 12px 圆角。
 */
interface SqlExplanationBubbleProps {
  sqlMeaning?: string | null;
}

export function SqlExplanationBubble({ sqlMeaning }: SqlExplanationBubbleProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (!sqlMeaning) {
    return null;
  }

  return (
    <div style={{ padding: "12px 16px 0 16px" }}>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        style={{
          borderRadius: "12px",
          padding: "10px 12px",
          background: "var(--surface-1)",
          border: "0.5px solid var(--divider)",
          boxShadow: "var(--shadow-xs)",
          display: "flex",
          gap: "8px",
          alignItems: "flex-start",
        }}
      >
        {/* 灯泡 / 信息图标 —— 颜色与其他子气泡标题图标一致 */}
        <svg
          className="w-3.5 h-3.5 mt-0.5 flex-shrink-0"
          fill="none"
          stroke={isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)"}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
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
            SQL Overview
          </span>
          <p
            className="font-text leading-relaxed"
            style={{
              fontSize: "13px",
              color: "var(--fg2)",
              margin: 0,
            }}
          >
            {sqlMeaning}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
