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

export default function LoginPage() {
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

    // SSO 回调失败时通过 ?error= 携带原因回显到登录页
    useEffect(() => {
        const err = searchParams.get("error");
        if (err) {
            const map: Record<string, string> = {
                sso_missing_code: "SSO 回调缺少授权码",
                sso_state_mismatch: "SSO state 校验失败，疑似 CSRF 攻击",
            };
            setErrorMsg(map[err] ?? err);
        }
    }, [searchParams]);

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
                });

                console.log("Login result:", result);

                if (!result.login.success) {
                    setErrorMsg(result.login.message || "邮箱或密码错误");
                    return;
                }

                if (!result.login.user) {
                    setErrorMsg("登录失败，请重试");
                    return;
                }

                if (typeof window !== "undefined") {
                    localStorage.setItem("token", result.login.token || "");
                    localStorage.setItem(
                        "user",
                        JSON.stringify(result.login.user),
                    );
                }

                router.push("/f/home");
            } catch (error: any) {
                console.error("Login failed:", error);
                setErrorMsg(error.message || "邮箱或密码错误，请重试");
            } finally {
                setIsSubmitting(false);
            }
        },
        [email, password],
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
                    />
                </div>
            </div>
        </div>
    );
}
