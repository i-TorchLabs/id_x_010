"use client";

import { useWorkbenchScale } from "@/hooks/useWorkbenchScale";

/** 全站挂载工作台视口比例 CSS 变量（--wb-*） */
export function ViewportScaleProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useWorkbenchScale();
  return <>{children}</>;
}
