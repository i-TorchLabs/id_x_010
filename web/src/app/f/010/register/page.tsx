import { redirect } from "next/navigation";

/**
 * /f/010/register 已废弃：注册页迁至 /f/010/user-register。
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
  redirect(qs ? `/f/010/user-register?${qs}` : "/f/010/user-register");
}
