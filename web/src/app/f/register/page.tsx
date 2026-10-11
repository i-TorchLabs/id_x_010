import { redirect } from "next/navigation";

/**
 * /f/register 已废弃：注册页迁至 /f/user-register。
 * 保留 query string 透传（如 ?registered=true 等历史参数）。
 */
export default async function RegisterRedirect({
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
  redirect(qs ? `/f/user-register?${qs}` : "/f/user-register");
}
