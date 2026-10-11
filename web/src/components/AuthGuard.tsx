"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * 认证守卫组件
 * 检查用户是否已登录，如果未登录则重定向到登录页面
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter();

  useEffect(() => {
    // 检查是否在客户端
    if (typeof window !== "undefined") {
      const token = localStorage.getItem("token");

      // 如果没有 token，重定向到登录页面
      if (!token) {
        router.push("/f/user-login");
        return;
      }

      // 可选：验证 token 是否有效
      // 这里可以调用后端接口验证 token
      validateToken(token);
    }
  }, [router]);

  const validateToken = async (token: string) => {
    try {
      // 可以在这里调用后端接口验证 token
      // 例如：调用 profile 接口检查 token 是否有效
      // 如果验证失败，清除 token 并重定向到登录页面

      // 简单实现：只检查 token 是否存在
      // 如果需要更严格的验证，可以调用后端接口
      const user = localStorage.getItem("user");

      if (!user) {
        // 用户信息不存在，可能 token 无效
        localStorage.removeItem("token");
        router.push("/f/user-login");
      }
    } catch (error) {
      console.error("Token validation failed:", error);
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      router.push("/f/user-login");
    }
  };

  return <>{children}</>;
}
