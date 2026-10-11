"use client";

/**
 * 后台管理面板 — 3 个页签
 * 1. 系统模型管理：CRUD system_model_settings
 * 2. 用户管理：用户列表 + 系统模型配额设置 + 密码重置
 * 3. 资费管理：按用户查看系统模型用量与配额使用情况
 */

import { useEffect, useState, useCallback } from "react";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { API_BASE_URL, BASE_URL } from "@/utils/config";

// ── GraphQL helper ──
async function gql<T = any>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const res = await fetch(API_BASE_URL || BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: any) => e.message).join(", "));
  return json.data as T;
}

// ── Types ──
interface AdminUser {
  id: number; email: string; display_name?: string | null;
  is_active: boolean; is_admin: boolean; role: string;
  created_at?: string | null; updated_at?: string | null;
}
interface SystemModel {
  id: number; name: string; provider: string; baseUrl: string;
  apiKey: string; modelType: string; isDefault: boolean;
  enabled: boolean; sortOrder: number;
}
interface AdminUsage {
  userId: number; email: string; displayName?: string | null;
  systemModelQuotaUsd: number | null;
  monthCostUsd: number; monthRequests: number; totalCostUsd: number;
}

type Tab = "models" | "users" | "billing";
type Feedback = { kind: "ok" | "err"; text: string } | null;

// ════════════════════════════════════════════════════════════
// Main Component
// ════════════════════════════════════════════════════════════

