"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { CenterHero } from "@/components/chat/CenterHero";
import { ChatSidebar, ModelType } from "@/components/chat/ChatSidebar";
import { useTheme } from "@/context/ThemeContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@heroui/react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:18080/b/048";

type ChatMessage = {
  id: string;
  type: "user" | "assistant";
  content: string;
  timestamp: Date;
  sql?: string;
  code?: string;
  intent?: string;
  thinking?: string;
  thinkingTime?: number;
  modelUsed?: string;
};

export default function IntelligentQueryHome() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [modelType, setModelType] = useState<ModelType>("local");
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = useCallback(
    async (
      content: string,
      selectedModel?: any,
      agentType?: any,
      dbName?: string | null,
    ) => {
      if (!content.trim()) return;

      const userMessage: ChatMessage = {
        id: String(Date.now()),
        type: "user",
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsTyping(true);

      try {
        const response = await fetch(`${API_BASE}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: content,
            model_type: modelType,
          }),
        });

        const data = await response.json();

        const reply: ChatMessage = {
          id: String(Date.now() + 1),
          type: "assistant",
          content: data.answer || data.code || "抱歉，处理您的请求时出现错误。",
          timestamp: new Date(),
          sql: data.sql,
          code: data.code,
          intent: data.intent,
          thinking: data.thinking,
          thinkingTime: data.thinkingTime,
          modelUsed: data.modelUsed,
        };

        setMessages((prev) => [...prev, reply]);
      } catch (error) {
        const errorMessage: ChatMessage = {
          id: String(Date.now() + 1),
          type: "assistant",
          content: "抱歉，连接服务器失败。请确保后端服务正在运行。",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsTyping(false);
      }
    },
    [modelType],
  );

  const handleNewChat = () => {
    setMessages([]);
  };

  const isEmpty = messages.length === 0;
  const isDark = theme === "dark";

  return (
    <div
      className="flex h-screen theme-transition"
      style={{ background: "var(--bg)" }}
    >
      {/* ── Sidebar ── */}
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <ChatSidebar
            modelType={modelType}
            onModelChange={setModelType}
            onNewChat={handleNewChat}
          />
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col relative min-w-0">
        {isEmpty ? (
          <>
            <div className="absolute top-4 right-4 z-50">
              <ThemeToggle />
            </div>
            <CenterHero
              onSubmit={handleSendMessage}
              selectedDb={selectedDb}
              onDbChange={setSelectedDb}
            />
          </>
        ) : (
          <>
            {/* ── NavBar (56px, glass) ── */}
            <motion.header
              initial={{ y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className="nav-glass"
              style={{ height: "56px" }}
            >
              <div className="w-full h-full flex items-center justify-between px-6.75">
                <div className="flex items-center gap-3">
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onPress={() => setIsSidebarOpen(!isSidebarOpen)}
                    aria-label={isSidebarOpen ? "收起侧边栏" : "展开侧边栏"}
                    className="icon-btn"
                  >
                    <svg
                      className="w-8 h-8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d={
                          isSidebarOpen
                            ? "M6 18L18 6M6 6l12 12"
                            : "M4 6h16M4 12h16M4 18h16"
                        }
                      />
                    </svg>
                  </Button>
                  <div>
                    <h2
                      className="font-display"
                      style={{
                        fontSize: "17px",
                        fontWeight: 600,
                        letterSpacing: "-0.374px",
                        color: "var(--fg)",
                      }}
                    >
                      智能问数助手
                    </h2>
                    <p
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        textTransform: "uppercase",
                        color: "var(--fg3)",
                      }}
                    >
                      {isTyping
                        ? "思考中..."
                        : `当前模型: ${modelType === "local" ? "本地模型" : "外部模型"}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onPress={handleNewChat}
                    aria-label="清空对话"
                    className="icon-btn"
                  >
                    <svg
                      className="w-8 h-8"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </Button>
                  <ThemeToggle />
                </div>
              </div>
            </motion.header>

            <div className="flex-1 overflow-hidden">
              <MessageList messages={messages} />

              <AnimatePresence>
                {isTyping && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="px-8 pb-4"
                  >
                    <div
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg"
                      style={{ background: "var(--input-bg)" }}
                    >
                      <div className="flex gap-1">
                        {[0, 0.2, 0.4].map((delay, i) => (
                          <motion.span
                            key={i}
                            animate={{
                              opacity: [0.4, 1, 0.4],
                            }}
                            transition={{
                              duration: 1.5,
                              repeat: Infinity,
                              delay,
                            }}
                            className="w-2 h-2 rounded-full"
                            style={{ background: "var(--fg)" }}
                          />
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <div ref={messagesEndRef} />
            </div>

            <MessageInput
              variant="footer"
              onSendMessage={handleSendMessage}
              selectedDb={selectedDb}
              onDbChange={setSelectedDb}
            />
          </>
        )}
      </main>
    </div>
  );
}
