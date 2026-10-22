"use client";

/**
 * 后台管理面板 — 3 个页签
 * 1. 系统模型管理：CRUD system_model_settings
 * 2. 用户管理：用户列表 + 系统模型配额设置 + 密码重置
 * 3. 资费管理：按用户查看系统模型用量与配额使用情况
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { LangToggle } from "@/components/LangToggle";
import { useI18n } from "@/context/I18nContext";
import { API_BASE_URL, BASE_URL } from "@/utils/config";
import {
  adminSystemModelUserKeyGraphqlApi,
  type SystemModelUserMappingItem,
} from "@/api/graphql";
import {
  clearSsoLoginFlag,
  isSsoLogin,
  redirectToAdfsLogout,
} from "@/utils/sso";

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
  id: number; email: string; displayName?: string | null;
  isActive: boolean; isAdmin: boolean; role: string;
  createdAt?: string | null; updatedAt?: string | null;
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
  const router = useRouter();
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("models");
  const [feedback, setFeedback] = useState<Feedback>(null);

  const handleLogout = async () => {
    const ssoSession = isSsoLogin();
    try {
      await gql("mutation { logout { success message } }");
    } catch (e) {
      // 忽略后端登出失败，继续清理本地状态
    } finally {
      if (typeof window !== "undefined") {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        clearSsoLoginFlag();
      }
      if (ssoSession) {
        redirectToAdfsLogout();
      } else {
        router.push("/f/admin-login");
      }
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "models", label: t("admin.tabModels") },
    { key: "users", label: t("admin.tabUsers") },
    { key: "billing", label: t("admin.tabBilling") },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--fg1)" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 24px", height: 56, borderBottom: "0.5px solid var(--divider)",
        background: "var(--surface-1)",
      }}>
        <span style={{ fontSize: 16, fontWeight: 600 }}>{t("admin.headerTitle")}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <LangToggle />
          <Button size="sm" variant="ghost" onPress={handleLogout} style={{ fontSize: 13 }}>{t("admin.logout")}</Button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0,         borderBottom: "0.5px solid var(--divider)", paddingLeft: 24, paddingRight: 24 }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setFeedback(null); }}
            style={{
              padding: "10px 20px", fontSize: 13, fontWeight: tab === t.key ? 600 : 500,
              color: tab === t.key ? "var(--fg1)" : "var(--fg3)",
              background: "transparent", border: "none", cursor: "pointer",
              borderBottom: tab === t.key ? "2px solid var(--accent)" : "2px solid transparent",
              borderRadius: "8px 8px 0 0",
              transition: "color 180ms ease, border-color 180ms ease, background-color 180ms ease",
            }}
            onMouseEnter={(e) => {
              if (tab !== t.key) e.currentTarget.style.backgroundColor = "var(--hover-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Feedback */}
      {feedback && (
        <div style={{
          margin: "12px 24px", padding: "8px 12px", borderRadius: 10, fontSize: 13,
          background: feedback.kind === "ok" ? "var(--badge-bg)" : "var(--error-bg)",
          border: `0.5px solid ${feedback.kind === "ok" ? "var(--divider-strong)" : "var(--error-border)"}`,
          color: feedback.kind === "ok" ? "var(--fg1)" : "var(--error)",
          boxShadow: "var(--shadow-xs)",
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
  const { t } = useI18n();
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
      onFeedback({ kind: "err", text: t("admin.models.errorAllFieldsRequired") });
      return;
    }
    try {
      await gql(
        `mutation($input: SystemModelInput!) { saveSystemModel(input: $input) { success message } }`,
        { input: { id: editing.id || null, name: editing.name, provider: editing.provider, baseUrl: editing.baseUrl, apiKey: editing.apiKey, modelType: editing.modelType, isDefault: editing.isDefault, enabled: editing.enabled, sortOrder: editing.sortOrder, testConnection: false } },
      );
      onFeedback({ kind: "ok", text: t("admin.models.modelSaved") });
      setIsModalOpen(false);
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("admin.models.confirmDelete"))) return;
    try {
      await gql(`mutation($modelId: Int!) { deleteSystemModel(modelId: $modelId) { success message } }`, { modelId: id });
      onFeedback({ kind: "ok", text: t("admin.models.modelDeleted") });
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("admin.models.sectionTitle", { count: models.length })}</span>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>{t("admin.refresh")}</Button>
          <Button size="sm" variant="primary" onPress={openAdd}>{t("admin.models.addModel")}</Button>
        </div>
      </div>

      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colName")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colProvider")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colType")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colDefault")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colEnabled")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.colActions")}</th>
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
                  <Button size="sm" variant="ghost" onPress={() => openEdit(m)}>{t("admin.edit")}</Button>
                  <Button size="sm" variant="ghost" onPress={() => handleDelete(m.id)}>{t("admin.delete")}</Button>
                </td>
              </tr>
            ))}
            {models.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--fg3)" }}>{t("admin.models.empty")}</td></tr>
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
              <Modal.Header><Modal.Heading>{editing.id ? t("admin.models.editModelTitle") : t("admin.models.addModelTitle")}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.models.fieldModelName")}</Label>
                    <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder={t("admin.models.fieldModelNamePlaceholder")} />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.models.fieldProvider")}</Label>
                    <Input value={editing.provider} onChange={(e) => setEditing({ ...editing, provider: e.target.value })} placeholder={t("admin.models.fieldProviderPlaceholder")} />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.models.fieldBaseUrl")}</Label>
                    <Input value={editing.baseUrl} onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })} placeholder={t("admin.models.fieldBaseUrlPlaceholder")} />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.models.fieldApiKey")}</Label>
                    <Input value={editing.apiKey} onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })} placeholder={t("admin.models.fieldApiKeyPlaceholder")} />
                  </TextField>
                  <div style={{ display: "flex", gap: 16 }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={editing.isDefault} onChange={(e) => setEditing({ ...editing, isDefault: e.target.checked })} />
                      {t("admin.models.fieldDefault")}
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                      <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
                      {t("admin.models.fieldEnabled")}
                    </label>
                  </div>
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setIsModalOpen(false)}>{t("admin.cancel")}</Button>
                <Button variant="primary" onPress={handleSave}>{t("admin.save")}</Button>
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
  const { t } = useI18n();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [quotaModal, setQuotaModal] = useState<{ userId: number; email: string } | null>(null);
  const [quotaValue, setQuotaValue] = useState("");
  const [resetModal, setResetModal] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [modelKeysModal, setModelKeysModal] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gql<{ listUsers: { success: boolean; users: AdminUser[] } }>(
        `query { listUsers { success users { id email displayName isActive isAdmin role createdAt updatedAt } } }`,
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
      onFeedback({ kind: "ok", text: t("admin.users.feedbackPasswordReset", { email: resetModal.email }) });
      setResetModal(null); setNewPassword("");
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleSaveQuota = async () => {
    if (!quotaModal) return;
    const val = quotaValue.trim() === "" ? null : Number(quotaValue);
    if (val != null && (Number.isNaN(val) || val < 0)) {
      onFeedback({ kind: "err", text: t("admin.users.errorQuotaInvalid") });
      return;
    }
    try {
      await gql(`mutation($uid: Int!, $q: Float) { setUserSystemQuota(userId: $uid, quotaUsd: $q) { success message } }`, { uid: quotaModal.userId, q: val });
      onFeedback({ kind: "ok", text: `${t("admin.users.quotaModalTitle", { email: quotaModal.email })}: ${val == null ? t("admin.users.quotaCleared") : t("admin.users.quotaSetTo", { val })}` });
      setQuotaModal(null); setQuotaValue("");
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{t("admin.users.sectionTitle", { count: users.length })}</span>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>{t("admin.refresh")}</Button>
      </div>

      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colId")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colEmail")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colName")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colActive")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colRole")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colAdmin")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={{ borderBottom: "0.5px solid var(--divider)" }}>
                <td style={{ padding: "8px 12px" }}>{u.id}</td>
                <td style={{ padding: "8px 12px", fontWeight: 600 }}>{u.email}</td>
                <td style={{ padding: "8px 12px" }}>{u.displayName || "-"}</td>
                <td style={{ padding: "8px 12px" }}><input type="checkbox" checked={u.isActive} onChange={(e) => handleToggleActive(u, e.target.checked)} /></td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{
                    fontSize: 12, padding: "2px 8px", borderRadius: 999,
                    border: "0.5px solid var(--divider)",
                    background: u.role.split(",").map(r => r.trim()).includes("admin") ? "var(--badge-bg)" : "var(--surface-2)",
                    color: u.role.split(",").map(r => r.trim()).includes("admin") ? "var(--fg1)" : "var(--fg3)",
                  }}>
                    {u.role.split(",").map(r => r.trim()).includes("admin") ? t("admin.users.roleAdmin") : t("admin.users.roleUser")}
                  </span>
                </td>
                <td style={{ padding: "8px 12px" }}><input type="checkbox" checked={u.isAdmin} onChange={(e) => handleSetAdmin(u, e.target.checked)} /></td>
                <td style={{ padding: "8px 12px" }}>
                  <Button size="sm" variant="ghost" onPress={() => { setQuotaModal({ userId: u.id, email: u.email }); setQuotaValue(""); }}>{t("admin.users.setQuota")}</Button>
                  <Button size="sm" variant="ghost" onPress={() => { setResetModal(u); setNewPassword(""); }}>{t("admin.users.resetPassword")}</Button>
                  <Button size="sm" variant="ghost" onPress={() => setModelKeysModal(u)}>{t("admin.users.modelKeys")}</Button>
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
              <Modal.Header><Modal.Heading>{t("admin.users.quotaModalTitle", { email: quotaModal.email })}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">{t("admin.users.fieldMonthlyQuota")}</Label>
                  <Input type="number" min="0" step="0.01" value={quotaValue} onChange={(e) => setQuotaValue(e.target.value)} placeholder={t("admin.users.quotaPlaceholder")} />
                </TextField>
                <p style={{ fontSize: 12, color: "var(--fg4)" }}>{t("admin.users.quotaHelpText")}</p>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setQuotaModal(null)}>{t("admin.cancel")}</Button>
                <Button variant="primary" onPress={handleSaveQuota}>{t("admin.save")}</Button>
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
              <Modal.Header><Modal.Heading>{t("admin.users.resetPasswordModalTitle", { email: resetModal.email })}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <TextField fullWidth className="flex flex-col gap-1.5">
                  <Label className="text-sm font-medium">{t("admin.users.fieldNewPassword")}</Label>
                  <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t("admin.users.newPasswordPlaceholder")} />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="ghost" onPress={() => setResetModal(null)}>{t("admin.cancel")}</Button>
                <Button variant="primary" onPress={handleResetPassword}>{t("admin.confirm")}</Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      )}

      {/* System Model API Keys Modal */}
      {modelKeysModal && (
        <ModelKeysModal
          user={modelKeysModal}
          onClose={() => setModelKeysModal(null)}
          onFeedback={onFeedback}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Model Keys Modal — 管理员为指定用户配置系统预置模型的 API Key
// ════════════════════════════════════════════════════════════

interface SystemModelBrief {
  id: number;
  name: string;
  provider: string;
  enabled: boolean;
}

function ModelKeysModal({
  user,
  onClose,
  onFeedback,
}: {
  user: AdminUser;
  onClose: () => void;
  onFeedback: (f: Feedback) => void;
}) {
  const { t } = useI18n();
  const [models, setModels] = useState<SystemModelBrief[]>([]);
  const [mappings, setMappings] = useState<Map<number, SystemModelUserMappingItem>>(new Map());
  const [editing, setEditing] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [sysRes, keyRes] = await Promise.all([
        gql<{ systemModels: { success: boolean; models: SystemModelBrief[] } }>(
          `query { systemModels { success models { id name provider enabled } } }`,
        ),
        adminSystemModelUserKeyGraphqlApi.adminListUserSystemModelKeys(user.id),
      ]);
      setModels(sysRes.systemModels.models ?? []);
      const map = new Map<number, SystemModelUserMappingItem>();
      for (const m of keyRes.adminListUserSystemModelKeys.mappings ?? []) {
        map.set(m.systemModelId, m);
      }
      setMappings(map);
      setEditing({});
    } catch (e) {
      onFeedback({ kind: "err", text: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }, [user.id, onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSave = async (smId: number, testConnection: boolean) => {
    const val = (editing[smId] ?? "").trim();
    if (!val) return;
    setSavingId(smId);
    try {
      const r = await adminSystemModelUserKeyGraphqlApi.adminSaveUserSystemModelKey({
        userId: user.id,
        systemModelId: smId,
        apiKey: val,
        testConnection,
      });
      if (r.adminSaveUserSystemModelKey.success && r.adminSaveUserSystemModelKey.mapping) {
        const next = new Map(mappings);
        next.set(smId, r.adminSaveUserSystemModelKey.mapping);
        setMappings(next);
        setEditing((e) => { const n = { ...e }; delete n[smId]; return n; });
        onFeedback({ kind: "ok", text: `${user.email} key saved for ${models.find((m) => m.id === smId)?.name ?? smId}` });
      } else {
        onFeedback({ kind: "err", text: r.adminSaveUserSystemModelKey.message });
      }
    } catch (e) {
      onFeedback({ kind: "err", text: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (smId: number) => {
    setSavingId(smId);
    try {
      const r = await adminSystemModelUserKeyGraphqlApi.adminDeleteUserSystemModelKey(user.id, smId);
      if (r.adminDeleteUserSystemModelKey.success) {
        const next = new Map(mappings);
        next.delete(smId);
        setMappings(next);
        setEditing((e) => { const n = { ...e }; delete n[smId]; return n; });
        onFeedback({ kind: "ok", text: `${user.email} key removed for ${models.find((m) => m.id === smId)?.name ?? smId}` });
      } else {
        onFeedback({ kind: "err", text: r.adminDeleteUserSystemModelKey.message });
      }
    } catch (e) {
      onFeedback({ kind: "err", text: (e as Error).message });
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[560px]">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("admin.users.modelKeysModalTitle", { email: user.email })}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {loading ? (
              <p style={{ fontSize: 13, color: "var(--fg3)" }}>{t("admin.loading")}</p>
            ) : models.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--fg3)" }}>{t("admin.users.noSystemModels")}</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {models.map((sm) => {
                  const mp = mappings.get(sm.id);
                  const hasKey = mp != null;
                  const draft = editing[sm.id] ?? (hasKey ? mp!.apiKey : "");
                  return (
                    <div key={sm.id} style={{ padding: 12, borderRadius: 12, background: "var(--surface-2)", border: `0.5px solid ${hasKey ? "var(--divider-strong)" : "var(--divider)"}`, boxShadow: hasKey ? "var(--shadow-inset), var(--shadow-xs)" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <div>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{sm.name}</span>
                          <span style={{ fontSize: 11, color: "var(--fg4)", marginLeft: 6 }}>{sm.provider}{!sm.enabled ? t("admin.users.disabledSuffix") : ""}</span>
                        </div>
                        {hasKey && <span style={{ fontSize: 11, color: "var(--fg3)" }}>{t("admin.users.configured")}</span>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <Input
                          type="password"
                          placeholder={t("admin.users.apiKeyPlaceholder")}
                          value={draft}
                          onChange={(e) => setEditing((p) => ({ ...p, [sm.id]: e.target.value }))}
                          style={{ flex: 1 }}
                        />
                        <Button size="sm" variant="primary" isDisabled={!draft.trim() || savingId === sm.id} onPress={() => handleSave(sm.id, true)}>
                          {savingId === sm.id ? t("admin.saving") : t("admin.save")}
                        </Button>
                        {hasKey && (
                          <Button size="sm" variant="ghost" isDisabled={savingId === sm.id} onPress={() => handleDelete(sm.id)}>
                            {t("admin.remove")}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>{t("admin.close")}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 3: Billing Dashboard
// ════════════════════════════════════════════════════════════

function BillingTab({ onFeedback }: { onFeedback: (f: Feedback) => void }) {
  const { t } = useI18n();
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
          <p style={{ fontSize: 11, color: "var(--fg4)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("admin.billing.cardMonthCost")}</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0" }}>${totalMonthCost.toFixed(4)}</p>
        </div>
        <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "var(--surface-1)", border: "0.5px solid var(--divider)" }}>
          <p style={{ fontSize: 11, color: "var(--fg4)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("admin.billing.cardRequests")}</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0" }}>{totalRequests}</p>
        </div>
        <div style={{ flex: 1, padding: 16, borderRadius: 12, background: "var(--surface-1)", border: "0.5px solid var(--divider)" }}>
          <p style={{ fontSize: 11, color: "var(--fg4)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>{t("admin.billing.cardActiveUsers")}</p>
          <p style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 0" }}>{activeUsers}</p>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 13 }}>{t("admin.billing.daysLabel")}</label>
          <Input type="number" min="1" max="365" value={String(days)} onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))} style={{ width: 80 }} />
        </div>
        <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>{t("admin.refresh")}</Button>
      </div>

      {/* Bar chart — per user month cost */}
      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>{t("admin.billing.costByUserTitle")}</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.filter((u) => u.monthCostUsd > 0).map((u) => (
            <div key={u.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 160, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</span>
              <div style={{ flex: 1, height: 24, background: "var(--surface-2)", borderRadius: 6, overflow: "hidden" }}>
                <div style={{
                  width: `${(u.monthCostUsd / maxCost) * 100}%`, height: "100%",
                  background: u.systemModelQuotaUsd != null && u.monthCostUsd >= u.systemModelQuotaUsd
                    ? "var(--error)"
                    : "var(--accent)",
                  borderRadius: 6, transition: "width 300ms ease",
                }} />
              </div>
              <span style={{ width: 100, fontSize: 12, textAlign: "right" }}>${u.monthCostUsd.toFixed(4)}</span>
            </div>
          ))}
          {data.filter((u) => u.monthCostUsd > 0).length === 0 && (
            <p style={{ fontSize: 13, color: "var(--fg3)", textAlign: "center", padding: 20 }}>{t("admin.billing.noUsageData")}</p>
          )}
        </div>
      </div>

      {/* Detail table */}
      <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)" }}>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colUser")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colQuota")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colMonthCost")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colMonthRequests")}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colTotal", { days })}</th>
              <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colUsage")}</th>
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
                          background: usagePct >= 100 ? "var(--error)" : "var(--accent)",
                          transition: "width 300ms ease",
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
