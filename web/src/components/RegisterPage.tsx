"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "@/context/ThemeContext";
import { ThemeToggle } from "./ThemeToggle";
import LeftPanel from "./LeftPanel";
import RegisterForm from "./RegisterForm";
import { userGraphqlApi } from "@/api/graphql";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterPage() {
    const router = useRouter();
    const { theme } = useTheme();
    const isDark = theme === "dark";
    const [email, setEmail] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isPasswordFocused, setIsPasswordFocused] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [errorMsg, setErrorMsg] = useState("");
    const [emailError, setEmailError] = useState(false);
    const [phoneError, setPhoneError] = useState(false);
    const [passwordError, setPasswordError] = useState(false);
    const [confirmPasswordError, setConfirmPasswordError] = useState(false);

    const onSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            setEmailError(false);
            setPhoneError(false);
            setPasswordError(false);
            setConfirmPasswordError(false);
            setErrorMsg("");

            const cleanEmail = email.trim();
            const cleanPhone = phone.trim();

            if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
                setEmailError(true);
                setErrorMsg("Please enter a valid email address.");
                return;
            }

            if (
                cleanPhone &&
                (cleanPhone.length !== 11 || !/^\d{11}$/.test(cleanPhone))
            ) {
                setPhoneError(true);
                setErrorMsg("Phone number must be exactly 11 digits.");
                return;
            }

            if (!password || password.length < 6) {
                setPasswordError(true);
                setErrorMsg("Password must be at least 6 characters.");
                return;
            }

            // 验证确认密码
            if (password !== confirmPassword) {
                setConfirmPasswordError(true);
                setErrorMsg("Passwords do not match.");
                return;
            }

            setIsSubmitting(true);

            try {
                // 调用后端 GraphQL 注册接口
                const result = await userGraphqlApi.register({
                    email: cleanEmail,
                    password: password,
                    confirmPassword: confirmPassword,
                    ...(cleanPhone && { phone: cleanPhone }),
                });

                console.log("Registration result:", result);

                // 检查是否注册成功
                if (!result.register.success) {
                    setErrorMsg(result.register.message || "注册失败，请重试");
                    return;
                }

                // 注册成功后跳转到登录页面
                router.push("/f/login?registered=true");
            } catch (error: any) {
                console.error("Registration failed:", error);
                setErrorMsg(error.message || "注册失败，请重试");
            } finally {
                setIsSubmitting(false);
            }
        },
        [email, phone, password, confirmPassword, router],
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
                    <RegisterForm
                        email={email}
                        setEmail={setEmail}
                        phone={phone}
                        setPhone={setPhone}
                        password={password}
                        setPassword={setPassword}
                        confirmPassword={confirmPassword}
                        setConfirmPassword={setConfirmPassword}
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
                        phoneError={phoneError}
                        passwordError={passwordError}
                        confirmPasswordError={confirmPasswordError}
                    />
                </div>
            </div>
        </div>
    );
}
