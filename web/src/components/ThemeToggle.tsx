"use client";

import { Button } from "@heroui/react";
import { useTheme } from "@/context/ThemeContext";

interface ThemeToggleProps {
    className?: string;
}

/**
 * 明暗模式切换按钮
 *
 * 使用与 header 中"清空对话"按钮完全相同的 HeroUI Button API
 * (`isIconOnly` + `variant="ghost"` + `size="sm"` + `w-5 h-5` 图标)，
 * 保证两者在并排展示时像素级一致。
 */
export function ThemeToggle({ className = "" }: ThemeToggleProps) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === "dark";

    return (
        <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={toggleTheme}
            aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
            className={className}
        >
            {isDark ? (
                <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    aria-hidden
                >
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
            ) : (
                <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    viewBox="0 0 24 24"
                    aria-hidden
                >
                    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
            )}
        </Button>
    );
}
