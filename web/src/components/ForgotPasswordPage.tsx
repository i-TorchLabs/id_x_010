"use client";

import { useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { AuthSplitShell } from "./AuthSplitShell";
import ForgotPasswordForm from "./ForgotPasswordForm";
import { userGraphqlApi } from "@/api/graphql";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
    const { theme } = useTheme();
    const { t } = useI18n();
    const isDark = theme === "dark";
    const [email, setEmail] = useState("");
    const [isTyping, setIsTyping] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const [errorMsg, setErrorMsg] = useState("");
    const [emailError, setEmailError] = useState(false);
    const [agreedToTerms, setAgreedToTerms] = useState(false);
    const [termsError, setTermsError] = useState(false);

    const onSubmit = useCallback(
        async (e: React.FormEvent) => {
            e.preventDefault();
            setEmailError(false);
            setTermsError(false);
            setErrorMsg("");

            const cleanEmail = email.trim();

            if (!cleanEmail || !EMAIL_REGEX.test(cleanEmail)) {
                setEmailError(true);
                setErrorMsg(t("forgotPassword.errorValidEmailRequired"));
                return;
            }

            if (!agreedToTerms) {
                setTermsError(true);
                setErrorMsg(t("forgotPassword.errorTermsRequired"));
                return;
            }

            setIsSubmitting(true);

            try {
                const result = await userGraphqlApi.forgotPassword({
                    email: cleanEmail,
                });

                console.log("Forgot password result:", result);

                // 检查是否成功
                if (!result.forgotPassword.success) {
                    setErrorMsg(
                        result.forgotPassword.message || t("forgotPassword.errorOperationFailed"),
                    );
                    return;
                }

                setIsSuccess(true);
            } catch (error: any) {
                console.error("Forgot password failed:", error);
                setErrorMsg(error.message || t("forgotPassword.errorOperationFailed"));
            } finally {
                setIsSubmitting(false);
            }
        },
        [email, agreedToTerms],
    );

    return (
        <AuthSplitShell
            preset="forgot"
            left={{
                isTyping,
                isPasswordFocused: false,
                showPassword: false,
                passwordLength: 0,
                isDark,
            }}
        >
            {(metrics) => (
                <ForgotPasswordForm
                    email={email}
                    setEmail={setEmail}
                    isTyping={isTyping}
                    setIsTyping={setIsTyping}
                    isSubmitting={isSubmitting}
                    isSuccess={isSuccess}
                    onSubmit={onSubmit}
                    errorMsg={errorMsg}
                    emailError={emailError}
                    agreedToTerms={agreedToTerms}
                    setAgreedToTerms={setAgreedToTerms}
                    termsError={termsError}
                    metrics={metrics}
                />
            )}
        </AuthSplitShell>
    );
}
