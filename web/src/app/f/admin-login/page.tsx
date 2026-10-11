import { Suspense } from "react";
import LoginPage from "@/components/LoginPage";

export default function AdminLoginPage() {
  // 管理后台登录页：仅允许 role=admin 账号登录，成功后跳转 /admin
  return (
    <Suspense fallback={null}>
      <LoginPage mode="admin" />
    </Suspense>
  );
}
