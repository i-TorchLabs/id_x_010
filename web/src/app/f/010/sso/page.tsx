"use client";

import { useEffect, useRef } from "react";
import { redirectToAdfsAuthorize } from "@/utils/sso";

/**
 * SSO 统一入口：
 * 进入本页即生成 CSRF state 并 302 到 ADFS 授权页，
 * 授权完成后回调 /f/010/oauth2 完成 code → session 换取。
 */
export default function SsoEntryPage() {
  // StrictMode 下 effect 双执行会生成两个 state，暂存值与跳转 URL 可能不一致，
  // 导致回调页 state 校验失败；用 ref 保证只发起一次授权跳转。
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;
    redirectToAdfsAuthorize();
  }, []);

  return (
    <div>
      <p>Redirecting to CUHK SSO...</p>
    </div>
  );
}
