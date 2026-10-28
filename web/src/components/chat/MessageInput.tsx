"use client";

import { useState, useRef, useEffect } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import { ModelInfo, MarkdownPromptItem } from "@/api/graphql";
import { AgentSelector, AgentType } from "./AgentSelector";
import { DatabaseSelector } from "./DatabaseSelector";
import { ModelSelector } from "./ModelSelector";
import { FOOTER_DOCK_HEIGHT } from "./ChatSidebar";

type Variant = "footer" | "hero";

// NOTE: 模型选择器（./ModelSelector）渲染在输入框右下角，紧靠智能体选择器；
// 模型列表与选中态由页面（ChatHome）通过 props 下发。

interface MessageInputProps {
  onSendMessage: (
    message: string,
    selectedModel?: ModelInfo,
    agentType?: AgentType,
    dbName?: string | null,
    promptDisabled?: boolean,
  ) => void;
  onStop?: () => void;
  variant?: Variant;
  dark?: boolean;
  isStreaming?: boolean;
  selectedDb?: string | null;
  onDbChange?: (dbName: string | null) => void;
  selectedModel?: ModelInfo | null;
  selectedAgent?: AgentType;
  onAgentChange?: (agent: AgentType) => void;
  /** 模型选择器所需：可选模型列表 */
  models?: ModelInfo[];
  /** 模型选择器所需：模型列表加载中 */
  isLoadingModels?: boolean;
  /** 模型选择器所需：切换选中模型 */
  onModelChange?: (m: ModelInfo | null) => void;
  /** 当前生效的提示词（由后端每轮对话自动注入）；仅作展示徽标用 */
  activePrompt?: MarkdownPromptItem | null;
  /** 用户是否已主动取消携带提示词（受控状态，由 ChatHome 持有） */
  promptDismissed?: boolean;
  /** 用户点击 × 取消 / 点击"恢复"时回调 */
  onPromptDismissedChange?: (dismissed: boolean) => void;
}

