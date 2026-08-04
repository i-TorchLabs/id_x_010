"use client";

import { MessageInput } from "@/components/chat/MessageInput";
import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";
import { AgentType } from "./AgentSelector";
import { ModelInfo } from "@/api/graphql";

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
}: CenterHeroProps) {
    const { theme } = useTheme();
    const isDark = theme === "dark";

    return (
        <div
            className={`flex flex-col items-center px-4 relative overflow-hidden h-full ${
                isDark ? "bg-[#000000]" : "bg-[#f5f5f7]"
            }`}
        >
            {/* Animated background gradient */}
            <div
                className="absolute inset-0 pointer-events-none"
                style={{
                    background: isDark
                        ? `radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.08) 0%, transparent 50%),
                           radial-gradient(ellipse at 80% 80%, rgba(255, 255, 255, 0.05) 0%, transparent 40%),
                           radial-gradient(ellipse at 20% 80%, rgba(255, 255, 255, 0.04) 0%, transparent 40%)`
                        : `radial-gradient(ellipse at 50% 0%, rgba(0, 0, 0, 0.06) 0%, transparent 50%),
                           radial-gradient(ellipse at 80% 80%, rgba(0, 0, 0, 0.04) 0%, transparent 40%),
                           radial-gradient(ellipse at 20% 80%, rgba(0, 0, 0, 0.03) 0%, transparent 40%)`,
                }}
            />

            {/* Floating orbs animation */}
            <motion.div
                className="absolute w-96 h-96 rounded-full pointer-events-none"
                style={{
                    background: isDark
                        ? "radial-gradient(circle, rgba(255, 255, 255, 0.1) 0%, transparent 70%)"
                        : "radial-gradient(circle, rgba(0, 0, 0, 0.08) 0%, transparent 70%)",
                    top: "10%",
                    left: "60%",
                    filter: "blur(40px)",
                }}
                animate={{
                    x: [0, 30, 0],
                    y: [0, 20, 0],
                    scale: [1, 1.1, 1],
                }}
                transition={{
                    duration: 8,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
            />
            <motion.div
                className="absolute w-72 h-72 rounded-full pointer-events-none"
                style={{
                    background: isDark
                        ? "radial-gradient(circle, rgba(255, 255, 255, 0.08) 0%, transparent 70%)"
                        : "radial-gradient(circle, rgba(0, 0, 0, 0.06) 0%, transparent 70%)",
                    bottom: "20%",
                    right: "70%",
                    filter: "blur(40px)",
                }}
                animate={{
                    x: [0, -20, 0],
                    y: [0, -30, 0],
                    scale: [1, 1.15, 1],
                }}
                transition={{
                    duration: 10,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1,
                }}
            />

            <div className="w-full max-w-245 relative z-10 flex-1 flex flex-col min-h-0">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6 }}
                    className="relative z-10 flex flex-1 flex-col items-center justify-center"
                >
                    {/* AI Icon with glow effect */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.5 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                            delay: 0.2,
                            type: "spring",
                            stiffness: 300,
                            damping: 20,
                        }}
                        className="mb-8 relative"
                    >
                        <div
                            className="w-20 h-20 rounded-2xl flex items-center justify-center relative"
                            style={{
                                background: isDark
                                    ? "linear-gradient(135deg, #ffffff 0%, #d1d1d6 100%)"
                                    : "linear-gradient(135deg, #1d1d1f 0%, #000000 100%)",
                                boxShadow: isDark
                                    ? "0 8px 32px rgba(255, 255, 255, 0.15), 0 0 0 1px rgba(255,255,255,0.1) inset"
                                    : "0 8px 32px rgba(0, 0, 0, 0.2), 0 0 0 1px rgba(255,255,255,0.5) inset",
                            }}
                        >
                            <svg
                                className={`w-10 h-10 ${isDark ? "text-black" : "text-white"}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                                />
                            </svg>
                        </div>
                    </motion.div>

                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{
                            delay: 0.3,
                            type: "spring",
                            stiffness: 200,
                        }}
                        className="text-center"
                        style={{ marginBottom: "48px" }}
                    >
                        <h1
                            className="font-bold tracking-tight"
                            style={{
                                fontSize: "64px",
                                lineHeight: "1.05",
                                letterSpacing: "-0.03em",
                                color: isDark ? "#ffffff" : "#1d1d1f",
                                fontFamily:
                                    "'Times New Roman', Times, Georgia, serif",
                            }}
                        >
                          TorchLabs
                        </h1>
                        <motion.p
                            className="mt-6"
                            style={{
                                fontSize: "22px",
                                lineHeight: "1.4",
                                letterSpacing: "0.01em",
                                fontWeight: 400,
                                color: isDark
                                    ? "rgba(255,255,255,0.75)"
                                    : "rgba(0,0,0,0.7)",
                                fontFamily:
                                    "'Times New Roman', Times, Georgia, serif",
                                maxWidth: "600px",
                                margin: "24px auto 0",
                            }}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.5 }}
                        >
                            Q&A in natural language, database retrieval,
                            generation of executable code.
                        </motion.p>
                    </motion.div>
                </motion.div>

                <div className="w-full pb-3 shrink-0">
                    <motion.div
                        initial={{ opacity: 0, y: 40 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.8 }}
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
                        />
                    </motion.div>

                    <motion.p
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 1.2 }}
                        className="text-xs text-center"
                        style={{
                            marginTop: "8px",
                            color: isDark
                                ? "rgba(255,255,255,0.4)"
                                : "rgba(0,0,0,0.4)",
                            fontFamily: "'Times New Roman', Times, serif",
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
