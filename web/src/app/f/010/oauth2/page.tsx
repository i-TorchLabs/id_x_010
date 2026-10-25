"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { userGraphqlApi } from "@/api/graphql";
import { OAUTH_STATE_KEY, setSsoLoginFlag } from "@/utils/sso";

/**
 * ADFS 授权码授予流回调页：
 * /f/010/oauth2?code=...&state=...
 *
 * 校验 state（防 CSRF）后用 code 调用后端 ssoLogin 换取会话令牌，
 * 成功后写入 localStorage 跳转首页，失败则回到登录页。
 */
export default function OAuthCallbackPage() {
  const router = useRouter();
  // StrictMode 下 effect 会双执行；code 只能兑换一次、state 校验后即销毁，
  // 必须用 ref 保证整个流程只跑一次，否则第二次执行会误报 state_mismatch。
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    // 仅客户端解析 query，避免 useSearchParams 需 Suspense 包裹
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    if (!code) {
      router.replace("/f/010/user-login?error=sso_missing_code");
      return;
    }

    // CSRF 校验：state 必须与授权请求时生成并暂存的一致
    const savedState = sessionStorage.getItem(OAUTH_STATE_KEY);
    if (!savedState || savedState !== state) {
      router.replace("/f/010/user-login?error=sso_state_mismatch");
      return;
    }
    sessionStorage.removeItem(OAUTH_STATE_KEY);

    userGraphqlApi
      .ssoLogin({ code, state })
      .then((result) => {
        const resp = result.ssoLogin;
        if (!resp.success || !resp.token || !resp.user) {
          router.replace(
            `/f/010/user-login?error=${encodeURIComponent(resp.message || "SSO sign-in failed")}`,
          );
          return;
        }
        localStorage.setItem("token", resp.token);
        localStorage.setItem("user", JSON.stringify(resp.user));
        // 标记当前会话由 SSO 建立，登出时一并退出 ADFS
        setSsoLoginFlag();
        // SSO 默认建立普通用户：管理员若经 SSO 登录则按 role 跳转。
        // 用 replace 将回调页移出历史栈，防止"后退"回到已失效的 code 页重跑流程。
        const role: string = resp.user.role ?? "user";
        const hasAdmin = role.split(",").map((r: string) => r.trim()).includes("admin");
        router.replace(hasAdmin ? "/f/010/admin-home" : "/f/010/user-home");
      })
      .catch((error) => {
        console.error("SSO login failed:", error);
        router.replace(
          `/f/010/user-login?error=${encodeURIComponent(error.message || "SSO sign-in failed")}`,
        );
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen items-center justify-center">
      <p>Completing SSO sign-in...</p>
    </div>
  );
}