export function AdminPanel() {
  const [tab, setTab] = useState<Tab>("models");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const tabs: { key: Tab; label: string }[] = [
    { key: "models", label: "System Models" },
    { key: "users", label: "Users" },
    { key: "billing", label: "Billing" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg1)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 56, borderBottom: "0.5px solid var(--divider)",
        background: "var(--surface-1)",
      }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Admin Console</span>
        <a href="/" style={{ fontSize: 13, color: "var(--fg3)" }}>← Back to App</a>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0,         borderBottom: "0.5px solid var(--divider)", paddingLeft: 24, paddingRight: 24 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFeedback(null); }}
            style={{
              padding: "10px 20px", fontSize: 13, fontWeight: tab === t.key ? 600 : 500,
              color: tab === t.key ? "var(--accent, #3b82f6)" : "var(--fg3)",
              borderBottom: tab === t.key ? "2px solid var(--accent, #3b82f6)" : "2px solid transparent",
              background: "transparent", border: "none", cursor: "pointer",
              transition: "color 150ms ease, border-color 150ms ease",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Feedback */}
      {feedback && (
        <div style={{
          margin: "12px 24px", padding: "8px 12px", borderRadius: 8, fontSize: 13,
          background: feedback.kind === "ok" ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)",
          border: `1px solid ${feedback.kind === "ok" ? "rgba(22,163,74,0.3)" : "rgba(220,38,38,0.3)"}`,
        }}>
          {feedback.text}
        </div>
      )}

      {/* Tab content */}
      <div style={{ padding: "16px 24px" }}>
        {tab === "models" && <SystemModelsTab onFeedback={setFeedback} />}
        {tab === "users" && <UsersTab onFeedback={setFeedback} />}
        {tab === "billing" && <BillingTab onFeedback={setFeedback} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 1: System Models Management
// ════════════════════════════════════════════════════════════

function SystemModelsTab({ onFeedback }: { onFeedback: (f: Feedback) => void }) {
  const [models, setModels] = useState<SystemModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<SystemModel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gql<{ systemModels: { success: boolean; models: SystemModel[] } }>(
        `query { systemModels { success models { id name provider baseUrl apiKey modelType isDefault enabled sortOrder } } }`,
      );
      setModels(data.systemModels.models);
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, [onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  const openAdd = () => {
    setEditing({ id: 0, name: "", provider: "", baseUrl: "", apiKey: "", modelType: "external", isDefault: false, enabled: true, sortOrder: 0 });
    setIsModalOpen(true);
  };
  const openEdit = (m: SystemModel) => { setEditing(m); setIsModalOpen(true); };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name || !editing.provider || !editing.baseUrl || !editing.apiKey) {
      onFeedback({ kind: "err", text: "All fields are required" });
      return;
    }
    try {
      await gql(
        `mutation($input: SystemModelInput!) { saveSystemModel(input: $input) { success message } }`,
        { input: { id: editing.id || null, name: editing.name, provider: editing.provider, baseUrl: editing.baseUrl, apiKey: editing.apiKey, modelType: editing.modelType, isDefault: editing.isDefault, enabled: editing.enabled, sortOrder: editing.sortOrder, testConnection: false } },
      );
      onFeedback({ kind: "ok", text: "Model saved" });
      setIsModalOpen(false);
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this system model?")) return;
    try {
      await gql(`mutation($modelId: Int!) { deleteSystemModel(modelId: $modelId) { success message } }`, { modelId: id });
      onFeedback({ kind: "ok", text: "Model deleted" });
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>System Models ({models.length})</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>Refresh</Button>
          <Button size="sm" variant="primary" onPress={openAdd}>+ Add Model</Button>
        </div>
      </div>

      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Name</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Provider</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Type</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Default</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Enabled</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id} style={{ borderBottom: "0.5px solid var(--divider)" }}>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{m.name}</td>
                <td style={{ padding: "8px 12px" }}>{m.provider}</td>
                <td style={{ padding: "8px 12px" }}>{m.modelType}</td>
                <td style={{ padding: "8px 12px" }}>{m.isDefault ? "✓" : ""}</td>
                <td style={{ padding: "8px 12px" }}>{m.enabled ? "✓" : "✗"}</td>
                <td style={{ padding: "8px 12px" }}>
                  <Button size="sm" variant="ghost" onPress={() => openEdit(m)}>Edit</Button>
                  <Button size="sm" variant="ghost" onPress={() => handleDelete(m.id)}>Delete</Button>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--fg3)" }}>No models yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Edit/Add Modal */}
      {editing && (
        <Modal.Backdrop isOpen={isModalOpen} onOpenChange={(o) => !o && setIsModalOpen(false)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[520px]">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>{editing.id ? "Edit Model" : "Add Model"}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">Model Name</Label>
                    <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. zai-org/GLM-5.2" />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">Provider</Label>
                    <Input value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value })} placeholder="e.g. SiliconFlow" />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">Base URL</Label>
                    <Input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder="https://api.example.com/v1" />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">API Key</Label>
                    <Input value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} placeholder="sk-..." />
                  </TextField>
                  <div style={{ display: "flex", gap: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />
                      Default
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
                      Enabled
                    </label>
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setIsModalOpen(false)}>Cancel</Button>
                <Button variant="primary" onPress={handleSave}>Save</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 2: User Management
// ════════════════════════════════════════════════════════════

function UsersTab({ onFeedback }: { onFeedback: (f: Feedback) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [quotaModal, setQuotaModal] = useState<{ userId: number; email: string } | null>(null);
  const [quotaValue, setQuotaValue] = useState("");
  const [resetModal, setResetModal] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gql<{ listUsers: { success: boolean; users: AdminUser[] } }>(
        `query { listUsers { success users { id email display_name is_active is_admin role created_at updated_at } } }`,
      );
      setUsers(data.listUsers.users);
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, [onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSetAdmin = async (u: AdminUser, next: boolean) => {
    try {
      await gql(`mutation($uid: Int!, $ia: Boolean!) { setUserAdmin(userId: $uid, isAdmin: $ia) { success message } }`, { uid: u.id, ia: next });
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleToggleActive = async (u: AdminUser, next: boolean) => {
    try {
      await gql(`mutation($uid: Int!, $ia: Boolean!) { toggleUserActive(userId: $uid, isActive: $ia) { success message } }`, { uid: u.id, ia: next });
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleResetPassword = async () => {
    if (!resetModal || !newPassword || newPassword.length < 6) return;
    try {
      await gql(`mutation($uid: Int!, $np: String!) { resetUserPassword(userId: $uid, newPassword: $np) { success message } }`, { uid: resetModal.id, np: newPassword });
      onFeedback({ kind: "ok", text: `${resetModal.email} password reset` });
      setResetModal(null); setNewPassword("");
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleSaveQuota = async () => {
    if (!quotaModal) return;
    const val = quotaValue.trim() === "" ? null : Number(quotaValue);
    if (val != null && (Number.isNaN(val) || val < 0)) {
      onFeedback({ kind: "err", text: "Quota must be a non-negative number" });
      return;
    }
    try {
      await gql(`mutation($uid: Int!, $q: Float) { setUserSystemQuota(userId: $uid, quotaUsd: $q) { success message } }`, { uid: quotaModal.userId, q: val });
      onFeedback({ kind: "ok", text: `Quota ${val == null ? "cleared" : `set to $${val}`} for ${quotaModal.email}` });
      setQuotaModal(null); setQuotaValue("");
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Users ({users.length})</span>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>Refresh</Button>
      </div>

      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>ID</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Email</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Name</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Active</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Role</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Admin</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "0.5px solid var(--divider)" }}>
                <td style={{ padding: "8px 12px" }}>{u.id}</td>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{u.email}</td>
                <td style={{ padding: "8px 12px" }}>{u.display_name || "-"}</td>
                <td style={{ padding: "8px 12px" }}><input type="checkbox" checked={u.is_active} onChange={(e) => handleToggleActive(u, e.target.checked)} /></td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{
                    fontSize: 12, padding: "2px 8px", borderRadius: 999,
                    background: u.role === "admin" ? "rgba(59,130,246,0.15)" : "var(--surface-2)",
                    color: u.role === "admin" ? "var(--accent, #3b82f6)" : "var(--fg3)",
                  }}>
                    {u.role === "admin" ? "管理员" : "普通用户"}
                  </span>
                </td>
                <td style={{ padding: "8px 12px" }}><input type="checkbox" checked={u.is_admin} onChange={(e) => handleSetAdmin(u, e.target.checked)} /></td>
                <td style={{ padding: "8px 12px" }}>
                  <Button size="sm" variant="ghost" onPress={() => { setQuotaModal({ userId: u.id, email: u.email }); setQuotaValue(""); }}>Set Quota</Button>
                  <Button size="sm" variant="ghost" onPress={() => { setResetModal(u); setNewPassword(""); }}>Reset PWD</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Quota Modal */}
      {quotaModal && (
        <Modal.Backdrop isOpen onOpenChange={(o) => !o && setQuotaModal(null)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[420px]">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>System Model Quota: {quotaModal.email}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">Monthly Quota (USD)</Label>
                  <Input type="number" min="0" step="0.01" value={quotaValue} onChange={(e) => setQuotaValue(e.target.value)} placeholder="Leave empty for unlimited" />
                </TextField>
                <p style={{ fontSize: 12, color: "var(--fg4)" }}>Only limits system model usage. Custom models are not limited.</p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setQuotaModal(null)}>Cancel</Button>
                <Button variant="primary" onPress={handleSaveQuota}>Save</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}

      {/* Password Reset Modal */}
      {resetModal && (
        <Modal.Backdrop isOpen onOpenChange={(o) => !o && setResetModal(null)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[420px]">
              <Modal.CloseTrigger />
              <Modal.Header><Modal.Heading>Reset Password: {resetModal.email}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">New Password</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 6 characters" />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setResetModal(null)}>Cancel</Button>
                <Button variant="primary" onPress={handleResetPassword}>Confirm</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 3: Billing Dashboard
// ════════════════════════════════════════════════════════════

function BillingTab({ onFeedback }: { onFeedback: (f: Feedback) => void }) {
  const [data, setData] = useState<AdminUsage[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(30);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const d = await gql<{ adminUsageStats: { success: boolean; users: AdminUsage[] } }>(
        `query($days: Int!) { adminUsageStats(days: $days) { success users { userId email displayName systemModelQuotaUsd monthCostUsd monthRequests totalCostUsd } } }`,
        { days },
      );
      setData(d.adminUsageStats.users);
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, [days, onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  const maxCost = Math.max(...data.map((u) => u.monthCostUsd), 1);
  const totalMonthCost = data.reduce((s, u) => s + u.monthCostUsd, 0);
  const totalRequests = data.reduce((s, u) => s + u.monthRequests, 0);
  const activeUsers = data.filter((u) => u.monthRequests > 0).length;

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "var(--surface-1)", border: "0.5px solid var(--divider)" }}>
          <p style={{ fontSize: 11, color: "var(--fg4)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Month Cost</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0" }}>${totalMonthCost.toFixed(4)}</p>
        </div>
        <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "var(--surface-1)", border: "0.5px solid var(--divider)" }}>
          <p style={{ fontSize: 11, color: "var(--fg4)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Requests</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0" }}>{totalRequests}</p>
        </div>
        <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "var(--surface-1)", border: "0.5px solid var(--divider)" }}>
          <p style={{ fontSize: 11, color: "var(--fg4)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>Active Users</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0" }}>{activeUsers}</p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>Days:</label>
          <Input type="number" min="1" max="365" value={String(days)} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))} style={{ width: 80 }} />
        </div>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>Refresh</Button>
      </div>

      {/* Bar chart — per user month cost */}
      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>Monthly System Model Cost by User</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.filter((u) => u.monthCostUsd > 0).map((u) => (
            <div key={u.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 160, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
              <div style={{ flex: 1, height: 24, background: "var(--surface-2)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  width: `${(u.monthCostUsd / maxCost) * 100}%`, height: "100%",
                  background: u.systemModelQuotaUsd != null && u.monthCostUsd >= u.systemModelQuotaUsd
                    ? "rgba(220,38,38,0.7)"
                    : "var(--accent, #3b82f6)",
                  borderRadius: 6, transition: "width 300ms ease",
                }} />
              </div>
              <span style={{ width: 100, fontSize: 12, textAlign: "right" }}>${u.monthCostUsd.toFixed(4)}</span>
            </div>
          ))}
          {data.filter((u) => u.monthCostUsd > 0).length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fg3)", textAlign: "center", padding: 20 }}>No usage data</p>
          )}
        </div>
      </div>

      {/* Detail table */}
      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>User</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Quota</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Month Cost</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Month Reqs</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Total ({days}d)</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>Usage</th>
            </tr>
          </thead>
          <tbody>
            {data.map((u) => {
              const usagePct = u.systemModelQuotaUsd != null && u.systemModelQuotaUsd > 0
                ? Math.min(100, (u.monthCostUsd / u.systemModelQuotaUsd) * 100) : 0;
              return (
                <tr key={u.userId} style={{ borderBottom: "0.5px solid var(--divider)" }}>
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{u.email}</td>
                  <td style={{ padding: "8px 12px" }}>{u.systemModelQuotaUsd != null ? `$${u.systemModelQuotaUsd}` : "∞"}</td>
                  <td style={{ padding: "8px 12px" }}>${u.monthCostUsd.toFixed(4)}</td>
                  <td style={{ padding: "8px 12px" }}>{u.monthRequests}</td>
                  <td style={{ padding: "8px 12px" }}>${u.totalCostUsd.toFixed(4)}</td>
                  <td style={{ padding: "8px 12px" }}>
                    {u.systemModelQuotaUsd != null ? (
                      <div style={{ width: 100, height: 8, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{
                          width: `${usagePct}%`, height: "100%",
                          background: usagePct >= 100 ? "rgba(220,38,38,0.7)" : "var(--accent, #3b82f6)",
                        }} />
                      </div>
                    ) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
