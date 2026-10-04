"use client";

import { Avatar, Button, Separator } from "@heroui/react";
import { motion } from "framer-motion";
import { PromptPanel } from "./PromptPanel";
import type { MarkdownPromptItem } from "@/api/graphql";

export type ModelType = "local" | "external";

const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
    { value: "local", label: "Local Model" },
    { value: "external", label: "External Model" },
];

interface ChatSidebarProps {
    onNewChat: () => void;
    modelType?: ModelType;
    onModelChange?: (model: ModelType) => void;
    userName?: string;
    userEmail?: string;
    avatarUrl?: string | null;
    onLogout?: () => void;
    onSettings?: () => void;
    onUsageStats?: () => void;
    onEditProfile?: () => void;
    onActivePromptChange?: (prompt: MarkdownPromptItem | null) => void;
}

export function ChatSidebar({
    onNewChat,
    modelType,
    onModelChange,
    userName = "Guest",
    userEmail = "guest@sme-ai.local",
    avatarUrl,
    onLogout,
    onSettings,
    onUsageStats,
    onEditProfile,
    onActivePromptChange,
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
                            width: "24px",
                            height: "24px",
                            borderRadius: "7px",
                            background: "var(--accent)",
                            boxShadow: "var(--shadow-sm)",
                        }}
                    >
                        <svg
                            className="w-4 h-4"
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
                                fontSize: "16px",
                                fontWeight: 600,
                                letterSpacing: "-0.32px",
                                color: "var(--fg1)",
                            }}
                        >
                          Data Agent
                        </span>
                        <span
                            className="font-text leading-tight"
                            style={{
                                fontSize: "11px",
                                fontWeight: 500,
                                letterSpacing: "0.06em",
                                textTransform: "uppercase",
                                color: "var(--fg3)",
                            }}
                        >
                            Intelligent Query System
                        </span>
                    </div>
                </div>

                <Separator />

                {/* ── New Chat ── */}
                <div className="px-4 py-3 shrink-0">
                    <Button
                        fullWidth
                        variant="primary"
                        onPress={onNewChat}
                        className="rounded-full font-semibold"
                        style={{
                            boxShadow: "var(--shadow-sm)",
                            letterSpacing: "-0.01em",
                        }}
                    >
                        <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                        >
                            <path d="M12 4v16m8-8H4" />
                        </svg>
                        New Chat
                    </Button>
                </div>

                {/* ── Model Selection ── */}
                {showModelSection && (
                    <div className="px-4 shrink-0">
                        <p
                            className="label-section mb-2 px-1"
                        >
                            Model Selection
                        </p>
                        <div className="flex flex-col gap-1">
                            {MODEL_OPTIONS.map((option) => {
                                const isSelected = modelType === option.value;
                                return (
                                    <Button
                                        key={option.value}
                                        fullWidth
                                        variant={isSelected ? "secondary" : "ghost"}
                                        onPress={() => onModelChange(option.value)}
                                        className="justify-start"
                                        style={{
                                            borderRadius: "10px",
                                            background: isSelected
                                                ? "var(--surface-1)"
                                                : "transparent",
                                            border: isSelected
                                                ? "0.5px solid var(--divider-strong)"
                                                : "0.5px solid transparent",
                                        }}
                                    >
                                        <span
                                            className="flex-1 text-left"
                                            style={{
                                                fontSize: "13px",
                                                fontWeight: isSelected ? 600 : 500,
                                                color: isSelected
                                                    ? "var(--fg1)"
                                                    : "var(--fg2)",
                                            }}
                                        >
                                            {option.label}
                                        </span>
                                        {isSelected && (
                                            <svg
                                                className="w-4 h-4"
                                                fill="currentColor"
                                                viewBox="0 0 20 20"
                                                style={{ color: "var(--fg1)" }}
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

                {/* ── Prompt Library ── */}
                <div className="mt-4 shrink-0">
                    <PromptPanel onActivePromptChange={onActivePromptChange} />
                </div>

                {/* 占位：将用户区推至侧栏底部（原“历史对话”页签已移除） */}
                <div className="flex-1" aria-hidden />

                <Separator />

                {/* ── User Footer ── */}
                <div
                    className="px-3 py-2.5 shrink-0 flex items-center gap-2 mx-2 mb-2 rounded-xl"
                    style={{
                        background: "var(--surface-1)",
                        border: "0.5px solid var(--divider)",
                    }}
                >
                    <button
                        type="button"
                        onClick={onEditProfile}
                        disabled={!onEditProfile}
                        aria-label="Edit profile"
                        className="shrink-0 rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2"
                        style={{
                            outlineOffset: 2,
                            cursor: onEditProfile ? "pointer" : "default",
                        }}
                    >
                        <Avatar size="sm">
                            {avatarUrl && (
                                <Avatar.Image
                                    src={avatarUrl}
                                    alt={userName}
                                />
                            )}
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
                    </button>
                    <div
                        className={`flex-1 min-w-0 ${onEditProfile ? "cursor-pointer" : ""}`}
                        onClick={onEditProfile}
                    >
                        <p
                            className="font-text truncate"
                            style={{
                                fontSize: "13px",
                                fontWeight: 600,
                                color: "var(--fg1)",
                                letterSpacing: "-0.01em",
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
                    {onUsageStats && (
                        <Button
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            onPress={onUsageStats}
                            aria-label="Usage statistics"
                            className="icon-btn"
                        >
                            <svg
                                className="w-[18px] h-[18px]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.6}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                viewBox="0 0 24 24"
                            >
                                <path d="M3 3v18h18" />
                                <path d="M7 14v3" />
                                <path d="M12 9v8" />
                                <path d="M17 5v12" />
                            </svg>
                        </Button>
                    )}
                    {onSettings && (
                        <Button
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            onPress={onSettings}
                            aria-label="Settings"
                            className="icon-btn"
                        >
                            <svg
                                className="w-[18px] h-[18px]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.6}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                viewBox="0 0 24 24"
                            >
                                <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </Button>
                    )}
                    {onLogout && (
                        <Button
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            onPress={onLogout}
                            aria-label="Log out"
                            className="icon-btn"
                        >
                            <svg
                                className="w-[18px] h-[18px]"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={1.6}
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
