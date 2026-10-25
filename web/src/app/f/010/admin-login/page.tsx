import { Suspense } from "react";
import LoginPage from "@/components/LoginPage";

export default function AdminLoginPage() {
  // 管理后台登录页：仅允许含 admin 角色的账号登录，成功后跳转 /f/010/admin-home
  return (
    <Suspense fallback={null}>
      <LoginPage mode="admin" />
    </Suspense>
  );
}
