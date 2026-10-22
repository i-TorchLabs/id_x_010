"use client";

/**
 * ApprovalCenter（TASK-012）
 *
 * 连接 WS /ws/approval 实时接收审批事件，同时调 listApprovalTasks 查询
 * 兜底历史 pending 任务（WS 历史消息不补发）。
 *
 * 已知限制（与后端 x_ws.py 一致）：多副本部署时仅本副本的事件可达。
 *
 * HeroUI v3 API：仅用 Button（避免 Card v3 命名空间复杂度，用原生 div 替代）。
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { Button } from "@heroui/react";
import { API_BASE_URL, BASE_URL } from "@/utils/config";

interface ApprovalTask {
  id: string;
  conversation_id: string;
  sql: string;
  sql_meaning?: string | null;
  question: string;
  user_id?: number | null;
  status: string;
  created_at?: string | null;
  timeout_at?: string | null;
}

interface WsEvent {
  type: "approval_event";
  task_id: string;
  event: "created" | "approved" | "rejected" | "cancelled" | "timeout";
  payload: Partial<ApprovalTask> & { conversation_id: string };
  ts: string;
}

/** 调用 GraphQL listApprovalTasks 兜底拉历史 pending 任务 */
async function fetchPendingTasks(): Promise<ApprovalTask[]> {
  try {
    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : null;
    const url = API_BASE_URL || BASE_URL;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        query: `query { listApprovalTasks { success message tasks { id conversation_id sql sql_meaning question status created_at timeout_at user_id } } }`,
      }),
    });
    const json = await res.json();
    return json?.data?.listApprovalTasks?.tasks || [];
  } catch (e) {
    console.error("fetchPendingTasks failed", e);
    return [];
  }
}

/** 调用 sql_approval mutation 审批 */
async function callSqlApproval(params: {
  conversation_id: string;
  sql: string;
  action: "approve" | "reject" | "cancel";
  question: string;
}) {
  const token =
    typeof window !== "undefined" ? localStorage.getItem("token") : null;
  const url = API_BASE_URL || BASE_URL;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      query: `
        mutation($conversation_id: String!, $sql: String!, $action: String!, $question: String!) {
          sqlApproval(conversationId: $conversation_id, sql: $sql, action: $action, question: $question) {
                type
                content
                sql
            }
        }`,
      variables: params,
    }),
  });
  return res.json();
}

export function ApprovalCenter() {
  const [tasks, setTasks] = useState<ApprovalTask[]>([]);
  const [connected, setConnected] = useState(false);
  const [processing, setProcessing] = useState<Record<string, boolean>>({});
  const wsRef = useRef<WebSocket | null>(null);

  const refresh = useCallback(async () => {
    const list = await fetchPendingTasks();
    setTasks(list.filter((t) => t.status === "pending"));
  }, []);

  useEffect(() => {
    refresh();

    // 连接 WS：优先用 Sec-WebSocket-Protocol 子协议传 token（避免泄漏到 URL/log），
    // 浏览器不支持子协议时降级 query string
    const token =
      typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) return;

    const wsBase = (BASE_URL || "").replace(/^http/, "ws");
    // 用子协议 bearer.<token> 握手；服务端 _select_subprotocol 会回选
    const subprotocol = `bearer.${token}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsBase}/ws/approval`, [subprotocol]);
    } catch {
      // 兼容老浏览器/代理不支持子协议：降级 query string
      ws = new WebSocket(`${wsBase}/ws/approval?token=${encodeURIComponent(token)}`);
    }
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (evt) => {
      try {
        const msg: WsEvent = JSON.parse(evt.data);
        if (msg.type === "approval_event") {
          // 任意事件都触发列表刷新（created 增 / resolved 删 / timeout 删）
          refresh();
        }
      } catch (e) {
        console.warn("WS message parse failed", e);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [refresh]);

  const handleAction = useCallback(
    async (task: ApprovalTask, action: "approve" | "reject" | "cancel") => {
      setProcessing((p) => ({ ...p, [task.id]: true }));
      try {
        await callSqlApproval({
          conversation_id: task.conversation_id,
          sql: task.sql,
          action,
          question: task.question,
        });
        // 立即从列表移除；后端 WS 事件也会触发 refresh
        setTasks((prev) => prev.filter((t) => t.id !== task.id));
      } catch (e) {
        console.error("handleAction failed", e);
      } finally {
        setProcessing((p) => ({ ...p, [task.id]: false }));
      }
    },
    [],
  );

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
          Approval Center
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: connected ? "var(--accent)" : "var(--error)",
              boxShadow: connected ? "0 0 0 3px var(--badge-bg)" : "0 0 0 3px var(--error-bg)",
              display: "inline-block",
              transition: "background-color 200ms ease, box-shadow 200ms ease",
            }}
          />
          <span style={{ color: "var(--fg3)" }}>
            {connected ? "WS Connected" : "WS Disconnected"}
          </span>
          <Button size="sm" variant="ghost" onClick={refresh}>
            Refresh
          </Button>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: "var(--fg3)",
            background: "var(--surface-1)",
            border: "0.5px solid var(--divider)",
            borderRadius: 12,
          }}
        >
          No pending approval tasks
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {tasks.map((task) => (
            <motion.div
              key={task.id}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div
                style={{
                  background: "var(--surface-2)",
                  border: "0.5px solid var(--divider)",
                  borderRadius: 14,
                  padding: 16,
                  boxShadow: "var(--shadow-inset), var(--shadow-sm)",
                }}
              >
                  <div style={{ fontSize: 12, color: "var(--fg3)", marginBottom: 6 }}>
                    Conversation {task.conversation_id.slice(0, 8)}…
                    {task.timeout_at && (
                      <span style={{ marginLeft: 12 }}>
                        Timeout {new Date(task.timeout_at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div style={{ fontWeight: 500, marginBottom: 8 }}>
                    {task.question}
                  </div>
                  {task.sql_meaning && (
                    <div style={{ fontSize: 13, color: "var(--fg2)", marginBottom: 8 }}>
                      {task.sql_meaning}
                    </div>
                  )}
                  <pre
                    style={{
                      background: "var(--surface-1)",
                      border: "0.5px solid var(--divider)",
                      padding: 10,
                      borderRadius: 10,
                      fontSize: 12,
                      overflowX: "auto",
                      margin: 0,
                    }}
                  >
                    {task.sql}
                  </pre>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 12,
                      justifyContent: "flex-end",
                    }}
                  >
                    <Button
                      size="sm"
                      variant="primary"
                      isDisabled={!!processing[task.id]}
                      onClick={() => handleAction(task, "approve")}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      isDisabled={!!processing[task.id]}
                      onClick={() => handleAction(task, "reject")}
                    >
                      Reject
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleAction(task, "cancel")}
                    >
                      Cancel
                    </Button>
                  </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
