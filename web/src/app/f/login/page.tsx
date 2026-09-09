import { Suspense } from "react";
import LoginPage from "@/components/LoginPage";

export default function Login() {
  // useSearchParams 必须在 Suspense 边界内，否则 build 时会要求
  // 整页降级为客户端渲染；此处仅包一层即可保持静态壳。
  return (
    <Suspense fallback={null}>
      <LoginPage />
    </Suspense>
  );
}
