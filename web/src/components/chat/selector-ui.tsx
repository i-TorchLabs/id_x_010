/**
 * 选择器通用 UI 片段 —— Model / Agent / Database 三个下拉选择器共用：
 * 弹层分组标题、选中态对勾、单色小徽章，保证三者视觉一致。
 *
 * 注意：HeroUI 的样式表未分 @layer（unlayered），会压过 Tailwind utilities，
 * 因此与 HeroUI slot 冲突的属性（圆角 / 内边距 / 字号等）统一用 inline style
 * 或 globals.css 中的 .selector-trigger / .selector-popover 覆盖。
 */

"use client";

import type { CSSProperties, ReactNode } from "react";
import { Header } from "react-aria-components";

/** 弹层顶部的分组小标题 */
export function SelectorHeader({ children }: { children: ReactNode }) {
  return (
    <div
      className="label-section select-none"
      style={{ padding: "10px 14px 2px" }}
    >
      {children}
    </div>
  );
}

/** 弹层内分组块的小标题（厂商名 / Custom），必须用 react-aria 的 Header 才能参与集合渲染 */
export function SelectorGroupLabel({ children }: { children: ReactNode }) {
  return (
    <Header
      className="label-section select-none"
      style={{ padding: "8px 10px 4px" }}
    >
      {children}
    </Header>
  );
}

/** 选中态对勾（条目右侧，淡入淡出） */
export function SelectorCheck({ visible }: { visible: boolean }) {
  return (
    <svg
      aria-hidden
      className={`shrink-0 transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{ width: 15, height: 15, color: "var(--fg)" }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** 单色小徽章（系统模型 / Under development 等） */
export function SelectorBadge({ children }: { children: ReactNode }) {
  return (
    <span
      className="shrink-0 select-none"
      style={{
        fontSize: 9,
        lineHeight: "16px",
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "0 6px",
        borderRadius: 980,
        background: "var(--badge-bg)",
        color: "var(--fg2)",
      }}
    >
      {children}
    </span>
  );
}

/** ListBox.Item 的统一行内样式（HeroUI 默认圆角/间距偏大，inline 覆盖） */
export const selectorItemStyle: CSSProperties = {
  borderRadius: 10,
  padding: "8px 10px",
  gap: 10,
};

/** ListBox 容器的统一内边距（配合顶部 SelectorHeader） */
export const selectorListStyle: CSSProperties = {
  padding: "4px 6px 6px",
};
