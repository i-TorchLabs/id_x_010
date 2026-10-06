"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { motion } from "framer-motion";
import { Button, ListBox, Select } from "@heroui/react";
import { modelGraphqlApi, ModelInfo, MarkdownPromptItem } from "@/api/graphql";
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

  const displayText = selectedModel
    ? `${selectedModel.name} (${selectedModel.provider})`
    : isLoadingModels
      ? "Loading..."
      : "No models available";

  useLayoutEffect(() => {
    if (measureRef.current) {
      setWidth(measureRef.current.offsetWidth);
    }
  }, [displayText, isSmall]);

  const minW = isSmall ? 96 : 120;
  const maxW = isSmall ? 220 : 280;
  const triggerWidth =
    width != null
      ? `min(${maxW}px, max(${minW}px, ${width + 36}px))`
      : `${minW}px`;

  return (
    <Select
      aria-label="Model"
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
      placeholder={isLoadingModels ? "Loading..." : "No models available"}
      variant="secondary"
      className="w-auto"
      style={{ width: triggerWidth }}
    >
      <Select.Trigger
        className={`pill-trigger ${isSmall ? "h-9 px-1.5" : "h-11 px-2"} whitespace-nowrap overflow-hidden flex items-center rounded-lg`}
      >
        <Select.Value
          className={`flex! flex-1! min-w-0! h-auto ${isSmall ? "h-7 text-xs" : "h-9 text-sm"} px-2.5 items-center! justify-center! text-center! rounded-md font-medium truncate bg-default/60 text-foreground`}
        >
          {({ selectedText, isPlaceholder }) => (
            <span className="block w-full text-center truncate">
              {isPlaceholder
                ? isLoadingModels
                  ? "Loading..."
                  : "No models available"
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
                      isSelected ? "opacity-100" : "opacity-0"
                    }`}
                    style={{ background: "var(--fg)" }}
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
  isStreaming?: boolean;
  selectedDb?: string | null;
  onDbChange?: (dbName: string | null) => void;
  selectedModel?: ModelInfo | null;
  onModelChange?: (model: ModelInfo | null) => void;
  selectedAgent?: AgentType;
  onAgentChange?: (agent: AgentType) => void;
  models?: ModelInfo[];
  isLoadingModels?: boolean;
  /** 当前生效的提示词（由后端每轮对话自动注入）；仅作展示徽标用 */
  activePrompt?: MarkdownPromptItem | null;
}

export function MessageInput({
  onSendMessage,
  variant = "footer",
  isStreaming = false,
  selectedDb = null,
  onDbChange,
  selectedModel: controlledModel,
  onModelChange,
  selectedAgent: controlledAgent,
  onAgentChange,
  models: controlledModels,
  isLoadingModels: controlledIsLoadingModels,
  activePrompt,
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

  useEffect(() => {
    if (controlledModels !== undefined) return;

    let cancelled = false;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 1000;
    const REQUEST_TIMEOUT = 10000;

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
              `Failed to load models (attempt ${attempt + 1}): ${response.getModels.message}; retrying in ${delay}ms`,
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
            `Model list load error (attempt ${attempt + 1}); retrying in ${delay}ms:`,
            error,
          );
          retrying = true;
          setTimeout(() => loadModels(attempt + 1), delay);
          return;
        }
        console.error("Final model list load failure:", error);
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

  // 当前生效的提示词徽标（仅展示；选中态由侧边栏「提示词库」分区管理）
  const renderActivePromptBadge = () =>
    activePrompt ? (
      <div
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium"
        style={{
          background: "var(--surface-1)",
          border: "0.5px solid var(--divider)",
          color: "var(--fg2)",
        }}
      >
        <svg
          className="w-3 h-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          viewBox="0 0 24 24"
        >
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="truncate max-w-[200px]">
          {activePrompt.noteName ?? activePrompt.filename}
        </span>
        <span style={{ color: "var(--fg4)" }} className="shrink-0">· injected</span>
      </div>
    ) : null;

  const renderSendButton = (isSmall: boolean) => (
    <Button
      isIconOnly
      variant="primary"
      size={isSmall ? "sm" : "md"}
      onPress={handleSend}
      isDisabled={!input.trim() || isStreaming}
      aria-label="Send"
      className="rounded-full"
      style={{
        boxShadow:
          !input.trim() || isStreaming
            ? "var(--shadow-xs)"
            : "var(--shadow-inset), var(--shadow-md)",
        opacity: !input.trim() || isStreaming ? 0.45 : 1,
        transition: "opacity 180ms ease, box-shadow 180ms ease, transform 180ms ease",
      }}
    >
      <svg
        className={isSmall ? "w-4 h-4" : "w-5 h-5"}
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
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2, duration: 0.6, ease: [0.25, 0.4, 0.25, 1] }}
        className="w-full"
      >
        <div className="relative w-full">
          <motion.div
            className="w-full transition-all duration-300"
            style={{
              background: "var(--surface-2)",
              borderRadius: "20px",
              border: "0.5px solid var(--divider-strong)",
              boxShadow: "var(--shadow-inset), var(--shadow-card)",
              minHeight: "210px",
            }}
          >
            <div
              className="flex flex-col justify-between h-full p-4"
              style={{ minHeight: "210px" }}
            >
              {renderActivePromptBadge()}
              <div className="flex-1 min-h-0 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask me anything..."
                  rows={1}
                  className="w-full h-full bg-transparent border-none outline-none resize-none font-text"
                  style={{
                    fontSize: "16px",
                    letterSpacing: "-0.20px",
                    color: isDark ? "#ffffff" : "#1d1d1f",
                    lineHeight: "1.47",
                    maxHeight: "200px",
                    minHeight: "80px",
                    minWidth: "312px",
                    boxSizing: "border-box",
                    padding: "16px 16px 16px 48px",
                    margin: "8px",
                  }}
                />

                <div className="absolute right-3 bottom-3 flex items-center gap-3">
                  {selectedAgent !== "general" && (
                    <DatabaseSelector
                      selectedDb={selectedDb}
                      onDbChange={onDbChange || (() => {})}
                    />
                  )}

                  <AgentSelector
                    selectedAgent={selectedAgent}
                    onAgentChange={setSelectedAgent}
                    variant="dropdown"
                  />

                  {renderModelSelector(false)}

                  {renderSendButton(false)}
                </div>

                {/* TASK-015：图片上传按钮（移至左下角），上传成功后插入 [image:ID] 占位 */}
                <div className="absolute left-3 bottom-3 flex items-center">
                  <ImageButton
                    onUploaded={(imageId, filename) => {
                      const placeholder = `[image:${imageId}]`;
                      setInput((prev) =>
                        prev ? `${prev} ${placeholder}` : placeholder,
                      );
                    }}
                  />
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
      className="w-full"
      style={{
        background: isDark ? "rgba(0,0,0,0.72)" : "rgba(255,255,255,0.72)",
        backdropFilter: "saturate(180%) blur(20px)",
        WebkitBackdropFilter: "saturate(180%) blur(20px)",
        borderTop: isDark
          ? "none"
          : "0.5px solid rgba(0,0,0,0.06)",
      }}
    >
      <div className="py-3 pb-4 px-4">
        <div className="w-full">
          <div className="flex items-end gap-3">
            <div
              className="flex-1 relative transition-all duration-200"
              style={{
                background: "var(--surface-2)",
                borderRadius: "16px",
                border: "0.5px solid var(--divider-strong)",
                minHeight: "120px",
                boxShadow: "var(--shadow-inset), var(--shadow-card)",
              }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your message..."
                rows={1}
                className="w-full bg-transparent resize-none outline-none font-text"
                style={{
                  fontSize: "16px",
                  letterSpacing: "-0.20px",
                  color: isDark ? "#ffffff" : "#1d1d1f",
                  lineHeight: "1.5",
                  maxHeight: "600px",
                  minHeight: "80px",
                  minWidth: "312px",
                  padding: "16px 16px 16px 48px",
                  margin: "8px",
                }}
              />

              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {selectedAgent !== "general" && (
                  <DatabaseSelector
                    selectedDb={selectedDb}
                    onDbChange={onDbChange || (() => {})}
                    size="small"
                  />
                )}

                <AgentSelector
                  selectedAgent={selectedAgent}
                  onAgentChange={setSelectedAgent}
                  variant="dropdown"
                  size="small"
                />

                {renderModelSelector(true)}

                {renderSendButton(true)}
              </div>

              {/* TASK-015：图片上传按钮（移至左下角），上传成功后插入 [image:ID] 占位 */}
              <div className="absolute left-3 bottom-3 flex items-center">
                <ImageButton
                  onUploaded={(imageId, filename) => {
                    const placeholder = `[image:${imageId}]`;
                    setInput((prev) => (prev ? `${prev} ${placeholder}` : placeholder));
                  }}
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-2 px-1 flex-wrap">
            {renderActivePromptBadge()}
            <p
              className="font-text"
              style={{
                fontSize: "11px",
                fontWeight: 500,
                letterSpacing: "0.04em",
                color: "var(--fg4)",
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

// TASK-015：图片上传按钮。点击触发隐藏 file input，上传完成后通知父组件
// 在 input 文本后追加 [image:ID] 占位，supervisor 检测占位即路由到 VL Agent。
function ImageButton({
  onUploaded,
}: {
  onUploaded: (imageId: number, filename: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleClick = () => fileInputRef.current?.click();

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadImage } = await import("@/api/upload");
      const res = await uploadImage(file);
      if (res.success && res.image_id) {
        onUploaded(res.image_id, res.filename || file.name);
      } else {
        alert(res.error || "Image upload failed");
      }
    } catch (e) {
      alert(`Image upload error: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      // 清空 input，允许重复上传同一文件
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={uploading}
        title="Upload image for VL Agent analysis (auto-inserts [image:ID] placeholder after upload)"
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: "var(--surface-2)",
          border: "0.5px solid var(--divider-strong)",
          color: "var(--fg2)",
          cursor: uploading ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {uploading ? "…" : "🖼"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={handleChange}
      />
    </>
  );
}
