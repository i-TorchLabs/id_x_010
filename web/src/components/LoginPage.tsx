"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { ThemeToggle } from "./ThemeToggle";
import LeftPanel from "./LeftPanel";
import LoginForm from "./LoginForm";
import { userGraphqlApi } from "@/api/graphql";
import { redirectToAdfsAuthorize } from "@/utils/sso";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginMode = "user" | "admin";

interface LoginPageProps {
    /** 登录场景：user=普通用户登录页，admin=管理后台登录页 */
    mode?: LoginMode;
}

export default function LoginPage({ mode = "user" }: LoginPageProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { theme } = useTheme();
    const isDark = theme === "dark";
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isPasswordFocused, setIsPasswordFocused] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [errorMsg, setErrorMsg] = useState("");
    const [emailError, setEmailError] = useState(false);
    const [passwordError, setPasswordError] = useState(false);

    const isAdmin = mode === "admin";
    const redirectTo = isAdmin ? "/admin" : "/f/home";

    // SSO 回调失败时通过 ?error= 携带原因回显到登录页
    useEffect(() => {
        const err = searchParams.get("error");
        if (err) {
            const map: Record<string, string> = {
                sso_missing_code: "SSO callback missing authorization code",
                sso_state_mismatch: "SSO state validation failed (possible CSRF attack)",
            };
            setErrorMsg(map[err] ?? err);
        }
    }, [searchParams]);

    // 已登录且角色匹配时直接跳转目标页，避免重复登录
    useEffect(() => {
        if (typeof window === "undefined") return;
        const token = localStorage.getItem("token");
        const userRaw = localStorage.getItem("user");
        if (!token || !userRaw) return;
        try {
            const u = JSON.parse(userRaw);
            const role: string = u?.role ?? (u?.is_admin ? "admin" : "user");
            if (isAdmin && role === "admin") {
                router.replace("/admin");
            } else if (!isAdmin && role === "user") {
                router.replace("/f/home");
            }
        } catch {
            // 本地 user 损坏，忽略让其重新登录
        }
    }, [isAdmin, router]);

    const handleSsoClick = useCallback(() => {
        setErrorMsg("");
        redirectToAdfsAuthorize();
    }, []);

    const onSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            setEmailError(false);
            setPasswordError(false);
            setErrorMsg("");

            const cleanEmail = email.trim();

            if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
                setEmailError(true);
                setErrorMsg("Please enter a valid email address.");
                return;
            }

            if (!password || password.length < 6) {
                setPasswordError(true);
                setErrorMsg("Password must be at least 6 characters.");
                return;
            }

            setIsSubmitting(true);

            try {
                const result = await userGraphqlApi.login({
                    email: cleanEmail,
                    password: password,
                    // 管理后台登录页仅允许管理员，用户登录页仅允许普通用户
                    role: isAdmin ? "admin" : "user",
                });

                console.log("Login result:", result);

                if (!result.login.success) {
                    setErrorMsg(result.login.message || "Invalid email or password");
                    return;
                }

                if (!result.login.user) {
                    setErrorMsg("Sign-in failed, please try again");
                    return;
                }

                if (typeof window !== "undefined") {
                    localStorage.setItem("token", result.login.token || "");
                    localStorage.setItem(
                        "user",
                        JSON.stringify(result.login.user),
                    );
                }

                router.push(redirectTo);
            } catch (error: any) {
                console.error("Login failed:", error);
                setErrorMsg(error.message || "Invalid email or password, please try again");
            } finally {
                setIsSubmitting(false);
            }
        },
        [email, password, isAdmin, redirectTo],
    );

    return (
        <div className="h-screen relative overflow-hidden">
            <div className="absolute top-4 right-4 z-50">
                <ThemeToggle />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 h-full">
                <LeftPanel
                    isTyping={isTyping}
                    isPasswordFocused={isPasswordFocused}
                    showPassword={showPassword}
                    passwordLength={password.length}
                    isDark={isDark}
                />

                <div
                    className={`flex items-center justify-center p-8 md:p-10 ${isDark ? "bg-[#000000]" : "bg-[#f5f5f7]"}`}
                >
                    <LoginForm
                        email={email}
                        setEmail={setEmail}
                        password={password}
                        setPassword={setPassword}
                        showPassword={showPassword}
                        setShowPassword={setShowPassword}
                        isTyping={isTyping}
                        setIsTyping={setIsTyping}
                        isPasswordFocused={isPasswordFocused}
                        setIsPasswordFocused={setIsPasswordFocused}
                        isSubmitting={isSubmitting}
                        onSubmit={onSubmit}
                        errorMsg={errorMsg}
                        emailError={emailError}
                        passwordError={passwordError}
                        onSsoClick={handleSsoClick}
                        isAdmin={isAdmin}
                    />
                </div>
            </div>
        </div>
    );
}
