"use client";

/**
 * /f/admin-home 路由入口（TASK-013）
 *
 * 客户端路由守卫：未登录跳 /f/admin-login，非 admin 跳 /f/user-home。
 * 服务端 require_admin 在每个 mutation 内同样守护，绕过客户端会被 403。
 * role 为多角色字段（逗号分隔），含 admin 角色即可访问。
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AdminPanel } from "@/views/AdminPanel";

interface LocalUser {
  id: number;
  email: string;
  is_admin?: boolean;
  role?: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("token");
    if (!token) {
      router.replace("/f/admin-login");
      return;
    }
    try {
      const user: LocalUser = JSON.parse(localStorage.getItem("user") || "{}");
      if (!user.id) {
        router.replace("/f/admin-login");
        return;
      }
      // role 多角色（逗号分隔）权威，is_admin 兼容兜底
      const hasAdmin = !!user.role
        ? user.role.split(",").map((r: string) => r.trim()).includes("admin")
        : !!user.is_admin;
      if (!hasAdmin) {
        // 普通用户重定向到用户首页
        router.replace("/f/user-home");
        return;
      }
      setReady(true);
    } catch {
      router.replace("/f/admin-login");
    }
  }, [router]);

  if (!ready) {
    return (
      <div style={{ padding: 32, textAlign: "center", color: "var(--fg3)" }}>
        Loading...
      </div>
    );
  }

  return <AdminPanel />;
}
