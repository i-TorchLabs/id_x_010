"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";
import { Button, ListBox, Select } from "@heroui/react";
import { modelGraphqlApi, ModelInfo } from "@/api/graphql";
import { AgentSelector, AgentType } from "./AgentSelector";
import { DatabaseSelector } from "./DatabaseSelector";

type Variant = "footer" | "hero";

// 模型选择器 —— 框体宽度自适应当前文字内容长度
function ModelSelector({
  models,
  selectedModel,
  setSelectedModel,
  isLoadingModels,
  isSmall,
}: {
  models: ModelInfo[];
  selectedModel: ModelInfo | null;
  setSelectedModel: (m: ModelInfo | null) => void;
  isLoadingModels: boolean;
  isSmall: boolean;
}) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  // 当前在触发器中显示的文字：选中项的 "name (provider)"；未选中用 placeholder
  const displayText = selectedModel
    ? `${selectedModel.name} (${selectedModel.provider})`
    : isLoadingModels
      ? "加载中..."
      : "无可用模型";

  useLayoutEffect(() => {
    if (measureRef.current) {
      // offsetWidth 已含 padding，测量 span 不带 padding，所以只测文字
      setWidth(measureRef.current.offsetWidth);
    }
  }, [displayText, isSmall]);

  // 文字宽度 + 触发器左右 padding(各 12px) + indicator(约 20px) + 冗余
  // 给下限避免过窄,给上限避免撑爆输入框；冗余确保不触发省略号换行
  const minW = isSmall ? 96 : 120;
  const maxW = isSmall ? 220 : 280;
  const triggerWidth =
    width != null
      ? `min(${maxW}px, max(${minW}px, ${width + 36}px))`
      : `${minW}px`;

  return (
    <Select
      aria-label="模型"
      value={selectedModel ? String(selectedModel.id) : null}
      onChange={(key) => {
        const model = models.find((m) => m.id === Number(key));
        setSelectedModel(model || null);
      }}
      isDisabled={isLoadingModels || models.length === 0}
      disabledKeys={models
        .filter(
          (m) =>
            m.name.includes("Under deployment") ||
            m.provider.includes("Under deployment"),
        )
        .map((m) => String(m.id))}
      placeholder={isLoadingModels ? "加载中..." : "无可用模型"}
      variant="secondary"
      className="w-auto"
      style={{ width: triggerWidth }}
    >
      <Select.Trigger
        className={`${isSmall ? "h-9 px-1.5" : "h-11 px-2"} whitespace-nowrap overflow-hidden flex items-center`}
      >
        <Select.Value
          className={`!flex !flex-1 !min-w-0 h-auto ${isSmall ? "h-7 text-xs" : "h-9 text-sm"} px-2.5 !items-center !justify-center !text-center rounded-md font-medium truncate bg-default/60 text-foreground`}
        >
          {({ selectedText, isPlaceholder }) => (
            <span className="block w-full text-center truncate">
              {isPlaceholder
                ? (isLoadingModels ? "加载中..." : "无可用模型")
                : selectedText}
            </span>
          )}
        </Select.Value>
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {models.map((model) => (
            <ListBox.Item
              key={model.id}
              id={String(model.id)}
              textValue={`${model.name} (${model.provider})`}
            >
              {({ isSelected }) => (
                <span className="flex items-center gap-2 w-full">
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 transition-opacity ${
                      isSelected ? "bg-green-500 opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="flex-1">
                    {model.name} ({model.provider})
                  </span>
                </span>
              )}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      {/* 隐藏测量元素：与 Trigger 文字字体一致,用于计算自适应宽度 */}
      <span
        ref={measureRef}
        aria-hidden
        className={`${isSmall ? "text-xs" : "text-sm"} font-medium`}
        style={{
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          left: -9999,
          top: -9999,
        }}
      >
        {displayText}
      </span>
    </Select>
  );
}

interface MessageInputProps {
  onSendMessage: (
    message: string,
    selectedModel?: ModelInfo,
    agentType?: AgentType,
    dbName?: string | null,
  ) => void;
  variant?: Variant;
  dark?: boolean;
  isStreaming?: boolean; // 流式传输状态，为 true 时禁用提交
  selectedDb?: string | null;
  onDbChange?: (dbName: string | null) => void;
  // 受控模式：由父组件管理选中状态
  selectedModel?: ModelInfo | null;
  onModelChange?: (model: ModelInfo | null) => void;
  selectedAgent?: AgentType;
  onAgentChange?: (agent: AgentType) => void;
  // 模型列表（受控模式，由父组件传入）
  models?: ModelInfo[];
  isLoadingModels?: boolean;
}

export function MessageInput({
  onSendMessage,
  variant = "footer",
  isStreaming = false, // 默认 false
  selectedDb = null,
  onDbChange,
  selectedModel: controlledModel,
  onModelChange,
  selectedAgent: controlledAgent,
  onAgentChange,
  models: controlledModels,
  isLoadingModels: controlledIsLoadingModels,
}: MessageInputProps) {
  const [input, setInput] = useState("");
  const [internalModels, setInternalModels] = useState<ModelInfo[]>([]);
  const [internalSelectedModel, setInternalSelectedModel] =
    useState<ModelInfo | null>(null);
  const [internalSelectedAgent, setInternalSelectedAgent] =
    useState<AgentType>("general");
  const [internalIsLoadingModels, setInternalIsLoadingModels] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme } = useTheme();
  const isDark = theme === "dark";

  // 受控/非受控模式切换
  const models =
    controlledModels !== undefined ? controlledModels : internalModels;
  const selectedModel =
    controlledModel !== undefined ? controlledModel : internalSelectedModel;
  const setSelectedModel = onModelChange ?? setInternalSelectedModel;
  const selectedAgent =
    controlledAgent !== undefined ? controlledAgent : internalSelectedAgent;
  const setSelectedAgent = onAgentChange ?? setInternalSelectedAgent;
  const isLoadingModels =
    controlledIsLoadingModels !== undefined
      ? controlledIsLoadingModels
      : internalIsLoadingModels;

  // 加载模型列表（仅非受控模式时内部加载；受控模式由父组件管理）
  useEffect(() => {
    if (controlledModels !== undefined) return;

    let cancelled = false;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 1000; // 基础重试延迟
    const REQUEST_TIMEOUT = 10000; // 10秒超时

    const loadModels = async (attempt = 0) => {
      if (cancelled) return;
      setInternalIsLoadingModels(true);
      let retrying = false;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

        try {
          const response = await modelGraphqlApi.getModels(controller.signal);
          clearTimeout(timeoutId);
          if (cancelled) return;
          if (response.getModels.success) {
            setInternalModels(response.getModels.models);
            setInternalSelectedModel((prev) =>
              prev === null && response.getModels.models.length > 0
                ? response.getModels.models[0]
                : prev,
            );
          } else if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY * Math.pow(2, attempt);
            console.warn(
              `加载模型列表失败（第 ${attempt + 1} 次）: ${response.getModels.message}，${delay}ms 后重试`,
            );
            retrying = true;
            setTimeout(() => loadModels(attempt + 1), delay);
            return;
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          throw fetchError;
        }
      } catch (error) {
        if (cancelled) return;
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY * Math.pow(2, attempt);
          console.warn(
            `加载模型列表异常（第 ${attempt + 1} 次），${delay}ms 后重试:`,
            error,
          );
          retrying = true;
          setTimeout(() => loadModels(attempt + 1), delay);
          return;
        }
        console.error("加载模型列表最终失败:", error);
      } finally {
        if (!cancelled && !retrying) {
          setInternalIsLoadingModels(false);
        }
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, [controlledModels]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 250)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSendMessage(input, selectedModel || undefined, selectedAgent, selectedDb);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const renderModelSelector = (isSmall: boolean) => (
    <ModelSelector
      models={models}
      selectedModel={selectedModel}
      setSelectedModel={setSelectedModel}
      isLoadingModels={isLoadingModels}
      isSmall={isSmall}
    />
  );

  const renderAttachmentButton = (isSmall: boolean) => (
    <Button
      isIconOnly
      variant="ghost"
      size={isSmall ? "sm" : "md"}
      aria-label="添加附件"
    >
      <svg
        className={isSmall ? "w-4 h-4" : "w-6 h-6"}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
        />
      </svg>
    </Button>
  );

  const renderSendButton = (isSmall: boolean) => (
    <Button
      isIconOnly
      variant="primary"
      size={isSmall ? "sm" : "md"}
      onPress={handleSend}
      isDisabled={!input.trim() || isStreaming}
      aria-label="发送"
    >
      <svg
        className={isSmall ? "w-4 h-4" : "w-6 h-6"}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
      </svg>
    </Button>
  );

  if (variant === "hero") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="w-full"
      >
        <div className="relative w-full">
          <motion.div
            className={`w-full rounded-2xl transition-all duration-300 ${
              isDark ? "bg-[#1c1c1e]" : "bg-white"
            }`}
            style={{
              boxShadow: "rgba(0, 0, 0, 0.22) 3px 5px 30px 0px",
              minHeight: "210px",
            }}
          >
            <div
              className="flex flex-col justify-between h-full p-4"
              style={{ minHeight: "210px" }}
            >
              {/* Middle - textarea with bottom action buttons */}
              <div className="flex-1 min-h-0 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  rows={1}
                  className={`w-full h-full bg-transparent border-none outline-none resize-none font-medium text-lg ${
                    isDark
                      ? "text-white placeholder-[rgba(255,255,255,0.48)]"
                      : "text-[#1d1d1f] placeholder-[rgba(0,0,0,0.48)]"
                  } transition-all duration-200`}
                  style={{
                    fontFamily: "'Times New Roman', Times, serif",
                    lineHeight: "normal",
                    maxHeight: "200px",
                    minHeight: "80px",
                    minWidth: "312px",
                    boxSizing: "border-box",
                    padding: "16px",
                    margin: "8px",
                  }}
                />

                {/* Left bottom - attachment button */}
                <div className="absolute left-3 bottom-3 flex items-center">
                  {renderAttachmentButton(false)}
                </div>

                {/* Right bottom - Database selector, Agent selector, model selector and send button */}
                <div className="absolute right-3 bottom-3 flex items-center gap-3">
                  {/* Database Selector - 仅 SQL/Code Agent 时显示 */}
                  {selectedAgent !== "general" && (
                    <DatabaseSelector
                      selectedDb={selectedDb}
                      onDbChange={onDbChange || (() => {})}
                    />
                  )}

                  {/* Agent Selector */}
                  <AgentSelector
                    selectedAgent={selectedAgent}
                    onAgentChange={setSelectedAgent}
                    variant="dropdown"
                  />

                  {/* Model Selector */}
                  {renderModelSelector(false)}

                  {renderSendButton(false)}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>
    );
  }

  // Footer variant
  return (
    <motion.div
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      className={`w-full backdrop-blur-sm ${
        isDark ? "bg-[#000000]/80" : "bg-[#f5f5f7]/80"
      }`}
      style={{
        borderTop: isDark ? "none" : "1px solid rgba(0, 0, 0, 0.08)",
      }}
    >
      <div
        className="py-3 pb-4"
        style={{ paddingLeft: "27px", paddingRight: "27px" }}
      >
        <div className="w-full">
          <div className="flex items-end gap-3">
            <div
              className={`flex-1 relative rounded-2xl ${
                isDark ? "bg-[#1c1c1e]" : "bg-white"
              } focus-within:ring-2 focus-within:ring-opacity-50 ${
                isDark
                  ? "focus-within:ring-[#48484a]"
                  : "focus-within:ring-[#1d1d1f]"
              } transition-all duration-200`}
              style={{ minHeight: "120px", margin: "8px" }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                rows={1}
                className={`w-full bg-transparent resize-none outline-none text-base ${
                  isDark
                    ? "text-white placeholder-[rgba(255,255,255,0.48)]"
                    : "text-[#1d1d1f] placeholder-[rgba(0,0,0,0.48)]"
                }`}
                style={{
                  fontFamily: "'Times New Roman', Times, serif",
                  lineHeight: "1.5",
                  maxHeight: "600px",
                  minHeight: "80px",
                  minWidth: "312px",
                  padding: "16px",
                  margin: "8px",
                }}
              />

              <div className="absolute left-3 bottom-3 flex items-center gap-2">
                {/* Attachment button */}
                {renderAttachmentButton(true)}
              </div>

              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {/* Database Selector - 仅 SQL/Code Agent 时显示 */}
                {selectedAgent !== "general" && (
                  <DatabaseSelector
                    selectedDb={selectedDb}
                    onDbChange={onDbChange || (() => {})}
                    size="small"
                  />
                )}

                {/* Agent Selector */}
                <AgentSelector
                  selectedAgent={selectedAgent}
                  onAgentChange={setSelectedAgent}
                  variant="dropdown"
                  size="small"
                />

                {/* Model Selector */}
                {renderModelSelector(true)}

                {renderSendButton(true)}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center mt-2 px-1">
            <p
              className={`text-xs ${isDark ? "text-[rgba(255,255,255,0.48)]" : "text-[rgba(0,0,0,0.48)]"}`}
              style={{
                fontFamily:
                  "SF Pro Text, -apple-system, BlinkMacSystemFont, sans-serif",
              }}
            >
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
