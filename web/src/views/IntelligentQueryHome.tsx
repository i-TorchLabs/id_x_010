"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { MessageList } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";
import { CenterHero } from "@/components/chat/CenterHero";
import { ChatSidebar, ModelType } from "@/components/chat/ChatSidebar";
import { useTheme } from "@/context/ThemeContext";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LangToggle } from "@/components/LangToggle";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@heroui/react";

import { BASE_URL } from "@/utils/config";

const API_BASE = `${BASE_URL}/b/id_x_010`;

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
          content: data.answer || data.code || "Sorry, an error occurred while processing your request.",
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
          content: "Sorry, could not connect to the server. Please ensure the backend is running.",
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
      {/* ── Sidebar (always mounted, collapse to rail) ── */}
      <ChatSidebar
        modelType={modelType}
        onModelChange={setModelType}
        onNewChat={handleNewChat}
        isCollapsed={!isSidebarOpen}
        onToggleCollapse={() => setIsSidebarOpen(!isSidebarOpen)}
      />

      <main className="flex-1 flex flex-col relative min-w-0">
        {isEmpty ? (
          <>
            <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
              <LangToggle />
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
                    aria-label={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
                    className="icon-btn"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      viewBox="0 0 24 24"
                    >
                      <path d="M15 18l-6-6 6-6" />
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
                      Intelligent Query Assistant
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
                        ? "Thinking..."
                        : `Current model: ${modelType === "local" ? "Local Model" : "External Model"}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onPress={handleNewChat}
                    aria-label="Clear conversation"
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
                  <LangToggle />
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
