import { redirect } from "next/navigation";

/**
 * /f/login 已废弃：管理后台登录与用户登录分离后，本路由重定向到用户登录页。
 * 管理后台登录请访问 /f/admin-login。
 *
 * 保留 query string（如 SSO 回调的 ?error=xxx）以便错误信息透传到新登录页。
 */
export default async function LoginRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      Array.isArray(v) ? v.map((x) => [k, x]) : v ? [[k, v]] : [],
    ),
  ).toString();
  redirect(qs ? `/f/user-login?${qs}` : "/f/user-login");
}
