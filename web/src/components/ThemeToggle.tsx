"use client";

import { useTheme } from "@/context/ThemeContext";
import type { HTMLAttributes } from "react";

interface ThemeToggleProps extends HTMLAttributes<HTMLButtonElement> {}

export function ThemeToggle({ className = "", ...props }: ThemeToggleProps) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === "dark";

    return (
        <button
            onClick={toggleTheme}
            className={`p-3 rounded-full transition-colors duration-200 ${
                isDark
                    ? "hover:bg-[rgba(255,255,255,0.08)]"
                    : "hover:bg-[rgba(0,0,0,0.05)]"
            } ${className}`}
            aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
            {...props}
        >
            {isDark ? (
                <svg
                    className="w-8 h-8 text-white"
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
                    className="w-8 h-8 text-black"
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
        </button>
    );
}
