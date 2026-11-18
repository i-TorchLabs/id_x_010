"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Alert, Button } from "@heroui/react";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { ThemeToggle } from "./ThemeToggle";
import { LangToggle } from "./LangToggle";
import LeftPanel from "./LeftPanel";
import { redirectToAdfsAuthorize } from "@/utils/sso";

/**
 * SSO 专用登录页（/f/010/sso-login）：
 * 仅保留 SSO 单点登录入口 —— 不提供账号密码登录、注册与管理员登录入口。
 * 基于 /user-login（LoginPage + LoginForm）裁剪而来。
 */
export default function SsoLoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { theme } = useTheme();
    const { t } = useI18n();
    const isDark = theme === "dark";
    const [errorMsg, setErrorMsg] = useState("");

    // SSO 回调失败时通过 ?error= 携带原因回显到登录页（同 user-login）
    useEffect(() => {
        const err = searchParams.get("error");
        if (err) {
            const map: Record<string, string> = {
                sso_missing_code: t("login.errorSsoMissingCode"),
                sso_state_mismatch: t("login.errorSsoStateMismatch"),
            };
            setErrorMsg(map[err] ?? err);
        }
    }, [searchParams]);

    // 已登录则按角色直接跳转目标页，避免重复登录
    // （SSO 亦可建立 admin 会话，故与 oauth2 回调页一致按角色分流）
    useEffect(() => {
        if (typeof window === "undefined") return;
        const token = localStorage.getItem("token");
        const userRaw = localStorage.getItem("user");
        if (!token || !userRaw) return;
        try {
            const u = JSON.parse(userRaw);
            const hasAdmin = !!u?.role
                ? u.role.split(",").map((r: string) => r.trim()).includes("admin")
                : !!u?.is_admin;
            router.replace(hasAdmin ? "/f/010/admin-home" : "/f/010/user-home");
        } catch {
            // 本地 user 损坏，忽略让其重新登录
        }
    }, [router]);

    const handleSsoClick = useCallback(() => {
        setErrorMsg("");
        redirectToAdfsAuthorize();
    }, []);

    return (
        <div className="h-screen relative overflow-hidden">
            <div className="absolute top-4 right-4 z-50 flex items-center gap-1">
                <LangToggle />
                <ThemeToggle />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 h-full">
                <LeftPanel
                    isTyping={false}
                    isPasswordFocused={false}
                    showPassword={false}
                    passwordLength={0}
                    isDark={isDark}
                />

                <div
                    className="flex items-center justify-center p-8 md:p-10 theme-transition"
                    style={{ background: "var(--bg)" }}
                >
                    <div className="w-full max-w-100">
                        {/* Logo */}
                        <div className="flex justify-center mb-6">
                            <div
                                className="flex items-center justify-center"
                                style={{
                                    width: 56,
                                    height: 56,
                                    borderRadius: "16px",
                                }}
                            >
                                <Image
                                    src="/favicon.ico"
                                    alt="Logo"
                                    width={28}
                                    height={28}
                                    className="w-7 h-7"
                                    priority
                                />
                            </div>
                        </div>

                        {/* Header */}
                        <div className="text-center mb-9">
                            <h1 className="text-[28px] font-semibold mb-1.5 leading-[1.14] tracking-[-0.28px] text-foreground">
                                {t("login.welcomeTitle")}
                            </h1>
                            <p className="text-[14px] text-muted">
                                {t("login.ssoSubtitle")}
                            </p>
                        </div>

                        {/* Error Message */}
                        {errorMsg && (
                            <Alert status="danger" className="mb-4">
                                <Alert.Indicator />
                                <Alert.Content>
                                    <Alert.Description>{errorMsg}</Alert.Description>
                                </Alert.Content>
                            </Alert>
                        )}

                        {/* SSO 唯一登录入口 */}
                        <Button
                            type="button"
                            fullWidth
                            variant="primary"
                            size="lg"
                            className="rounded-full font-semibold"
                            onPress={handleSsoClick}
                        >
                            {t("login.signInWithSso")}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}
