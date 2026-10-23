/**
 * 个人资料弹窗
 *
 * 点击侧边栏用户头像/名称打开。支持：
 *  - 上传头像图片（JPEG/PNG/WebP/GIF，≤2MB）—— 调用 /upload-avatar 端点
 *  - 修改显示名称 —— 调用 updateProfile GraphQL mutation
 *
 * 成功后通过 localStorage 同步用户信息，父级 onSaved 回调触发 UI 刷新。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { userGraphqlApi, type User } from "@/api/graphql";
import { uploadAvatar, prevalidateAvatarFile } from "@/api/upload";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";

interface ProfileDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  user: User | null;
  onSaved?: (user: User) => void;
}

type Feedback = { type: "success" | "error"; text: string } | null;

const DEFAULT_AVATAR_BG = "var(--accent)";
const DEFAULT_AVATAR_FG = "var(--accent-fg)";

/** 由 email 或 displayName 推导回退字母（与 ChatSidebar 一致） */
function fallbackInitial(user: User | null): string {
  const name = user?.displayName ?? user?.email ?? "?";
  return name.slice(0, 1).toUpperCase();
}

export function ProfileDialog({
  isOpen,
  onOpenChange,
  user,
  onSaved,
}: ProfileDialogProps) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { handleProps: dragHandleProps } = useDraggableDialog();
  const isDark = theme === "dark";

  const [displayName, setDisplayName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 打开时用最新 user 数据填充
  useEffect(() => {
    if (!isOpen) return;
    setFeedback(null);
    setDisplayName(user?.displayName ?? "");
    setAvatarUrl(user?.avatarUrl ?? null);
  }, [isOpen, user]);

  const syncLocalStorage = useCallback((updated: User) => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("user");
      const merged = { ...(raw ? JSON.parse(raw) : {}), ...updated };
      localStorage.setItem("user", JSON.stringify(merged));
    } catch {
      // 解析失败直接覆盖
      localStorage.setItem("user", JSON.stringify(updated));
    }
  }, []);

  const handleSaveName = useCallback(async () => {
    if (isSavingName) return;
    setIsSavingName(true);
    setFeedback(null);
    try {
      const trimmed = displayName.trim();
      const res = await userGraphqlApi.updateProfile({
        displayName: trimmed,
      });
      const { success, message, user: updated } = res.updateProfile;
      if (success && updated) {
        setFeedback({ type: "success", text: message || t("profile.nameUpdated") });
        syncLocalStorage(updated);
        onSaved?.(updated);
      } else {
        setFeedback({ type: "error", text: message || t("profile.errorSaveFailed") });
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: err instanceof Error ? err.message : t("profile.errorSaveFailedRetry"),
      });
    } finally {
      setIsSavingName(false);
    }
  }, [displayName, isSavingName, onSaved, syncLocalStorage]);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // 清空 input.value 以便重复选择同一文件
      if (e.target) e.target.value = "";
      if (!file) return;

      const preError = prevalidateAvatarFile(file);
      if (preError) {
        setFeedback({ type: "error", text: preError });
        return;
      }

      setIsUploading(true);
      setFeedback(null);
      try {
        const result = await uploadAvatar(file);
        if (result.success && result.user) {
          setAvatarUrl(result.avatarUrl ?? result.user.avatarUrl);
          setFeedback({ type: "success", text: t("profile.avatarUpdated") });
          syncLocalStorage(result.user);
          onSaved?.(result.user);
        } else {
          setFeedback({
            type: "error",
            text: result.error || t("profile.errorAvatarUploadFailed"),
          });
        }
      } finally {
        setIsUploading(false);
      }
    },
    [onSaved, syncLocalStorage],
  );

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[480px]">
          <Modal.CloseTrigger />
          <Modal.Header {...dragHandleProps}>
            <Modal.Heading>{t("profile.modalTitle")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div className="flex flex-col items-center gap-4">
              {/* 头像预览 + 上传 */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className="relative group cursor-pointer"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label={t("profile.ariaChangeAvatar")}
                  role="button"
                >
                  {avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarUrl}
                      alt={t("profile.avatarAlt")}
                      className="w-24 h-24 rounded-full object-cover"
                      style={{
                        border: "0.5px solid var(--divider)",
                      }}
                      onError={() => setAvatarUrl(null)}
                    />
                  ) : (
                    <div
                      className="w-24 h-24 rounded-full flex items-center justify-center font-display"
                      style={{
                        background: DEFAULT_AVATAR_BG,
                        color: DEFAULT_AVATAR_FG,
                        fontSize: "36px",
                        fontWeight: 600,
                      }}
                    >
                      {fallbackInitial(user)}
                    </div>
                  )}
                  {/* 悬停遮罩：相机图标 */}
                  <div
                    className="absolute inset-0 rounded-full flex items-center justify-center transition-opacity"
                    style={{
                      background: isDark
                        ? "rgba(0,0,0,0.55)"
                        : "rgba(0,0,0,0.45)",
                      opacity: 0,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.opacity = "1";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.opacity = "0";
                    }}
                  >
                    {isUploading ? (
                      <svg
                        className="w-6 h-6 text-white animate-spin"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          d="M4 12a8 8 0 018-8M20 12a8 8 0 01-8 8M12 4a8 8 0 018 8M12 20a8 8 0 01-8-8"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-6 h-6 text-white"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        viewBox="0 0 24 24"
                      >
                        <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                        <circle cx="12" cy="13" r="4" />
                      </svg>
                    )}
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={handleFileSelect}
                  className="hidden"
                  aria-hidden
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => fileInputRef.current?.click()}
                  isDisabled={isUploading}
                  className="text-xs"
                >
                  {isUploading ? t("profile.uploading") : t("profile.changeAvatar")}
                </Button>
                <p
                  className="font-text"
                  style={{
                    fontSize: "11px",
                    color: "var(--fg3)",
                  }}
                >
                  {t("profile.avatarFormatHelp")}
                </p>
              </div>

              {/* 显示名称 */}
              <TextField fullWidth className="flex flex-col gap-1.5 mt-2">
                <Label className="text-sm font-medium">{t("profile.fieldDisplayName")}</Label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t("profile.displayNamePlaceholder")}
                  maxLength={64}
                />
              </TextField>

              {/* 邮箱（只读展示） */}
              <TextField fullWidth className="flex flex-col gap-1.5" isDisabled>
                <Label className="text-sm font-medium">{t("profile.fieldEmail")}</Label>
                <Input
                  value={user?.email ?? ""}
                  readOnly
                  aria-label={t("profile.ariaEmailReadonly")}
                />
              </TextField>

              {/* 反馈 */}
              {feedback && (
                <div
                  className="text-sm rounded-lg px-3 py-2 leading-relaxed w-full"
                  style={
                    feedback.type === "success"
                      ? {
                          background: "rgba(34, 197, 94, 0.10)",
                          color: "#16a34a",
                        }
                      : {
                          background: "var(--error-bg)",
                          color: "var(--error)",
                        }
                  }
                >
                  {feedback.text}
                </div>
              )}
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary" isDisabled={isSavingName}>
              {t("profile.close")}
            </Button>
            <Button
              variant="primary"
              onPress={handleSaveName}
              isDisabled={isSavingName || isUploading}
            >
              {isSavingName ? t("profile.saving") : t("profile.saveName")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
