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
    // 模型选择（可选，传入即显示该区块）
    modelType?: ModelType;
    onModelChange?: (model: ModelType) => void;
    // 用户信息（可选）
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
            className="shrink-0 h-full overflow-hidden bg-surface"
        >
            <div className="w-72 h-full flex flex-col border-r border-separator">
            {/* ── Brand ── */}
            <div className="flex items-center gap-2.5 px-5 h-16 shrink-0">
                <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
                    <svg
                        className="w-4.5 h-4.5 text-accent-foreground"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={1.8}
                            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                    </svg>
                </div>
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-foreground leading-tight">
                      TorchLabs
                    </span>
                    <span className="text-[11px] text-muted leading-tight">
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
                    className="font-medium"
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
                            d="M12 4v16m8-8H4"
                        />
                    </svg>
                    新对话
                </Button>
            </div>

            {/* ── Model Selection (optional) ── */}
            {showModelSection && (
                <div className="px-4 shrink-0">
                    <p className="text-[11px] uppercase tracking-wider text-muted font-medium mb-2 px-1">
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
                                            className="w-4 h-4 text-accent"
                                            fill="currentColor"
                                            viewBox="0 0 20 20"
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
                <p className="text-[11px] uppercase tracking-wider text-muted font-medium mb-2 px-1 shrink-0">
                    历史对话
                </p>
                <ScrollShadow className="flex-1 min-h-0">
                    <div className="flex flex-col items-center justify-center py-10 gap-2">
                        <svg
                            className="w-8 h-8 text-muted opacity-50"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                            />
                        </svg>
                        <p className="text-xs text-muted">暂无历史对话</p>
                    </div>
                </ScrollShadow>
            </div>

            <Separator />

            {/* ── User Footer ── */}
            <div className="px-4 py-3 shrink-0 flex items-center gap-2.5">
                <Avatar size="sm">
                    <Avatar.Fallback className="bg-accent text-accent-foreground text-xs font-semibold">
                        {userName.slice(0, 1).toUpperCase()}
                    </Avatar.Fallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                        {userName}
                    </p>
                    <p className="text-[11px] text-muted truncate">
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
                    >
                        <svg
                            className="w-5 h-5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                            />
                        </svg>
                    </Button>
                )}
            </div>
            </div>
        </motion.aside>
    );
}
