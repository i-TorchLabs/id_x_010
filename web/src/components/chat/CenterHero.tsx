"use client";

import { MessageInput } from "@/components/chat/MessageInput";
import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";
import { AgentType } from "./AgentSelector";
import { ModelInfo, MarkdownPromptItem } from "@/api/graphql";

interface CenterHeroProps {
    onSubmit: (
        text: string,
        selectedModel?: any,
        agentType?: AgentType,
        dbName?: string | null,
    ) => void;
    selectedDb?: string | null;
    onDbChange?: (dbName: string | null) => void;
    selectedModel?: ModelInfo | null;
    onModelChange?: (model: ModelInfo | null) => void;
    selectedAgent?: AgentType;
    onAgentChange?: (agent: AgentType) => void;
    models?: ModelInfo[];
    isLoadingModels?: boolean;
    activePrompt?: MarkdownPromptItem | null;
}

export function CenterHero({
    onSubmit,
    selectedDb,
    onDbChange,
    selectedModel,
    onModelChange,
    selectedAgent,
    onAgentChange,
    models,
    isLoadingModels,
    activePrompt,
}: CenterHeroProps) {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    return (
        <div
            className="flex flex-col items-center px-4 relative overflow-hidden h-full theme-transition"
            style={{ background: "var(--bg)" }}
        >
            {/* Subtle accent gradient (Hero spec: 135deg from card to accent low opacity) */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: isDark
                        ? "linear-gradient(135deg, #1c1c1e 0%, rgba(255,255,255,0.04) 100%)"
                        : "linear-gradient(135deg, #ffffff 0%, rgba(0,0,0,0.02) 100%)",
                    opacity: 0.5,
                }}
            />

            <div className="w-full max-w-270 relative z-10 flex-1 flex flex-col min-h-0">
                <motion.div
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
                    className="relative z-10 flex flex-1 flex-col items-center justify-center"
                >
                    {/* Icon container */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                            delay: 0.2,
                            duration: 0.45,
                            ease: [0.25, 0.4, 0.25, 1],
                        }}
                        className="mb-8"
                    >
                        <div
                            className="flex items-center justify-center"
                            style={{
                                width: "56px",
                                height: "56px",
                                borderRadius: "20px",
                                background: "transparent",
                            }}
                        >
                            <svg
                                className="w-8 h-8"
                                fill="none"
                                stroke={isDark ? "#ffffff" : "#1d1d1f"}
                                strokeWidth={1.8}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                viewBox="0 0 24 24"
                            >
                                <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                        </div>
                    </motion.div>

                    {/* Title & Subtitle */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                            delay: 0.3,
                            duration: 0.45,
                            ease: [0.25, 0.4, 0.25, 1],
                        }}
                        className="text-center"
                    >
                        {/* Badge */}
                        <div className="flex justify-center mb-6">
                            <span
                                className="font-text"
                                style={{
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    letterSpacing: "0.08em",
                                    textTransform: "uppercase",
                                    color: isDark ? "#ffffff" : "#000000",
                                    background: isDark
                                        ? "rgba(255,255,255,0.10)"
                                        : "rgba(0,0,0,0.06)",
                                    borderRadius: "980px",
                                    padding: "5px 14px",
                                }}
                            >
                                AI-Powered
                            </span>
                        </div>

                        <h1
                            className="font-display"
                            style={{
                                fontSize: "52px",
                                fontWeight: 600,
                                letterSpacing: "-0.52px",
                                lineHeight: 1.05,
                                color: isDark ? "#ffffff" : "#1d1d1f",
                            }}
                        >
                          Data Agent
                        </h1>
                        <motion.p
                            className="font-text"
                            style={{
                                fontSize: "15px",
                                lineHeight: 1.4,
                                letterSpacing: "-0.20px",
                                fontWeight: 400,
                                color: isDark
                                    ? "rgba(255,255,255,0.45)"
                                    : "rgba(0,0,0,0.45)",
                                maxWidth: "520px",
                                margin: "24px auto 0",
                            }}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                        >
                            自然语言问答、数据库检索、可执行代码生成
                        </motion.p>
                    </motion.div>
                </motion.div>

                {/* Input Area */}
                <div className="w-full pb-3 shrink-0">
                    <motion.div
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                            delay: 0.8,
                            duration: 0.6,
                            ease: [0.25, 0.4, 0.25, 1],
                        }}
                        className="w-full"
                    >
                        <MessageInput
                            variant="hero"
                            onSendMessage={onSubmit}
                            selectedDb={selectedDb}
                            onDbChange={onDbChange}
                            selectedModel={selectedModel}
                            onModelChange={onModelChange}
                            selectedAgent={selectedAgent}
                            onAgentChange={onAgentChange}
                            models={models}
                            isLoadingModels={isLoadingModels}
                            activePrompt={activePrompt}
                        />
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.2 }}
                        className="text-center font-text"
                        style={{
                            fontSize: "12px",
                            fontWeight: 600,
                            letterSpacing: "0.04em",
                            marginTop: "8px",
                            color: isDark
                                ? "rgba(255,255,255,0.25)"
                                : "rgba(0,0,0,0.25)",
                        }}
                    >
                        支持本地模型 / 外部模型切换 · 基于 LangGraph + Semantic
                        Router
                    </motion.p>
                </div>
            </div>
        </div>
    );
}
