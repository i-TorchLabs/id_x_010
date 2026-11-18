import { Suspense } from "react";
import SsoLoginPage from "@/components/SsoLoginPage";

export default function SsoLoginRoute() {
  // useSearchParams 必须在 Suspense 边界内，否则 build 时会要求
  // 整页降级为客户端渲染；此处仅包一层即可保持静态壳。（同 user-login 页）
  return (
    <Suspense fallback={null}>
      <SsoLoginPage />
    </Suspense>
  );
}
