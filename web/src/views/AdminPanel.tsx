"use client";

/**
 * 后台运维面板（TASK-013）
 *
 * 简化版：仅实现用户管理（list / setAdmin / toggleActive / resetPassword）。
 * 模型/数据库/SQL 例子/审批 等其它 tab 后续可在此文件 expansion。
 *
 * 鉴权：客户端通过 AuthGuard 检查 user.is_admin，非 admin 重定向 /。
 * 后端 require_admin 同样守护，客户端绕过会被服务端 403。
 *
 * HeroUI v3 API：
 * - Modal 用 Modal.Backdrop / Modal.Container / Modal.Dialog / Modal.Body 命名空间
 * - Button / Input / Label / TextField 直接命名导入
 * - Table 用原生 HTML（避免 v3 Table 命名空间 API 复杂度）
 */

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { API_BASE_URL, BASE_URL } from "@/utils/config";

interface AdminUser {
  id: number;
  email: string;
  display_name?: string | null;
  is_active: boolean;
  is_admin: boolean;
  created_at?: string | null;
  updated_at?: string | null;
}

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

export function AdminPanel() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await graphqlRequest<{ listUsers: { success: boolean; message: string; users: AdminUser[] } }>(
        `query { listUsers { success message users { id email display_name is_active is_admin created_at updated_at } } }`,
      );
      setUsers(data.listUsers.users);
    } catch (e) {
      setMessage({ kind: "err", text: `Load failed: ${(e as Error).message}` });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSetAdmin = useCallback(
    async (u: AdminUser, next: boolean) => {
      try {
        await graphqlRequest(
          `mutation($user_id: Int!, $is_admin: Boolean!) { setUserAdmin(userId: $user_id, isAdmin: $is_admin) { success message } }`,
          { user_id: u.id, is_admin: next },
        );
        setMessage({ kind: "ok", text: `${u.email} ${next ? "set as admin" : "admin revoked"}` });
        refresh();
      } catch (e) {
        setMessage({ kind: "err", text: (e as Error).message });
      }
    },
    [refresh],
  );

  const handleToggleActive = useCallback(
    async (u: AdminUser, next: boolean) => {
      try {
        await graphqlRequest(
          `mutation($user_id: Int!, $is_active: Boolean!) { toggleUserActive(userId: $user_id, isActive: $is_active) { success message } }`,
          { user_id: u.id, is_active: next },
        );
        setMessage({ kind: "ok", text: `${u.email} ${next ? "activated" : "deactivated"}` });
        refresh();
      } catch (e) {
        setMessage({ kind: "err", text: (e as Error).message });
      }
    },
    [refresh],
  );

  const openResetModal = useCallback((u: AdminUser) => {
    setResetTarget(u);
    setNewPassword("");
    setIsResetOpen(true);
  }, []);

  const closeResetModal = useCallback(() => {
    setIsResetOpen(false);
    setResetTarget(null);
    setNewPassword("");
  }, []);

  const handleResetPassword = useCallback(async () => {
    if (!resetTarget) return;
    if (!newPassword || newPassword.length < 6) {
      setMessage({ kind: "err", text: "Password must be at least 6 characters" });
      return;
    }
    try {
      await graphqlRequest(
        `mutation($user_id: Int!, $new_password: String!) { resetUserPassword(userId: $user_id, newPassword: $new_password) { success message } }`,
        { user_id: resetTarget.id, new_password: newPassword },
      );
      setMessage({ kind: "ok", text: `${resetTarget.email} password has been reset` });
      closeResetModal();
    } catch (e) {
      setMessage({ kind: "err", text: (e as Error).message });
    }
  }, [resetTarget, newPassword, closeResetModal]);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Admin Panel</h2>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>
          Refresh
        </Button>
      </div>

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

      {/* 用原生 HTML 表格，避免 HeroUI v3 Table 命名空间 API 复杂度 */}
      <div
        style={{
          background: "var(--surface-1)",
          border: "0.5px solid var(--divider)",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>ID</th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Email</th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Display Name</th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Active</th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Admin</th>
              <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "0.5px solid var(--divider)" }}>
                <td style={{ padding: "8px 12px" }}>{u.id}</td>
                <td style={{ padding: "8px 12px" }}>{u.email}</td>
                <td style={{ padding: "8px 12px" }}>{u.display_name || "-"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <input
                    type="checkbox"
                    checked={u.is_active}
                    onChange={(e) => handleToggleActive(u, e.target.checked)}
                  />
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <input
                    type="checkbox"
                    checked={u.is_admin}
                    onChange={(e) => handleSetAdmin(u, e.target.checked)}
                  />
                </td>
                <td style={{ padding: "8px 12px" }}>
                  <Button size="sm" variant="ghost" onPress={() => openResetModal(u)}>
                    Reset Password
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 重置密码 Modal —— HeroUI v3 命名空间 API */}
      <Modal.Backdrop isOpen={isResetOpen} onOpenChange={(o) => !o && closeResetModal()}>
        <Modal.Container>
          <Modal.Dialog className="sm:max-w-[420px]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Reset Password: {resetTarget?.email}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField fullWidth className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium">New Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                />
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="ghost" onPress={closeResetModal}>
                Cancel
              </Button>
              <Button variant="primary" onPress={handleResetPassword}>
                Confirm
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
