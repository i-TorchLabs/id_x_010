/**
 * Markdown 文件上传 API 客户端
 *
 * 上传的 Markdown 文件经后端校验（扩展名 / Content-Type / 大小 / UTF-8 / 内容嗅探）
 * 通过后按用户持久化到 user_markdown_prompts 表。用户首条提示词自动设为活跃；
 * 同名文件覆盖内容并保持原 is_active 状态。
 *
 * 当前选中的提示词（is_active=true）由后端在每轮对话（chat / streamChat）中
 * 自动读取并注入为系统提示词，前端无需在请求中携带 promptContent。
 */

import { BASE_URL } from "@/utils/config";
import type { User } from "@/api/graphql";

/** 提示词记录（与后端 MarkdownPromptType 对应） */
export interface MarkdownPrompt {
  id: number;
  filename: string;
  noteName: string | null;
  content: string;
  isActive: boolean;
  charCount: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface UploadMarkdownResult {
  success: boolean;
  prompt?: MarkdownPrompt;
  error?: string;
}

// 前端预校验：减少无效的 multipart 请求往返
const ALLOWED_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd"];
const ALLOWED_MIME_TYPES = [
  "text/markdown",
  "text/x-markdown",
  "text/plain",
  "application/octet-stream",
];
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB，与后端一致

function handleUnauthorized(): void {
  if (typeof window !== "undefined") {
    localStorage.removeItem("token");
    localStorage.removeItem("expires_at");
    localStorage.removeItem("user");
    window.location.href = "/f/010/user-login";
  }
}

function getToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem("token") : null;
}

/** 将后端 camelCase 字段映射为前端类型 */
function toPrompt(raw: any): MarkdownPrompt {
  return {
    id: raw.id,
    filename: raw.filename,
    noteName: raw.noteName ?? raw.note_name ?? null,
    content: raw.content,
    isActive: raw.isActive ?? raw.is_active ?? false,
    charCount: raw.charCount ?? raw.char_count ?? 0,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    updatedAt: raw.updatedAt ?? raw.updated_at ?? null,
  };
}

/**
 * 前端预校验：扩展名 + MIME 类型 + 大小。后端会再做内容嗅探。
 * 返回错误信息字符串，通过校验返回 null。
 */
export function prevalidateMarkdownFile(file: File): string | null {
  const name = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `Only Markdown files are supported (.md / .markdown). Selected: ${file.name}`;
  }

  // file.type 在某些系统下为空，仅当存在且非允许值时报错
  if (
    file.type &&
    !ALLOWED_MIME_TYPES.includes(file.type.toLowerCase())
  ) {
    return `Unsupported file type: ${file.type}. Please upload a Markdown file.`;
  }

  if (file.size === 0) {
    return "File is empty";
  }

  if (file.size > MAX_FILE_SIZE) {
    return `File too large (>${MAX_FILE_SIZE / 1024 / 1024}MB). Please reduce the size.`;
  }

  return null;
}

export async function uploadMarkdown(
  file: File,
  signal?: AbortSignal,
): Promise<UploadMarkdownResult> {
  const preError = prevalidateMarkdownFile(file);
  if (preError) {
    return { success: false, error: preError };
  }

  const url = `${BASE_URL}/b/id_x_010/upload-markdown`;
  const formData = new FormData();
  formData.append("file", file);

  // 注意：multipart/form-data 的 Content-Type 由浏览器自动设置（含 boundary），
  // 切勿手动指定，否则后端无法解析 boundary。
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      signal,
    });

    if (response.status === 401) {
      handleUnauthorized();
      return { success: false, error: "Unauthorized. Please sign in again." };
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      return {
        success: false,
        error:
          data?.error || `Upload failed (HTTP ${response.status}). Please try again later.`,
      };
    }

    return {
      success: true,
      prompt: data.prompt ? toPrompt(data.prompt) : undefined,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Upload cancelled" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unknown error occurred during upload",
    };
  }
}

// ──────────────────────────────────────────────────────────────
// 头像上传
// ──────────────────────────────────────────────────────────────

const AVATAR_ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const AVATAR_MAX_SIZE = 8 * 1024 * 1024; // 8MB，与后端一致

export interface UploadAvatarResult {
  success: boolean;
  user?: User;
  avatarUrl?: string;
  error?: string;
}

/**
 * 前端预校验头像文件。
 * 返回错误信息字符串，通过校验返回 null。
 */
export function prevalidateAvatarFile(file: File): string | null {
  if (file.size === 0) return "File is empty";
  if (file.size > AVATAR_MAX_SIZE) {
    return `Avatar too large (>${AVATAR_MAX_SIZE / 1024 / 1024}MB). Please compress it first.`;
  }
  // 注：上限与后端 _AVATAR_MAX_BYTES 保持一致（8MB）；如需调整请同步修改两端
  // file.type 在某些系统下可能为空，仅在非空且不支持时报错；空类型交由后端嗅探兜底
  if (file.type && !AVATAR_ALLOWED_TYPES.includes(file.type.toLowerCase())) {
    return `Only JPEG/PNG/WebP/GIF are supported. Got: ${file.type}`;
  }
  return null;
}

/**
 * 上传头像图片到 /upload-avatar 端点。
 * 成功后返回新的 user 对象与 avatarUrl（已带版本号防缓存）。
 */
export async function uploadAvatar(
  file: File,
  signal?: AbortSignal,
): Promise<UploadAvatarResult> {
  const preError = prevalidateAvatarFile(file);
  if (preError) {
    return { success: false, error: preError };
  }

  const url = `${BASE_URL}/b/id_x_010/upload-avatar`;
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      signal,
    });

    if (response.status === 401) {
      handleUnauthorized();
      return { success: false, error: "Unauthorized. Please sign in again." };
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      return {
        success: false,
        error:
          data?.error || `Upload failed (HTTP ${response.status}). Please try again later.`,
      };
    }

    return {
      success: true,
      avatarUrl: data.avatarUrl,
      user: data.user as User,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Upload cancelled" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "An unknown error occurred during upload",
    };
  }
}


// TASK-015：通用图片上传，供 VL Agent 使用
export interface UploadImageResult {
  success: boolean;
  image_id?: number;
  filename?: string;
  error?: string;
}

export async function uploadImage(
  file: File,
  signal?: AbortSignal,
): Promise<UploadImageResult> {
  // 仅允许 image/*；≤8MB
  if (!file.type.startsWith("image/")) {
    return { success: false, error: "Only image uploads are allowed" };
  }
  if (file.size > 8 * 1024 * 1024) {
    return { success: false, error: "Image too large (>8MB)" };
  }

  const url = `${BASE_URL}/b/id_x_010/upload-image`;
  const formData = new FormData();
  formData.append("file", file);

  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      signal,
    });

    if (response.status === 401) {
      handleUnauthorized();
      return { success: false, error: "Unauthorized. Please sign in again." };
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      return {
        success: false,
        error: data?.error || `Upload failed (HTTP ${response.status})`,
      };
    }

    return {
      success: true,
      image_id: data.image_id,
      filename: data.filename,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return { success: false, error: "Upload cancelled" };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
