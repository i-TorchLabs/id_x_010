"use client";

/**
 * Prompt 工程工作台（TASK-018）
 *
 * 简化实现：
 * - 左侧模板列表（savePromptTemplate 保存过的版本）
 * - 右侧 textarea 编辑
 *
 * 鉴权：require_admin（后端 savePromptTemplate 守卫）。
 *
 * HeroUI v3 API：Button / Input / TextArea 直接命名导入（v3 中 Textarea 改名 TextArea）
 * Card 用原生 div 替代（避免 v3 命名空间复杂度）。
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import { API_BASE_URL, BASE_URL } from "@/utils/config";

interface PromptTemplate {
  id: number;
  key: string;
  version: number;
  content: string;
  is_active: boolean;
  created_at?: string | null;
}

interface SaveResult {
  success: boolean;
  message: string;
  template?: PromptTemplate;
}

const TEMPLATE_KEYS = [
  { key: "general.system", label: "General Agent System Prompt" },
  { key: "sql.generate_query", label: "SQL Agent Generate SQL" },
  { key: "sql.intent_analysis", label: "SQL Intent Analysis" },
  { key: "code.system", label: "Code Agent System" },
  { key: "vl.system", label: "VL Agent System" },
] as const;

async function graphqlRequest<T = any>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const url = API_BASE_URL || BASE_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join(", "));
  return json.data as T;
}

// 原生 textarea 样式
const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 320,
  padding: "10px 12px",
  borderRadius: 8,
  border: "0.5px solid var(--divider)",
  background: "var(--surface-1)",
  color: "var(--fg2)",
  fontFamily: "monospace",
  fontSize: 13,
  resize: "vertical",
  outline: "none",
};

export function PromptStudio() {
  const [selectedKey, setSelectedKey] = useState<string>(TEMPLATE_KEYS[0].key);
  const [content, setContent] = useState("");
  const [versions, setVersions] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const handleSave = useCallback(async () => {
    setLoading(true);
    try {
      const data = await graphqlRequest<{ savePromptTemplate: SaveResult }>(
        `mutation($key: String!, $content: String!) {
          savePromptTemplate(key: $key, content: $content) {
            success message
            template { id key version is_active created_at }
          }
        }`,
        { key: selectedKey, content },
      );
      if (data.savePromptTemplate.success) {
        setMessage({ kind: "ok", text: `Saved as v${data.savePromptTemplate.template?.version}` });
        if (data.savePromptTemplate.template) {
          setVersions((prev) => [data.savePromptTemplate.template!, ...prev]);
        }
      } else {
        setMessage({ kind: "err", text: data.savePromptTemplate.message });
      }
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [selectedKey, content]);

  useEffect(() => {
    setContent("");
    setMessage(null);
  }, [selectedKey]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Prompt Studio</h2>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          style={{
            marginBottom: 12,
            padding: "8px 12px",
            borderRadius: 8,
            background: message.kind === "ok" ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)",
            border: `1px solid ${message.kind === "ok" ? "rgba(22,163,74,0.4)" : "rgba(220,38,38,0.4)"}`,
            fontSize: 13,
          }}
        >
          {message.text}
        </motion.div>
      )}

      <div style={{ display: "flex", gap: 16 }}>
        {/* 左侧模板 key 列表 */}
        <div
          style={{
            width: 240,
            flexShrink: 0,
            padding: 12,
            background: "var(--surface-1)",
            border: "0.5px solid var(--divider)",
            borderRadius: 12,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--fg3)" }}>
            Template KEY
          </div>
          {TEMPLATE_KEYS.map((k) => (
            <button
              key={k.key}
              type="button"
              onClick={() => setSelectedKey(k.key)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 6,
                marginBottom: 4,
                background: selectedKey === k.key ? "var(--surface-2)" : "transparent",
                border: "0.5px solid var(--divider)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 12 }}>{k.label}</div>
              <div style={{ fontSize: 10, color: "var(--fg3)", marginTop: 2 }}>{k.key}</div>
            </button>
          ))}
        </div>

        {/* 右侧编辑器 */}
        <div style={{ flex: 1 }}>
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              background: "var(--surface-1)",
              border: "0.5px solid var(--divider)",
              borderRadius: 12,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div>
                <span style={{ fontSize: 12, color: "var(--fg3)" }}>Currently editing:</span>
                <code style={{ fontSize: 13, fontWeight: 500 }}>{selectedKey}</code>
              </div>
              <Button size="sm" variant="primary" isDisabled={loading} onPress={handleSave}>
                Save as New Version
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`Edit the prompt content for ${selectedKey}...\n\nSupports {var} placeholders (e.g. {top_k}, {intent_guidance}). Once saved, this version takes effect immediately for subsequent requests.`}
              style={textareaStyle}
            />
          </div>

          {versions.length > 0 && (
            <div
              style={{
                padding: 12,
                background: "var(--surface-1)",
                border: "0.5px solid var(--divider)",
                borderRadius: 12,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 8, color: "var(--fg3)" }}>
                Versions saved this session (visible only on this page)
              </div>
              {versions.map((v) => (
                <div key={v.id} style={{ padding: "6px 0", borderBottom: "0.5px solid var(--divider)", fontSize: 12 }}>
                  v{v.version} · {v.is_active ? "✓ Active" : "Inactive"} ·{" "}
                  {v.created_at ? new Date(v.created_at).toLocaleString() : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
