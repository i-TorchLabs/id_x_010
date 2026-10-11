"use client";

/**
 * /admin 路由入口（TASK-013）
 *
 * 客户端路由守卫：未登录跳 /f/admin-login，非 admin 跳 /。
 * 服务端 require_admin 在每个 mutation 内同样守护，绕过客户端会被 403。
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
      // role 为权威字段，is_admin 兼容兜底
      const role: string =
        user.role ?? (user.is_admin ? "admin" : "user");
      if (role !== "admin") {
        // 普通用户重定向到首页
        router.replace("/");
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
