"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Alert, Button } from "@heroui/react";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { AuthSplitShell } from "./AuthSplitShell";
import { redirectToAdfsAuthorize } from "@/utils/sso";

/**
 * SSO 专用登录页（/f/010/sso-login）：
 * 仅保留 SSO 单点登录入口 —— 不提供账号密码登录、注册与管理员登录入口。
 */
export default function SsoLoginPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { theme } = useTheme();
    const { t } = useI18n();
    const isDark = theme === "dark";
    const [errorMsg, setErrorMsg] = useState("");

    useEffect(() => {
        const err = searchParams.get("error");
        if (err) {
            const map: Record<string, string> = {
                sso_missing_code: t("login.errorSsoMissingCode"),
                sso_state_mismatch: t("login.errorSsoStateMismatch"),
            };
            setErrorMsg(map[err] ?? err);
        }
    }, [searchParams, t]);

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
        <AuthSplitShell
            preset="sso"
            left={{
                isTyping: false,
                isPasswordFocused: false,
                showPassword: false,
                passwordLength: 0,
                isDark,
            }}
        >
            {(m) => (
                <>
                    <div
                        className="flex justify-center"
                        style={{ marginBottom: m.gapLogo }}
                    >
                        <div
                            className="flex items-center justify-center"
                            style={{
                                width: m.logoBox,
                                height: m.logoBox,
                                borderRadius: m.logoRadius,
                            }}
                        >
                            <Image
                                src="/favicon.ico"
                                alt="Logo"
                                width={m.logoIcon}
                                height={m.logoIcon}
                                style={{
                                    width: m.logoIcon,
                                    height: m.logoIcon,
                                }}
                                priority
                            />
                        </div>
                    </div>

                    <div
                        className="text-center"
                        style={{ marginBottom: m.gapHeader }}
                    >
                        <h1
                            className="font-semibold text-foreground"
                            style={{
                                fontSize: m.titleSize,
                                lineHeight: 1.12,
                                letterSpacing: `${m.trackingTitle}px`,
                                marginBottom: m.gapTitle,
                            }}
                        >
                            {t("login.welcomeTitle")}
                        </h1>
                        <p
                            className="text-muted"
                            style={{
                                fontSize: m.subSize,
                                lineHeight: 1.45,
                            }}
                        >
                            {t("login.ssoSubtitle")}
                        </p>
                    </div>

                    {errorMsg && (
                        <Alert
                            status="danger"
                            style={{ marginBottom: m.gapAlert }}
                        >
                            <Alert.Indicator />
                            <Alert.Content>
                                <Alert.Description>{errorMsg}</Alert.Description>
                            </Alert.Content>
                        </Alert>
                    )}

                    <Button
                        type="button"
                        fullWidth
                        variant="primary"
                        size="lg"
                        className="rounded-full font-semibold"
                        style={{
                            minHeight: m.btnMinH,
                            fontSize: m.btnFont,
                            letterSpacing: `${m.trackingBtn}px`,
                        }}
                        onPress={handleSsoClick}
                    >
                        {t("login.signInWithSso")}
                    </Button>
                </>
            )}
        </AuthSplitShell>
    );
}
