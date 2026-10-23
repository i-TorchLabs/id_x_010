"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { AlertDialog, Button, Modal, ScrollShadow } from "@heroui/react";
import { motion, AnimatePresence } from "framer-motion";
import {
  promptGraphqlApi,
  MarkdownPromptItem,
} from "@/api/graphql";
import { uploadMarkdown } from "@/api/upload";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";

interface PromptPanelProps {
  /** 当前选中的提示词变化时通知父组件（用于在输入框附近显示徽标等） */
  onActivePromptChange?: (prompt: MarkdownPromptItem | null) => void;
}

/**
 * 侧边栏「提示词库」分区。
 *
 * - 上传：点击回形针按钮选择 .md 文件 → 后端校验并按用户持久化
 * - 列表：展示当前用户全部提示词，按创建时间倒序
 * - 选中：点击列表项切换 is_active；同一用户同时仅一条选中
 * - 删除：每项右侧 ✕ 按钮；删除活跃项时后端自动将最新一条续用
 * - 预览：点击列表项左侧展开按钮查看内容
 *
 * 当前选中的提示词由后端在每轮对话中自动注入为系统提示词，
 * 前端无需在 chat / streamChat 请求中携带 promptContent。
 */
export function PromptPanel({ onActivePromptChange }: PromptPanelProps) {
  const [prompts, setPrompts] = useState<MarkdownPromptItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // 内联编辑备注名称的状态：正在编辑的 promptId + 当前输入值
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const editingInputRef = useRef<HTMLInputElement>(null);
  // 删除确认弹窗：持有待删除的 prompt，null 时弹窗关闭
  const [promptToDelete, setPromptToDelete] =
    useState<MarkdownPromptItem | null>(null);
  // 编辑内容弹窗：持有正在编辑的 prompt，null 时弹窗关闭
  const [editingPrompt, setEditingPrompt] =
    useState<MarkdownPromptItem | null>(null);
  const [editContentValue, setEditContentValue] = useState("");
  const [isSavingContent, setIsSavingContent] = useState(false);
  const editContentRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme } = useTheme();
  const { t } = useI18n();
  // 删除确认 / 编辑内容两个弹窗各自独立的拖拽状态
  const { handleProps: deleteDragHandleProps } = useDraggableDialog();
  const { handleProps: editDragHandleProps } = useDraggableDialog();
  const isDark = theme === "dark";

  // 加载提示词列表
  const loadPrompts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await promptGraphqlApi.listPrompts();
      if (result.listMarkdownPrompts.success) {
        setPrompts(result.listMarkdownPrompts.prompts);
        const active =
          result.listMarkdownPrompts.prompts.find((p) => p.isActive) ?? null;
        onActivePromptChange?.(active);
      } else {
        setError(result.listMarkdownPrompts.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prompt.errorLoadFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [onActivePromptChange]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  // 进入编辑态时自动聚焦输入框并全选
  useEffect(() => {
    if (editingId !== null && editingInputRef.current) {
      editingInputRef.current.focus();
      editingInputRef.current.select();
    }
  }, [editingId]);

  // 打开内容编辑弹窗时自动聚焦 textarea，光标置末尾
  useEffect(() => {
    if (editingPrompt !== null && editContentRef.current) {
      // 等待 Modal 完成挂载
      const timer = setTimeout(() => {
        if (editContentRef.current) {
          editContentRef.current.focus();
          const len = editContentRef.current.value.length;
          editContentRef.current.setSelectionRange(len, len);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editingPrompt]);

  // 选择文件 → 上传 → 刷新列表
  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setIsUploading(true);
    try {
      const result = await uploadMarkdown(file);
      if (!result.success || !result.prompt) {
        setError(result.error || t("prompt.errorUploadFailed"));
        return;
      }
      await loadPrompts();
    } finally {
      setIsUploading(false);
    }
  };

  // 选中某条提示词
  const handleSelect = async (promptId: number) => {
    setError(null);
    try {
      const result = await promptGraphqlApi.selectPrompt(promptId);
      if (result.selectMarkdownPrompt.success) {
        setPrompts((prev) =>
          prev.map((p) => ({ ...p, isActive: p.id === promptId })),
        );
        const selected =
          result.selectMarkdownPrompt.prompt ??
          prompts.find((p) => p.id === promptId) ??
          null;
        onActivePromptChange?.(selected);
      } else {
        setError(result.selectMarkdownPrompt.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prompt.errorSwitchFailed"));
    }
  };

  // 删除某条提示词
  const handleDelete = async (promptId: number) => {
    setError(null);
    try {
      const result = await promptGraphqlApi.deletePrompt(promptId);
      if (result.deleteMarkdownPrompt.success) {
        const removed = prompts.find((p) => p.id === promptId);
        const wasActive = removed?.isActive ?? false;
        setPrompts((prev) => prev.filter((p) => p.id !== promptId));
        // 删除的是活跃项时，重新拉取以获取后端自动续用的活跃项
        if (wasActive) {
          await loadPrompts();
        }
      } else {
        setError(result.deleteMarkdownPrompt.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prompt.errorDeleteFailed"));
    }
  };

  // 进入编辑态：以现有 noteName（缺省则 filename）作为初始值
  const startEditing = (prompt: MarkdownPromptItem) => {
    setEditingId(prompt.id);
    setEditingValue(prompt.noteName ?? prompt.filename);
    setExpandedId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingValue("");
  };

  // 保存备注名：回车 / 失焦 / 点击 ✓ 触发
  const saveEditing = async () => {
    if (editingId === null) return;
    const trimmed = editingValue.trim();
    const target = prompts.find((p) => p.id === editingId);
    if (target === null || target === undefined) {
      cancelEditing();
      return;
    }

    // 值未变化直接退出
    const original = target.noteName ?? target.filename;
    if (trimmed === original) {
      cancelEditing();
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      // 空串视为清空备注（传 null，回退展示 filename）
      const result = await promptGraphqlApi.renamePrompt(
        editingId,
        trimmed === "" ? null : trimmed,
      );
      if (result.renameMarkdownPrompt.success && result.renameMarkdownPrompt.prompt) {
        const updated = result.renameMarkdownPrompt.prompt;
        setPrompts((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p)),
        );
        // 若改的是活跃项，同步徽标
        if (updated.isActive) {
          onActivePromptChange?.(updated);
        }
        cancelEditing();
      } else {
        setError(result.renameMarkdownPrompt.message || t("prompt.errorSaveFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prompt.errorSaveNameFailed"));
    } finally {
      setIsSaving(false);
    }
  };

  // 下载 Markdown 文件：纯前端 Blob，文件名优先用 note_name（缺省 filename）
  const handleDownload = (prompt: MarkdownPromptItem) => {
    const baseName = (prompt.noteName ?? prompt.filename) || "prompt";
    // 去除扩展名后统一补 .md，避免出现 name.md.md
    const stem = baseName.replace(/\.md$|\.markdown$|\.mdown$|\.mkd$/i, "");
    const filename = `${stem}.md`;
    const blob = new Blob([prompt.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 释放 Blob URL，避免内存泄漏
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // 打开编辑内容弹窗
  const openContentEditor = (prompt: MarkdownPromptItem) => {
    setEditingPrompt(prompt);
    setEditContentValue(prompt.content);
    setEditingId(null); // 关闭备注名内联编辑
  };

  const closeContentEditor = () => {
    if (isSavingContent) return; // 保存中禁止关闭
    setEditingPrompt(null);
    setEditContentValue("");
  };

  // 保存编辑内容
  const saveContentEditing = async () => {
    if (editingPrompt === null) return;
    if (!editContentValue.trim()) {
      setError(t("prompt.errorContentEmpty"));
      return;
    }

    setIsSavingContent(true);
    setError(null);
    try {
      const result = await promptGraphqlApi.updateContent(
        editingPrompt.id,
        editContentValue,
      );
      if (
        result.updateMarkdownContent.success &&
        result.updateMarkdownContent.prompt
      ) {
        const updated = result.updateMarkdownContent.prompt;
        setPrompts((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p)),
        );
        if (updated.isActive) {
          onActivePromptChange?.(updated);
        }
        setEditingPrompt(null);
        setEditContentValue("");
      } else {
        setError(result.updateMarkdownContent.message || t("prompt.errorSaveFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("prompt.errorSaveContentFailed"));
    } finally {
      setIsSavingContent(false);
    }
  };

  // 确认删除：由 AlertDialog 触发
  const confirmDelete = async () => {
    if (promptToDelete === null) return;
    await handleDelete(promptToDelete.id);
    setPromptToDelete(null);
  };

  const activePrompt = prompts.find((p) => p.isActive) ?? null;

  return (
    <div className="px-4 shrink-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="label-section">
          Prompt Library
        </p>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label={t("prompt.ariaUpload")}
          onPress={() => fileInputRef.current?.click()}
          isDisabled={isUploading || isLoading}
          className="icon-btn !h-6 !w-6"
        >
          {isUploading ? (
            <svg
              className="w-3.5 h-3.5 animate-spin"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                d="M12 3a9 9 0 109 9 9 9 0 00-9-9z"
                opacity={0.25}
              />
              <path strokeLinecap="round" d="M21 12a9 9 0 00-9-9" />
            </svg>
          ) : (
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M12 4v16m8-8H4" />
            </svg>
          )}
        </Button>
      </div>

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,.mdown,.mkd,text/markdown,text/x-markdown,text/plain"
        onChange={handleFileSelect}
        className="hidden"
        aria-hidden
      />

      {/* 错误提示 */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-2 px-2.5 py-1.5 rounded-md text-xs font-medium"
            style={{
              background: "var(--error-bg)",
              border: "0.5px solid var(--error-border)",
              color: "var(--error)",
            }}
          >
            <div className="flex items-start gap-1.5">
              <span className="flex-1">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="icon-btn-sm shrink-0"
                style={{ color: "inherit" }}
                aria-label={t("prompt.ariaCloseError")}
              >
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 当前选中提示词徽标 */}
      {activePrompt && (
        <div
          className="mb-2 px-2.5 py-1.5 rounded-md text-xs font-medium"
          style={{
            background: isDark
              ? "rgba(255,255,255,0.06)"
              : "rgba(0,0,0,0.04)",
            color: isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3 h-3 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
            <span className="truncate flex-1">
              Active: {activePrompt.noteName ?? activePrompt.filename}
            </span>
          </div>
        </div>
      )}

      {/* 列表 */}
      <ScrollShadow className="max-h-64">
        {isLoading && prompts.length === 0 ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <svg
              className="w-5 h-5 animate-spin opacity-50"
              fill="none"
              stroke="var(--fg3)"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                d="M12 3a9 9 0 109 9 9 9 0 00-9-9z"
                opacity={0.25}
              />
              <path strokeLinecap="round" d="M21 12a9 9 0 00-9-9" />
            </svg>
            <p
              className="font-text"
              style={{ fontSize: "12px", color: "var(--fg3)" }}
            >
              Loading...
            </p>
          </div>
        ) : prompts.length === 0 ? (
          <div className="py-6 flex flex-col items-center gap-2">
            <svg
              className="w-7 h-7 opacity-40"
              fill="none"
              stroke="var(--fg3)"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            <p
              className="font-text"
              style={{ fontSize: "12px", color: "var(--fg3)" }}
            >
              No prompts
            </p>
            <p
              className="font-text text-center px-2"
              style={{ fontSize: "11px", color: "var(--fg3)", opacity: 0.7 }}
            >
              Click + above to upload a Markdown file
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {prompts.map((prompt) => {
              const isExpanded = expandedId === prompt.id;
              return (
                <div
                  key={prompt.id}
                  className="rounded-md transition-colors"
                  style={{
                    background: prompt.isActive
                      ? isDark
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(0,0,0,0.05)"
                      : "transparent",
                  }}
                >
                  <div className="flex items-center gap-1 px-1.5 py-1.5">
                    {/* 选中单选 */}
                    <button
                      type="button"
                      onClick={() => handleSelect(prompt.id)}
                      className="icon-btn-sm shrink-0 flex items-center justify-center"
                      aria-label={
                        prompt.isActive
                          ? "Selected"
                          : t("prompt.setAsActive")
                      }
                      style={{ width: "22px", height: "22px", padding: 0 }}
                    >
                      <span
                        className="rounded-full"
                        style={{
                          width: "14px",
                          height: "14px",
                          border: prompt.isActive
                            ? "1.5px solid var(--accent)"
                            : "1.5px solid var(--fg4)",
                          background: prompt.isActive
                            ? "var(--accent)"
                            : "transparent",
                          // 选中时用卡片色内圈模拟「圆点」效果，更精致
                          boxShadow: prompt.isActive
                            ? "inset 0 0 0 2.5px var(--card)"
                            : "none",
                          transition:
                            "border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease",
                        }}
                      />
                    </button>

                    {/* 展开/收起 + 显示名 + 编辑（编辑态切换为输入框） */}
                    {editingId === prompt.id ? (
                      <div className="flex-1 min-w-0 flex items-center gap-1">
                        <input
                          ref={editingInputRef}
                          type="text"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              saveEditing();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              cancelEditing();
                            }
                          }}
                          onBlur={saveEditing}
                          disabled={isSaving}
                          placeholder={prompt.filename}
                          className="field-input flex-1 min-w-0 font-text px-1.5 py-0.5"
                          style={{
                            fontSize: "12px",
                            fontWeight: prompt.isActive ? 600 : 400,
                            borderRadius: 7,
                          }}
                          maxLength={256}
                        />
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            // 阻止失焦，避免 onBlur 先于 click 触发导致保存中断
                            e.preventDefault();
                            saveEditing();
                          }}
                          disabled={isSaving}
                          className="icon-btn-sm"
                          aria-label={t("prompt.ariaSaveName")}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path d="M5 13l4 4L19 7" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            cancelEditing();
                          }}
                          disabled={isSaving}
                          className="icon-btn-sm"
                          aria-label={t("prompt.ariaCancelEdit")}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedId(isExpanded ? null : prompt.id)
                          }
                          className="flex-1 min-w-0 flex items-center gap-1 text-left"
                        >
                          <svg
                            className="w-3 h-3 shrink-0 transition-transform"
                            style={{
                              transform: isExpanded ? "rotate(90deg)" : "none",
                              color: "var(--fg3)",
                            }}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            viewBox="0 0 24 24"
                          >
                            <path d="M9 18l6-6-6-6" />
                          </svg>
                          <span
                            className="font-text truncate"
                            style={{
                              fontSize: "12px",
                              fontWeight: prompt.isActive ? 600 : 400,
                              color: "var(--fg)",
                            }}
                          >
                            {prompt.noteName ?? prompt.filename}
                          </span>
                          {prompt.noteName && (
                            <span
                              className="font-text shrink-0"
                              style={{
                                fontSize: "10px",
                                color: "var(--fg3)",
                                opacity: 0.7,
                              }}
                            >
                              · {prompt.filename}
                            </span>
                          )}
                        </button>

                        {/* 下载 Markdown 文件 */}
                        <button
                          type="button"
                          onClick={() => handleDownload(prompt)}
                          className="icon-btn-sm"
                          aria-label={t("prompt.ariaDownload")}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                          >
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                            <path d="M7 10l5 5 5-5" />
                            <path d="M12 15V3" />
                          </svg>
                        </button>

                        {/* 编辑备注名 */}
                        <button
                          type="button"
                          onClick={() => startEditing(prompt)}
                          className="icon-btn-sm"
                          aria-label={t("prompt.ariaEditName")}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                          >
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <path d="M14 2v6h6" />
                            <path d="M8 13h8M8 17h5" />
                          </svg>
                        </button>

                        {/* 编辑 Markdown 正文（独立弹窗） */}
                        <button
                          type="button"
                          onClick={() => openContentEditor(prompt)}
                          className="icon-btn-sm"
                          aria-label={t("prompt.ariaEditContent")}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                          >
                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>

                        {/* 删除（垃圾桶图标 + 确认弹窗） */}
                        <button
                          type="button"
                          onClick={() => setPromptToDelete(prompt)}
                          className="icon-btn-sm"
                          aria-label={t("prompt.ariaDelete")}
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            viewBox="0 0 24 24"
                          >
                            <path d="M3 6h18" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>

                  {/* 内容预览（编辑功能已移至独立 Modal 弹窗） */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden"
                      >
                        <pre
                          className="font-text mx-1.5 mb-1.5 p-2 rounded-lg overflow-auto"
                          style={{
                            fontSize: "11px",
                            lineHeight: "1.5",
                            maxHeight: "160px",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                            background: "var(--surface-1)",
                            border: "0.5px solid var(--divider)",
                            color: "var(--fg2)",
                          }}
                        >
                          {prompt.content}
                        </pre>
                        <p
                          className="font-text px-2 pb-1.5"
                          style={{
                            fontSize: "10px",
                            color: "var(--fg3)",
                          }}
                        >
                          {prompt.charCount} characters
                          {prompt.updatedAt
                            ? ` · updated ${new Date(prompt.updatedAt).toLocaleDateString()}`
                            : ""}
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </ScrollShadow>

      {/* 删除确认弹窗 */}
      <AlertDialog.Backdrop
        isOpen={promptToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPromptToDelete(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[400px]">
            <AlertDialog.CloseTrigger
              onPress={() => setPromptToDelete(null)}
            />
            <AlertDialog.Header {...deleteDragHandleProps}>
              <AlertDialog.Icon status="warning" />
              <AlertDialog.Heading>{t("prompt.confirmDeleteTitle")}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {t("prompt.confirmDeleteBody")}
                <strong
                  style={{ margin: "0 4px" }}
                >
                  {promptToDelete?.noteName ?? promptToDelete?.filename}
                </strong>
                {t("prompt.confirmDeleteSuffix")}
              </p>
              {promptToDelete?.isActive && (
                <p
                  className="mt-2"
                  style={{
                    fontSize: "12px",
                    color: isDark ? "#ffb84d" : "#a86800",
                  }}
                >
                  {t("prompt.activeDeleteWarning")}
                </p>
              )}
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                slot="close"
                variant="tertiary"
                onPress={() => setPromptToDelete(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                slot="close"
                variant="danger"
                onPress={confirmDelete}
              >
                {t("common.delete")}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      {/* 编辑内容弹窗 */}
      <Modal.Backdrop
        isOpen={editingPrompt !== null}
        onOpenChange={(open) => {
          if (!open) closeContentEditor();
        }}
      >
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[720px]">
            <Modal.CloseTrigger onPress={closeContentEditor} />
            <Modal.Header {...editDragHandleProps}>
              <Modal.Heading>
                Edit Content · {editingPrompt?.noteName ?? editingPrompt?.filename}
              </Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <textarea
                ref={editContentRef}
                value={editContentValue}
                onChange={(e) => setEditContentValue(e.target.value)}
                onKeyDown={(e) => {
                  // Ctrl/Cmd+Enter 保存，Esc 取消
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    saveContentEditing();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    closeContentEditor();
                  }
                }}
                disabled={isSavingContent}
                className="field-input font-text w-full p-3 resize-y"
                style={{
                  fontSize: "13px",
                  lineHeight: "1.6",
                  minHeight: "320px",
                  maxHeight: "60vh",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  borderRadius: 12,
                  boxSizing: "border-box",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                }}
              />
              <div
                className="flex items-center justify-between mt-2"
                style={{ fontSize: "11px", color: "var(--fg3)" }}
              >
                <span>
                  {editContentValue.length} characters
                  {editContentValue.length > 2 * 1024 * 1024
                    ? " · exceeds 2MB limit"
                    : ""}
                </span>
                <span>Ctrl+Enter to save · Esc to cancel</span>
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button
                variant="tertiary"
                onPress={closeContentEditor}
                isDisabled={isSavingContent}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onPress={saveContentEditing}
                isDisabled={
                  isSavingContent ||
                  !editContentValue.trim() ||
                  editContentValue.length > 2 * 1024 * 1024
                }
              >
                {isSavingContent ? "Saving..." : "Save"}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
