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
                {/*整组内容（图标 + 标题 + Input）水平 + 垂直双居中：
                  - flex-1 + justify-center：占满外层高度并垂直居中
                  - items-center：水平居中（图标/Badge/标题/Input 整体居中）
                  - 移除原 paddingTop 84px，让 justify-center 自然处理垂直位置
                  - Input 紧贴副标题下方（marginTop: 32px）保持视觉连贯 */}
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
                        className="mb-7"
                    >
                        <div
                            className="flex items-center justify-center"
                            style={{
                                width: "60px",
                                height: "60px",
                                borderRadius: "18px",
                                background: isDark
                                    ? "rgba(255,255,255,0.06)"
                                    : "rgba(0,0,0,0.04)",
                                border: "0.5px solid var(--divider-strong)",
                                boxShadow:
                                    "var(--shadow-inset), var(--shadow-md)",
                            }}
                        >
                            <svg
                                className="w-8 h-8"
                                fill="none"
                                stroke={isDark ? "#ffffff" : "#1d1d1f"}
                                strokeWidth={1.6}
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
                        <div className="flex justify-center mb-5">
                            <span
                                className="font-text"
                                style={{
                                    fontSize: "11px",
                                    fontWeight: 600,
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    color: "var(--fg2)",
                                    background: "var(--surface-1)",
                                    border: "0.5px solid var(--divider)",
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
                                fontSize: "48px",
                                fontWeight: 600,
                                letterSpacing: "-0.48px",
                                lineHeight: 1.05,
                                color: "var(--fg1)",
                            }}
                        >
                          Data Agent
                        </h1>
                        <motion.p
                            className="font-text"
                            style={{
                                fontSize: "15px",
                                lineHeight: 1.5,
                                letterSpacing: "-0.15px",
                                fontWeight: 400,
                                color: "var(--fg3)",
                                maxWidth: "520px",
                                margin: "20px auto 0",
                            }}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                        >
                            Natural language Q&A, database retrieval, executable code generation
                        </motion.p>
                    </motion.div>

                    {/* Input Area —— 紧贴副标题下方（marginTop 32px，
                        与原 mb-7 / margin 20px 等节奏一致），不再贴底 */}
                    <div className="w-full" style={{ marginTop: "32px" }}>
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
                                fontSize: "11px",
                                fontWeight: 500,
                                letterSpacing: "0.04em",
                                marginTop: "10px",
                                color: "var(--fg4)",
                            }}
                        >
                            Local / external model switching · Built on LangGraph +
                            Semantic Router
                        </motion.p>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
