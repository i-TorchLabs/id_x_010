"use client";

import type { ReactNode } from "react";
import { ThemeToggle } from "./ThemeToggle";
import { LangToggle } from "./LangToggle";
import LeftPanel from "./LeftPanel";
import {
  useAuthFormMetrics,
  type AuthFormMetrics,
  type AuthFormPreset,
} from "@/hooks/useAuthFormMetrics";

type LeftProps = {
  isTyping: boolean;
  isPasswordFocused: boolean;
  showPassword: boolean;
  passwordLength: number;
  isDark: boolean;
};

/**
 * 认证分屏壳：100dvh + 左右栏 min-h-0，右栏按容器比例缩放内边距与表单宽度。
 * children 为 render-prop，可拿到 metrics 驱动表单字号/间距。
 */
export function AuthSplitShell({
  preset,
  left,
  children,
}: {
  preset: AuthFormPreset;
  left: LeftProps;
  children: (metrics: AuthFormMetrics) => ReactNode;
}) {
  const { wrapRef, metrics: m } = useAuthFormMetrics(preset);

  return (
    <div className="relative h-[100dvh] overflow-hidden">
      <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
        <LangToggle />
        <ThemeToggle />
      </div>
      <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-2">
        <LeftPanel {...left} />
        <div
          ref={wrapRef}
          className="theme-transition flex min-h-0 items-center justify-center overflow-y-auto"
          style={{
            background: "var(--bg)",
            paddingLeft: m.padX,
            paddingRight: m.padX,
            paddingTop: m.padY,
            paddingBottom: m.padY,
          }}
        >
          <div
            className="w-full"
            style={{ maxWidth: m.formW || undefined }}
          >
            {children(m)}
          </div>
        </div>
      </div>
    </div>
  );
}
