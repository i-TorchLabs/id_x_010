"use client";

/**
 * 后台管理面板 — 4 个页签
 * 1. 系统模型管理：CRUD system_model_settings（模型列表全局共享，不含 api_key）
 * 2. 用户管理：用户列表 + 个人 API-Key（users.api_key）+ 配额 + 密码重置
 * 3. 资费管理：按用户查看系统模型用量与配额使用情况
 * 4. 模型价格：CRUD model_prices（input / output 单价，USD / 1M tokens）
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Label, Modal, TextField } from "@heroui/react";
import { LangToggle } from "@/components/LangToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/context/I18nContext";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { API_BASE_URL, BASE_URL } from "@/utils/config";
import {
  adminUserApiKeyGraphqlApi,
} from "@/api/graphql";
import { PagedTableShell, usePagedList } from "@/components/PagedTable";
import {
  clearSsoLoginFlag,
  isSsoLogin,
  silentAdfsLogout,
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
  hasApiKey: boolean; apiKeyMasked?: string | null;
  createdAt?: string | null; updatedAt?: string | null;
}
interface SystemModel {
  id: number; name: string; provider: string; baseUrl: string;
  modelType: string; isDefault: boolean;
  enabled: boolean; sortOrder: number;
}
interface AdminUsage {
  userId: number; email: string; displayName?: string | null;
  systemModelQuotaUsd: number | null;
  monthCostUsd: number; monthRequests: number; totalCostUsd: number;
}
interface ModelPrice {
  id: number; modelKey: string;
  inputPricePer1m: number; outputPricePer1m: number;
  enabled: boolean; updatedAt?: string | null;
}

type Tab = "models" | "users" | "billing" | "prices";
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
      // SSO 登录的用户：先本地清理并直接回到首页，再由隐藏 iframe
      // 后台静默终止 ADFS 会话（不经过 sts.cuhk.edu.cn 中转页）；
      // 密码登录的用户：本地清理后直接回到首页
      router.push("/");
      if (ssoSession) {
        silentAdfsLogout();
      }
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: "models", label: t("admin.tabModels") },
    { key: "users", label: t("admin.tabUsers") },
    { key: "billing", label: t("admin.tabBilling") },
    { key: "prices", label: t("admin.tabPrices") },
  ];

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden"
      style={{
        height: "100dvh",
        background: "var(--bg)",
        color: "var(--fg1)",
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between"
        style={{
          padding: "0 var(--wb-pad-x, 24px)",
          height: "var(--wb-nav-h, 48px)",
          minHeight: 44,
          borderBottom: "0.5px solid var(--divider)",
          background: "var(--surface-1)",
        }}
      >
        <span style={{ fontSize: "calc(15px * var(--wb-type, 1))", fontWeight: 600 }}>
          {t("admin.headerTitle")}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <LangToggle />
          <ThemeToggle />
          <Button size="sm" variant="ghost" onPress={handleLogout} style={{ fontSize: 13 }}>
            {t("admin.logout")}
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="flex shrink-0"
        style={{
          gap: 0,
          borderBottom: "0.5px solid var(--divider)",
          paddingLeft: "var(--wb-pad-x, 24px)",
          paddingRight: "var(--wb-pad-x, 24px)",
        }}
      >
        {tabs.map((tabItem) => (
          <button
            key={tabItem.key}
            onClick={() => {
              setTab(tabItem.key);
              setFeedback(null);
            }}
            style={{
              padding: "10px 20px",
              fontSize: "calc(13px * var(--wb-type, 1))",
              fontWeight: tab === tabItem.key ? 600 : 500,
              color: tab === tabItem.key ? "var(--fg1)" : "var(--fg3)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              borderBottom:
                tab === tabItem.key
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
              borderRadius: "8px 8px 0 0",
              transition:
                "color 180ms ease, border-color 180ms ease, background-color 180ms ease",
            }}
            onMouseEnter={(e) => {
              if (tab !== tabItem.key)
                e.currentTarget.style.backgroundColor = "var(--hover-bg)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* Feedback */}
      {feedback && (
        <div
          style={{
            margin: "12px var(--wb-pad-x, 24px)",
            padding: "8px 12px",
            borderRadius: 10,
            fontSize: 13,
            background:
              feedback.kind === "ok" ? "var(--badge-bg)" : "var(--error-bg)",
            border: `0.5px solid ${
              feedback.kind === "ok"
                ? "var(--divider-strong)"
                : "var(--error-border)"
            }`,
            color: feedback.kind === "ok" ? "var(--fg1)" : "var(--error)",
            boxShadow: "var(--shadow-xs)",
            flexShrink: 0,
          }}
        >
          {feedback.text}
        </div>
      )}

      {/* Tab content — 可滚动，适配矮屏 */}
      <div
        className="min-h-0 flex-1 overflow-auto"
        style={{
          padding: "var(--wb-pad-y, 16px) var(--wb-pad-x, 24px)",
        }}
      >
        {tab === "models" && <SystemModelsTab onFeedback={setFeedback} />}
        {tab === "users" && <UsersTab onFeedback={setFeedback} />}
        {tab === "billing" && <BillingTab onFeedback={setFeedback} />}
        {tab === "prices" && <ModelPricesTab onFeedback={setFeedback} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 1: System Models Management
// ════════════════════════════════════════════════════════════

function SystemModelsTab({ onFeedback }: { onFeedback: (f: Feedback) => void }) {
  const { t } = useI18n();
  const { handleProps: dragHandleProps } = useDraggableDialog();
  const [models, setModels] = useState<SystemModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<SystemModel | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gql<{ systemModels: { success: boolean; models: SystemModel[] } }>(
        `query { systemModels { success models { id name provider baseUrl modelType isDefault enabled sortOrder } } }`,
      );
      setModels(data.systemModels.models);
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, [onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  // 【分页】每页 16 条 + 滚动容器（见 PagedTable.tsx）
  const pager = usePagedList(models);

  const openAdd = () => {
    setEditing({ id: 0, name: "", provider: "", baseUrl: "", modelType: "external", isDefault: false, enabled: true, sortOrder: 0 });
    setIsModalOpen(true);
  };
  const openEdit = (m: SystemModel) => { setEditing(m); setIsModalOpen(true); };

  const handleSave = async () => {
    if (!editing) return;
    if (!editing.name || !editing.provider || !editing.baseUrl) {
      onFeedback({ kind: "err", text: t("admin.models.errorAllFieldsRequired") });
      return;
    }
    try {
      await gql(
        `mutation($input: SystemModelInput!) { saveSystemModel(input: $input) { success message } }`,
        { input: { id: editing.id || null, name: editing.name, provider: editing.provider, baseUrl: editing.baseUrl, modelType: editing.modelType, isDefault: editing.isDefault, enabled: editing.enabled, sortOrder: editing.sortOrder, testConnection: false } },
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

      <PagedTableShell
        pagedRows={pager.paged}
        page={pager.page}
        setPage={pager.setPage}
        pageCount={pager.pageCount}
        total={pager.total}
        colCount={6}
        emptyText={t("admin.models.empty")}
      >
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colName")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colProvider")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colType")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colDefault")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.models.colEnabled")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {pager.paged.map((m) => (
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
        </tbody>
      </PagedTableShell>

      {/* Edit/Add Modal */}
      {editing && (
        <Modal.Backdrop isOpen={isModalOpen} onOpenChange={(o) => !o && setIsModalOpen(false)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[520px]">
              <Modal.CloseTrigger />
              <Modal.Header {...dragHandleProps}><Modal.Heading>{editing.id ? t("admin.models.editModelTitle") : t("admin.models.addModelTitle")}</Modal.Heading></Modal.Header>
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
  // 配额 / 重置密码两个弹窗各自独立的拖拽状态
  const { handleProps: quotaDragHandleProps } = useDraggableDialog();
  const { handleProps: resetDragHandleProps } = useDraggableDialog();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [quotaModal, setQuotaModal] = useState<{ userId: number; email: string } | null>(null);
  const [quotaValue, setQuotaValue] = useState("");
  const [resetModal, setResetModal] = useState<AdminUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [apiKeyModal, setApiKeyModal] = useState<AdminUser | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gql<{ listUsers: { success: boolean; users: AdminUser[] } }>(
        `query { listUsers { success users { id email displayName isActive isAdmin role hasApiKey apiKeyMasked createdAt updatedAt } } }`,
      );
      setUsers(data.listUsers.users);
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, [onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  // 【分页】每页 16 条 + 滚动容器（见 PagedTable.tsx）
  const pager = usePagedList(users);

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

      <PagedTableShell
        pagedRows={pager.paged}
        page={pager.page}
        setPage={pager.setPage}
        pageCount={pager.pageCount}
        total={pager.total}
        colCount={8}
        emptyText={t("admin.users.empty")}
      >
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colId")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colEmail")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colName")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colActive")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colRole")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colAdmin")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.users.colApiKey")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {pager.paged.map((u) => (
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
              <td style={{ padding: "8px 12px", fontSize: 12, color: u.hasApiKey ? "var(--fg2)" : "var(--fg4)", whiteSpace: "nowrap" }}>
                {u.hasApiKey ? (u.apiKeyMasked || t("admin.users.configured")) : t("admin.users.apiKeyNotSet")}
              </td>
              <td style={{ padding: "8px 12px" }}>
                <Button size="sm" variant="ghost" onPress={() => { setQuotaModal({ userId: u.id, email: u.email }); setQuotaValue(""); }}>{t("admin.users.setQuota")}</Button>
                <Button size="sm" variant="ghost" onPress={() => { setResetModal(u); setNewPassword(""); }}>{t("admin.users.resetPassword")}</Button>
                <Button size="sm" variant="ghost" onPress={() => setApiKeyModal(u)}>{t("admin.users.modelKeys")}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </PagedTableShell>

      {/* Quota Modal */}
      {quotaModal && (
        <Modal.Backdrop isOpen onOpenChange={(o) => !o && setQuotaModal(null)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[420px]">
              <Modal.CloseTrigger />
              <Modal.Header {...quotaDragHandleProps}><Modal.Heading>{t("admin.users.quotaModalTitle", { email: quotaModal.email })}</Modal.Heading></Modal.Header>
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
              <Modal.Header {...resetDragHandleProps}><Modal.Heading>{t("admin.users.resetPasswordModalTitle", { email: resetModal.email })}</Modal.Heading></Modal.Header>
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

      {/* Personal API-Key Modal */}
      {apiKeyModal && (
        <ApiKeyModal
          user={apiKeyModal}
          onClose={() => setApiKeyModal(null)}
          onFeedback={onFeedback}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// API-Key Modal — 管理员为指定用户设置/清除个人 API-Key（users.api_key）
// ════════════════════════════════════════════════════════════

function ApiKeyModal({
  user,
  onClose,
  onFeedback,
}: {
  user: AdminUser;
  onClose: () => void;
  onFeedback: (f: Feedback) => void;
}) {
  const { t } = useI18n();
  const { handleProps: dragHandleProps } = useDraggableDialog();
  const [apiKeyValue, setApiKeyValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const val = apiKeyValue.trim();
    setSaving(true);
    try {
      const r = await adminUserApiKeyGraphqlApi.adminSetUserApiKey({
        userId: user.id,
        apiKey: val,
      });
      if (r.adminSetUserApiKey.success) {
        onFeedback({
          kind: "ok",
          text: val
            ? t("admin.users.feedbackApiKeySaved", { email: user.email })
            : t("admin.users.feedbackApiKeyCleared", { email: user.email }),
        });
        onClose();
      } else {
        onFeedback({ kind: "err", text: r.adminSetUserApiKey.message });
      }
    } catch (e) {
      onFeedback({ kind: "err", text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal.Backdrop isOpen onOpenChange={(o) => !o && onClose()}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[460px]">
          <Modal.CloseTrigger />
          <Modal.Header {...dragHandleProps}>
            <Modal.Heading>{t("admin.users.apiKeyModalTitle", { email: user.email })}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--fg2)" }}>{t("admin.users.apiKeyCurrent")}</span>
                <span style={{ fontSize: 13, color: user.hasApiKey ? "var(--fg1)" : "var(--fg4)", fontWeight: 600 }}>
                  {user.hasApiKey ? (user.apiKeyMasked || t("admin.users.configured")) : t("admin.users.apiKeyNotSet")}
                </span>
              </div>
              <TextField fullWidth className="flex flex-col gap-1.5">
                <Label className="text-sm font-medium">{t("admin.users.modelKeys")}</Label>
                <Input
                  type="password"
                  placeholder={t("admin.users.apiKeyPlaceholder")}
                  value={apiKeyValue}
                  onChange={(e) => setApiKeyValue(e.target.value)}
                />
              </TextField>
              <p style={{ fontSize: 12, color: "var(--fg4)" }}>{t("admin.users.apiKeyHelpText")}</p>
            </div>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="ghost" onPress={onClose}>{t("admin.close")}</Button>
            <Button
              variant="primary"
              isDisabled={saving}
              onPress={handleSave}
            >
              {saving ? t("admin.saving") : t("admin.save")}
            </Button>
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

  // 【分页】明细表每页 16 条；汇总卡片与柱状图仍基于全量 data 计算
  const pager = usePagedList(data);

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
      <PagedTableShell
        pagedRows={pager.paged}
        page={pager.page}
        setPage={pager.setPage}
        pageCount={pager.pageCount}
        total={pager.total}
        colCount={6}
        emptyText={t("admin.billing.noUsageData")}
      >
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colUser")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colQuota")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colMonthCost")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colMonthRequests")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colTotal", { days })}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.billing.colUsage")}</th>
          </tr>
        </thead>
        <tbody>
          {pager.paged.map((u) => {
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
      </PagedTableShell>
    </div>
  );
}

// ════════════════════════════════════════════════════════════
// Tab 4: Model Prices Management (model_prices, USD / 1M tokens)
// ════════════════════════════════════════════════════════════

function ModelPricesTab({ onFeedback }: { onFeedback: (f: Feedback) => void }) {
  const { t } = useI18n();
  const { handleProps: dragHandleProps } = useDraggableDialog();
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<ModelPrice | null>(null);
  const [inputPriceDraft, setInputPriceDraft] = useState("");
  const [outputPriceDraft, setOutputPriceDraft] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await gql<{ modelPrices: { success: boolean; message: string; prices: ModelPrice[] } }>(
        `query { modelPrices { success message prices { id modelKey inputPricePer1m outputPricePer1m enabled updatedAt } } }`,
      );
      if (!data.modelPrices.success) throw new Error(data.modelPrices.message);
      setPrices(data.modelPrices.prices);
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
    finally { setLoading(false); }
  }, [onFeedback]);

  useEffect(() => { refresh(); }, [refresh]);

  // 【分页】每页 16 条 + 滚动容器（见 PagedTable.tsx）
  const pager = usePagedList(prices);

  const openAdd = () => {
    setEditing({ id: 0, modelKey: "", inputPricePer1m: 0, outputPricePer1m: 0, enabled: true });
    setInputPriceDraft("");
    setOutputPriceDraft("");
    setIsModalOpen(true);
  };
  const openEdit = (p: ModelPrice) => {
    setEditing(p);
    setInputPriceDraft(String(p.inputPricePer1m));
    setOutputPriceDraft(String(p.outputPricePer1m));
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!editing) return;
    const modelKey = editing.modelKey.trim().toLowerCase();
    const inputPrice = Number(inputPriceDraft);
    const outputPrice = Number(outputPriceDraft);
    if (!modelKey) {
      onFeedback({ kind: "err", text: t("admin.prices.errorKeyRequired") });
      return;
    }
    if (Number.isNaN(inputPrice) || inputPrice < 0 || Number.isNaN(outputPrice) || outputPrice < 0) {
      onFeedback({ kind: "err", text: t("admin.prices.errorPriceInvalid") });
      return;
    }
    try {
      const r = await gql<{ saveModelPrice: { success: boolean; message: string } }>(
        `mutation($input: ModelPriceInput!) { saveModelPrice(input: $input) { success message } }`,
        { input: { id: editing.id || null, modelKey, inputPricePer1m: inputPrice, outputPricePer1m: outputPrice, enabled: editing.enabled } },
      );
      if (!r.saveModelPrice.success) throw new Error(r.saveModelPrice.message);
      onFeedback({ kind: "ok", text: t("admin.prices.saved") });
      setIsModalOpen(false);
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t("admin.prices.confirmDelete"))) return;
    try {
      const r = await gql<{ deleteModelPrice: { success: boolean; message: string } }>(
        `mutation($priceId: Int!) { deleteModelPrice(priceId: $priceId) { success message } }`,
        { priceId: id },
      );
      if (!r.deleteModelPrice.success) throw new Error(r.deleteModelPrice.message);
      onFeedback({ kind: "ok", text: t("admin.prices.deleted") });
      refresh();
    } catch (e) { onFeedback({ kind: "err", text: (e as Error).message }); }
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t("admin.prices.sectionTitle", { count: prices.length })}</span>
          <p style={{ fontSize: 12, color: "var(--fg4)", margin: "4px 0 0" }}>{t("admin.prices.helpText")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" isDisabled={loading} onPress={refresh}>{t("admin.refresh")}</Button>
          <Button size="sm" variant="primary" onPress={openAdd}>{t("admin.prices.addPrice")}</Button>
        </div>
      </div>

      <PagedTableShell
        pagedRows={pager.paged}
        page={pager.page}
        setPage={pager.setPage}
        pageCount={pager.pageCount}
        total={pager.total}
        colCount={5}
        emptyText={t("admin.prices.empty")}
      >
        <thead>
          <tr style={{ borderBottom: "0.5px solid var(--divider)", background: "var(--surface-2)", position: "sticky", top: 0, zIndex: 1 }}>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.prices.colModelKey")}</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>{t("admin.prices.colInputPrice")}</th>
            <th style={{ padding: "10px 12px", textAlign: "right" }}>{t("admin.prices.colOutputPrice")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.prices.colEnabled")}</th>
            <th style={{ padding: "10px 12px", textAlign: "left" }}>{t("admin.colActions")}</th>
          </tr>
        </thead>
        <tbody>
          {pager.paged.map((p) => (
            <tr key={p.id} style={{ borderBottom: "0.5px solid var(--divider)" }}>
              <td style={{ padding: "8px 12px", fontWeight: 600, fontFamily: "monospace" }}>{p.modelKey}</td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>${p.inputPricePer1m.toFixed(4)}</td>
              <td style={{ padding: "8px 12px", textAlign: "right" }}>${p.outputPricePer1m.toFixed(4)}</td>
              <td style={{ padding: "8px 12px" }}>{p.enabled ? "✓" : "✗"}</td>
              <td style={{ padding: "8px 12px" }}>
                <Button size="sm" variant="ghost" onPress={() => openEdit(p)}>{t("admin.edit")}</Button>
                <Button size="sm" variant="ghost" onPress={() => handleDelete(p.id)}>{t("admin.delete")}</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </PagedTableShell>

      {/* Edit/Add Modal */}
      {editing && (
        <Modal.Backdrop isOpen={isModalOpen} onOpenChange={(o) => !o && setIsModalOpen(false)}>
          <Modal.Container>
            <Modal.Dialog className="sm:max-w-[480px]">
              <Modal.CloseTrigger />
              <Modal.Header {...dragHandleProps}><Modal.Heading>{editing.id ? t("admin.prices.editTitle") : t("admin.prices.addTitle")}</Modal.Heading></Modal.Header>
              <Modal.Body>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.prices.fieldModelKey")}</Label>
                    <Input value={editing.modelKey} onChange={(e) => setEditing({ ...editing, modelKey: e.target.value })} placeholder={t("admin.prices.fieldModelKeyPlaceholder")} />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.prices.fieldInputPrice")}</Label>
                    <Input type="number" min="0" step="0.01" value={inputPriceDraft} onChange={(e) => setInputPriceDraft(e.target.value)} placeholder="0.00" />
                  </TextField>
                  <TextField fullWidth className="flex flex-col gap-1.5">
                    <Label className="text-sm font-medium">{t("admin.prices.fieldOutputPrice")}</Label>
                    <Input type="number" min="0" step="0.01" value={outputPriceDraft} onChange={(e) => setOutputPriceDraft(e.target.value)} placeholder="0.00" />
                  </TextField>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={editing.enabled} onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })} />
                    {t("admin.prices.fieldEnabled")}
                  </label>
                  <p style={{ fontSize: 12, color: "var(--fg4)", margin: 0 }}>{t("admin.prices.matchHelpText")}</p>
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