export function MessageInput({
  onSendMessage,
  onStop,
  variant = "footer",
  isStreaming = false,
  selectedDb = null,
  onDbChange,
  selectedModel = null,
  selectedAgent: controlledAgent,
  onAgentChange,
  models = [],
  isLoadingModels = false,
  onModelChange,
  activePrompt,
  promptDismissed = false,
  onPromptDismissedChange,
}: MessageInputProps) {
  const [input, setInput] = useState("");
  const [internalSelectedAgent, setInternalSelectedAgent] =
    useState<AgentType>("general");
  // dismiss 受控由 ChatHome 持有；local setter 仅做透传，避免受控/非受控混用告警
  const setPromptDismissed = (v: boolean) => onPromptDismissedChange?.(v);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme } = useTheme();
  const { t } = useI18n();
  const isDark = theme === "dark";

  const selectedAgent =
    controlledAgent !== undefined ? controlledAgent : internalSelectedAgent;
  const setSelectedAgent = onAgentChange ?? setInternalSelectedAgent;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 250)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    onSendMessage(
      input,
      selectedModel || undefined,
      selectedAgent,
      selectedDb,
      promptDismissed,
    );
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 当前生效的提示词徽标（仅展示；选中态由侧边栏「提示词库」分区管理）。
  // 三种 Agent 模式 + 自动路由全部默认携带；用户可点 × 主动取消，
  // 取消后展示"已取消 · 恢复"灰阶按钮，点击可重新携带。
  const renderActivePromptBadge = () => {
    if (!activePrompt) return null;

    if (promptDismissed) {
      return (
        <button
          type="button"
          onClick={() => setPromptDismissed(false)}
          aria-label={t("chat.ariaRestorePrompt")}
          title={t("chat.ariaRestorePrompt")}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: "transparent",
            border: "0.5px solid var(--divider)",
            color: "var(--fg4)",
            cursor: "pointer",
          }}
        >
          <svg
            className="w-3 h-3 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            viewBox="0 0 24 24"
          >
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M9 14l3 3 3-3M12 8v9" />
          </svg>
          <span className="truncate max-w-[200px]">
            {activePrompt.noteName ?? activePrompt.filename}
          </span>
          <span className="shrink-0">{t("chat.promptDismissed")}</span>
          <span
            className="shrink-0 px-1.5 py-0.5 rounded-md"
            style={{
              color: "var(--fg2)",
              background: "var(--surface-1)",
            }}
          >
            {t("chat.promptRestore")}
          </span>
        </button>
      );
    }

    return (
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
        <span style={{ color: "var(--fg4)" }} className="shrink-0">
          {t("chat.promptInjected")}
        </span>
        <button
          type="button"
          onClick={() => setPromptDismissed(true)}
          aria-label={t("chat.ariaDismissPrompt")}
          title={t("chat.ariaDismissPrompt")}
          className="flex items-center justify-center shrink-0 rounded-md transition-colors"
          style={{
            width: 16,
            height: 16,
            color: "var(--fg4)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--fg1)";
            e.currentTarget.style.background = "var(--hover-bg)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--fg4)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg
            className="w-3 h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            viewBox="0 0 24 24"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    );
  };

  const renderSendButton = (isSmall: boolean) => (
    <Button
      isIconOnly
      variant="primary"
      size={isSmall ? "sm" : "md"}
      onPress={handleSend}
      isDisabled={!input.trim() || isStreaming}
      aria-label={t("chat.ariaSend")}
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

  const renderStopButton = (isSmall: boolean) => (
    <Button
      isIconOnly
      variant="primary"
      size={isSmall ? "sm" : "md"}
      onPress={onStop}
      aria-label={t("chat.ariaStop")}
      className="rounded-full"
      style={{
        boxShadow: "var(--shadow-inset), var(--shadow-md)",
        transition: "opacity 180ms ease, box-shadow 180ms ease, transform 180ms ease",
      }}
    >
      <svg
        className={isSmall ? "w-4 h-4" : "w-5 h-5"}
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <rect x="5" y="5" width="10" height="10" rx="2" />
      </svg>
    </Button>
  );

  const renderSendOrStopButton = (isSmall: boolean) =>
    isStreaming && onStop ? renderStopButton(isSmall) : renderSendButton(isSmall);

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
                  placeholder={t("chat.placeholderHero")}
                  rows={1}
                  className="w-full h-full bg-transparent border-none outline-none resize-none font-text"
                  style={{
                    fontSize: "16px",
                    letterSpacing: "-0.20px",
                    color: "var(--fg)",
                    lineHeight: "1.47",
                    maxHeight: "200px",
                    minHeight: "80px",
                    minWidth: "312px",
                    boxSizing: "border-box",
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

                  {/* 模型选择器：输入框右下角，紧靠智能体选择器 */}
                  {onModelChange && (
                    <ModelSelector
                      models={models}
                      selectedModel={selectedModel}
                      setSelectedModel={onModelChange}
                      isLoadingModels={isLoadingModels}
                      isSmall
                    />
                  )}

                  <AgentSelector
                    selectedAgent={selectedAgent}
                    onAgentChange={setSelectedAgent}
                    variant="dropdown"
                    size="small"
                  />

                  {renderSendOrStopButton(false)}
                </div>

                {/* TASK-015：图片上传按钮（左下角），上传成功后插入 [image:ID] 占位 */}
                <div className="absolute left-3 bottom-3 flex items-center" style={{ zIndex: 10 }}>
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
  // minHeight 与侧边栏底部用户配置块共用 FOOTER_DOCK_HEIGHT，
  // 保证两者的"上边缘线"保持水平（输入多行时本容器向上自然增高）
  return (
    <motion.div
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      className="w-full flex flex-col"
      style={{
        background: "var(--nav-bg)",
        backdropFilter: "var(--backdrop)",
        WebkitBackdropFilter: "var(--backdrop)",
        borderTop: isDark ? "none" : "0.5px solid var(--divider)",
        minHeight: `${FOOTER_DOCK_HEIGHT}px`,
      }}
    >
      <div className="flex-1 flex flex-col py-3 pb-4 px-4">
        <div className="w-full flex-1 flex flex-col">
          <div className="flex-1 flex items-stretch gap-3">
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
                placeholder={t("chat.placeholderFooter")}
                rows={1}
                className="w-full bg-transparent resize-none outline-none font-text"
                style={{
                  fontSize: "16px",
                  letterSpacing: "-0.20px",
                  color: "var(--fg)",
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

                {/* 模型选择器：输入框右下角，紧靠智能体选择器 */}
                {onModelChange && (
                  <ModelSelector
                    models={models}
                    selectedModel={selectedModel}
                    setSelectedModel={onModelChange}
                    isLoadingModels={isLoadingModels}
                    isSmall
                  />
                )}

                <AgentSelector
                  selectedAgent={selectedAgent}
                  onAgentChange={setSelectedAgent}
                  variant="dropdown"
                  size="small"
                />

                {renderSendOrStopButton(true)}
              </div>

              {/* TASK-015：图片上传按钮（左下角），上传成功后插入 [image:ID] 占位 */}
              <div className="absolute left-3 bottom-3 flex items-center" style={{ zIndex: 10 }}>
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
              {t("chat.inputHelpText")}
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
  const { t } = useI18n();

  const handleClick = () => {
    // 某些浏览器在 display:none 的 input 上 .click() 无效，
    // 用 visibility:hidden + 绝对定位脱离视口替代 display:none
    fileInputRef.current?.click();
  };

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
        alert(res.error || t("chat.errorImageUploadFailed"));
      }
    } catch (e) {
      alert(`Image upload error: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={uploading}
        title={t("chat.tooltipUploadImage")}
        className="chip-btn"
        style={{
          width: 32,
          height: 32,
          borderRadius: 10,
          cursor: uploading ? "wait" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 10,
          position: "relative",
        }}
      >
        {uploading ? (
          <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" viewBox="0 0 24 24">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
        ) : (
          <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
          </svg>
        )}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          overflow: "hidden",
          left: -9999,
          top: -9999,
          pointerEvents: "none",
        }}
        onChange={handleChange}
      />
    </>
  );
}
