import { redirect } from "next/navigation";

/**
 * /f/010/login 已废弃：登录统一走 SSO 后，本路由重定向到 SSO 登录页。
 * 仍需账号密码登录（含管理员）请访问 /f/010/user-login 与 /f/010/admin-login。
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
  redirect(qs ? `/f/010/sso-login?${qs}` : "/f/010/sso-login");
}
