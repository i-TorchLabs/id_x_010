"use client";

import { Avatar, Button, ScrollShadow, Separator } from "@heroui/react";
import { motion } from "framer-motion";

export type ModelType = "local" | "external";

const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
    { value: "local", label: "本地模型" },
    { value: "external", label: "外部模型" },
];

interface ChatSidebarProps {
    onNewChat: () => void;
    modelType?: ModelType;
    onModelChange?: (model: ModelType) => void;
    userName?: string;
    userEmail?: string;
    onLogout?: () => void;
}

export function ChatSidebar({
    onNewChat,
    modelType,
    onModelChange,
    userName = "访客用户",
    userEmail = "guest@sme-ai.local",
    onLogout,
}: ChatSidebarProps) {
    const showModelSection = modelType !== undefined && onModelChange;

    return (
        <motion.aside
            initial={{ width: 0 }}
            animate={{ width: 288 }}
            exit={{ width: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="shrink-0 h-full overflow-hidden"
            style={{ background: "var(--bg)" }}
        >
            <div
                className="w-72 h-full flex flex-col"
                style={{ borderRight: "0.5px solid var(--divider)" }}
            >
                {/* ── Brand ── */}
                <div className="flex items-center gap-2.5 px-5 h-14 shrink-0">
                    <div
                        className="flex items-center justify-center"
                        style={{
                            width: "22px",
                            height: "22px",
                            borderRadius: "6px",
                            background: "var(--accent)",
                        }}
                    >
                        <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="var(--accent-fg)"
                            strokeWidth={1.8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                        >
                            <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <div className="flex flex-col">
                        <span
                            className="font-display leading-tight"
                            style={{
                                fontSize: "17px",
                                fontWeight: 600,
                                letterSpacing: "-0.374px",
                                color: "var(--fg)",
                            }}
                        >
                          Data Agent
                        </span>
                        <span
                            className="font-text leading-tight"
                            style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "var(--fg3)",
                            }}
                        >
                            智能问数系统
                        </span>
                    </div>
                </div>

                <Separator />

                {/* ── New Chat ── */}
                <div className="px-4 py-4 shrink-0">
                    <Button
                        fullWidth
                        variant="primary"
                        onPress={onNewChat}
                        className="rounded-full font-semibold"
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
                            <path d="M12 4v16m8-8H4" />
                        </svg>
                        新对话
                    </Button>
                </div>

                {/* ── Model Selection ── */}
                {showModelSection && (
                    <div className="px-4 shrink-0">
                        <p
                            className="font-text mb-2 px-1"
                            style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "var(--fg3)",
                            }}
                        >
                            模型选择
                        </p>
                        <div className="flex flex-col gap-1.5">
                            {MODEL_OPTIONS.map((option) => {
                                const isSelected = modelType === option.value;
                                return (
                                    <Button
                                        key={option.value}
                                        fullWidth
                                        variant={isSelected ? "secondary" : "ghost"}
                                        onPress={() => onModelChange(option.value)}
                                        className="justify-start"
                                    >
                                        <span className="flex-1 text-left">
                                            {option.label}
                                        </span>
                                        {isSelected && (
                                            <svg
                                                className="w-4 h-4"
                                                fill="currentColor"
                                                viewBox="0 0 20 20"
                                                style={{ color: "var(--fg)" }}
                                            >
                                                <path
                                                    fillRule="evenodd"
                                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                        )}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── History ── */}
                <div className="flex-1 min-h-0 flex flex-col px-4 mt-6">
                    <p
                        className="font-text mb-2 px-1 shrink-0"
                        style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "var(--fg3)",
                        }}
                    >
                        历史对话
                    </p>
                    <ScrollShadow className="flex-1 min-h-0">
                        <div className="flex flex-col items-center justify-center py-10 gap-2">
                            <svg
                                className="w-8 h-8 opacity-50"
                                fill="none"
                                stroke="var(--fg3)"
                                strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                viewBox="0 0 24 24"
                            >
                                <path d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                            </svg>
                            <p
                                className="font-text"
                                style={{
                                    fontSize: "12px",
                                    color: "var(--fg3)",
                                }}
                            >
                                暂无历史对话
                            </p>
                        </div>
                    </ScrollShadow>
                </div>

                <Separator />

                {/* ── User Footer ── */}
                <div className="px-4 py-3 shrink-0 flex items-center gap-2.5">
                    <Avatar size="sm">
                        <Avatar.Fallback
                            className="text-xs font-semibold"
                            style={{
                                background: "var(--accent)",
                                color: "var(--accent-fg)",
                            }}
                        >
                            {userName.slice(0, 1).toUpperCase()}
                        </Avatar.Fallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                        <p
                            className="font-text truncate"
                            style={{
                                fontSize: "14px",
                                fontWeight: 500,
                                color: "var(--fg)",
                            }}
                        >
                            {userName}
                        </p>
                        <p
                            className="font-text truncate"
                            style={{
                                fontSize: "11px",
                                color: "var(--fg3)",
                            }}
                        >
                            {userEmail}
                        </p>
                    </div>
                    {onLogout && (
                        <Button
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            onPress={onLogout}
                            aria-label="登出"
                            className="icon-btn"
                        >
                            <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.5}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                viewBox="0 0 24 24"
                            >
                                <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                        </Button>
                    )}
                </div>
            </div>
        </motion.aside>
    );
}
