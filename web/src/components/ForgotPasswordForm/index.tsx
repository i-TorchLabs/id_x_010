"use client";

import React from "react";
import Image from "next/image";
import {
    Alert,
    Button,
    Checkbox,
    FieldError,
    Input,
    Label,
    TextField,
} from "@heroui/react";
import { useI18n } from "@/context/I18nContext";

interface ForgotPasswordFormProps {
    email: string;
    setEmail: (email: string) => void;
    isTyping: boolean;
    setIsTyping: (isTyping: boolean) => void;
    isSubmitting: boolean;
    isSuccess: boolean;
    onSubmit: (e: React.FormEvent) => Promise<void>;
    errorMsg: string;
    emailError: boolean;
    agreedToTerms: boolean;
    setAgreedToTerms: (agreed: boolean) => void;
    termsError: boolean;
}

export default function ForgotPasswordForm({
    email,
    setEmail,
    isTyping,
    setIsTyping,
    isSubmitting,
    isSuccess,
    onSubmit,
    errorMsg,
    emailError,
    agreedToTerms,
    setAgreedToTerms,
    termsError,
}: ForgotPasswordFormProps) {
    const { t } = useI18n();
    if (isSuccess) {
        return (
            <div className="w-full max-w-100">
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 rounded-full bg-success flex items-center justify-center">
                        <svg
                            className="w-8 h-8 text-success-foreground"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M5 13l4 4L19 7"
                            />
                        </svg>
                    </div>
                </div>

                <div className="text-center mb-9">
                    <h1 className="text-[28px] font-semibold mb-1.5 leading-[1.14] tracking-[-0.28px] text-foreground">
                        {t("forgotPassword.successTitle")}
                    </h1>
                    <p className="text-[14px] text-muted">
                        {t("forgotPassword.successBody", { email })}
                    </p>
                </div>

                <Button
                    fullWidth
                    variant="primary"
                    size="lg"
                    className="rounded-full font-semibold"
                    onPress={() => (window.location.href = "/f/user-login")}
                >
                    {t("forgotPassword.backToLogin")}
                </Button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-100">
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

            <div className="text-center mb-9">
                <h1 className="text-[28px] font-semibold mb-1.5 leading-[1.14] tracking-[-0.28px] text-foreground">
                    {t("forgotPassword.title")}
                </h1>
                <p className="text-[14px] text-muted">
                    {t("forgotPassword.subtitle")}
                </p>
            </div>

            <form
                onSubmit={(e) => {
                    void onSubmit(e);
                }}
            >
                <div className="mb-5">
                    <TextField
                        fullWidth
                        isInvalid={emailError}
                        validationBehavior="aria"
                    >
                        <Label htmlFor="email" className="text-sm font-semibold">
                            {t("forgotPassword.emailLabel")}
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            fullWidth
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onFocus={() => setIsTyping(true)}
                            onBlur={() => setIsTyping(false)}
                            placeholder={t("forgotPassword.emailPlaceholder")}
                            autoComplete="off"
                        />
                        {emailError && (
                            <FieldError>{t("forgotPassword.errorValidEmailRequired")}</FieldError>
                        )}
                    </TextField>
                </div>

                {/* Terms of Service Checkbox */}
                <div className="mb-6">
                    <Checkbox
                        isSelected={agreedToTerms}
                        onChange={setAgreedToTerms}
                        isInvalid={termsError}
                        name="terms"
                    >
                        <Checkbox.Content>
                            <Checkbox.Control>
                                <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span className="text-sm text-muted">
                                {t("forgotPassword.termsLabel")}
                            </span>
                        </Checkbox.Content>
                    </Checkbox>
                    {termsError && (
                        <p className="text-[12px] mt-1 text-danger">
                            {t("forgotPassword.errorTermsRequired")}
                        </p>
                    )}
                </div>

                {errorMsg && (
                    <Alert status="danger" className="mb-4">
                        <Alert.Indicator />
                        <Alert.Content>
                            <Alert.Description>{errorMsg}</Alert.Description>
                        </Alert.Content>
                    </Alert>
                )}

                <Button
                    type="submit"
                    fullWidth
                    variant="primary"
                    size="lg"
                    isDisabled={isSubmitting}
                    className="rounded-full font-semibold mb-3.5"
                >
                    {isSubmitting ? t("forgotPassword.submitting") : t("forgotPassword.submitButton")}
                </Button>
            </form>

            <div className="text-center mt-8 text-[14px] text-muted">
                {t("forgotPassword.rememberPassword")}{" "}
                <a
                    href="/f/user-login"
                    className="no-underline hover:underline text-foreground font-semibold"
                >
                    {t("login.signInLink")}
                </a>
            </div>
        </div>
    );
}
