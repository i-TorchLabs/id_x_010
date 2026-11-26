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
import type { AuthFormMetrics } from "@/hooks/useAuthFormMetrics";

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
    metrics?: AuthFormMetrics;
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
    metrics: m,
}: ForgotPasswordFormProps) {
    const { t } = useI18n();
    const logoBox = m?.logoBox ?? 56;
    const logoIcon = m?.logoIcon ?? 28;

    if (isSuccess) {
        const okSize = Math.round(64 * (m?.typeScale ?? 1));
        return (
            <div className="w-full">
                <div
                    className="flex justify-center"
                    style={{ marginBottom: m?.gapLogo ?? 24 }}
                >
                    <div
                        className="flex items-center justify-center rounded-full bg-success"
                        style={{ width: okSize, height: okSize }}
                    >
                        <svg
                            className="text-success-foreground"
                            style={{ width: okSize / 2, height: okSize / 2 }}
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

                <div
                    className="text-center"
                    style={{ marginBottom: m?.gapHeader ?? 36 }}
                >
                    <h1
                        className="font-semibold text-foreground"
                        style={{
                            fontSize: m?.titleSize ?? 26,
                            lineHeight: 1.12,
                            letterSpacing: m ? `${m.trackingTitle}px` : "-0.26px",
                            marginBottom: m?.gapTitle ?? 8,
                        }}
                    >
                        {t("forgotPassword.successTitle")}
                    </h1>
                    <p
                        className="text-muted"
                        style={{ fontSize: m?.subSize ?? 14, lineHeight: 1.45 }}
                    >
                        {t("forgotPassword.successBody", { email })}
                    </p>
                </div>

                <Button
                    fullWidth
                    variant="primary"
                    size="lg"
                    className="rounded-full font-semibold"
                    style={{
                        minHeight: m?.btnMinH ?? 44,
                        fontSize: m?.btnFont ?? 16,
                    }}
                    onPress={() => (window.location.href = "/f/010/user-login")}
                >
                    {t("forgotPassword.backToLogin")}
                </Button>
            </div>
        );
    }

    return (
        <div className="w-full">
            <div
                className="flex justify-center"
                style={{ marginBottom: m?.gapLogo ?? 24 }}
            >
                <div
                    className="flex items-center justify-center"
                    style={{
                        width: logoBox,
                        height: logoBox,
                        borderRadius: m?.logoRadius ?? 12,
                    }}
                >
                    <Image
                        src="/favicon.ico"
                        alt="Logo"
                        width={logoIcon}
                        height={logoIcon}
                        style={{ width: logoIcon, height: logoIcon }}
                        priority
                    />
                </div>
            </div>

            <div
                className="text-center"
                style={{ marginBottom: m?.gapHeader ?? 36 }}
            >
                <h1
                    className="font-semibold text-foreground"
                    style={{
                        fontSize: m?.titleSize ?? 26,
                        lineHeight: 1.12,
                        letterSpacing: m ? `${m.trackingTitle}px` : "-0.26px",
                        marginBottom: m?.gapTitle ?? 8,
                    }}
                >
                    {t("forgotPassword.title")}
                </h1>
                <p
                    className="text-muted"
                    style={{ fontSize: m?.subSize ?? 14, lineHeight: 1.45 }}
                >
                    {t("forgotPassword.subtitle")}
                </p>
            </div>

            <form
                onSubmit={(e) => {
                    void onSubmit(e);
                }}
            >
                <div style={{ marginBottom: m?.gapField ?? 20 }}>
                    <TextField
                        fullWidth
                        isInvalid={emailError}
                        validationBehavior="aria"
                    >
                        <Label
                            htmlFor="email"
                            className="font-semibold"
                            style={{ fontSize: m?.labelSize ?? 14 }}
                        >
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
                            style={{ fontSize: m?.inputSize }}
                        />
                        {emailError && (
                            <FieldError>
                                {t("forgotPassword.errorValidEmailRequired")}
                            </FieldError>
                        )}
                    </TextField>
                </div>

                <div style={{ marginBottom: m?.gapOptions ?? 24 }}>
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
                            <span
                                className="text-muted"
                                style={{ fontSize: m?.subSize ?? 14 }}
                            >
                                {t("forgotPassword.termsLabel")}
                            </span>
                        </Checkbox.Content>
                    </Checkbox>
                    {termsError && (
                        <p
                            className="text-danger"
                            style={{
                                fontSize: 12 * (m?.typeScale ?? 1),
                                marginTop: 4,
                            }}
                        >
                            {t("forgotPassword.errorTermsRequired")}
                        </p>
                    )}
                </div>

                {errorMsg && (
                    <Alert
                        status="danger"
                        style={{ marginBottom: m?.gapAlert ?? 16 }}
                    >
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
                    className="rounded-full font-semibold"
                    style={{
                        minHeight: m?.btnMinH ?? 44,
                        fontSize: m?.btnFont ?? 16,
                        letterSpacing: m ? `${m.trackingBtn}px` : undefined,
                        marginBottom: m ? Math.round(14 * m.spaceScale) : 14,
                    }}
                >
                    {isSubmitting
                        ? t("forgotPassword.submitting")
                        : t("forgotPassword.submitButton")}
                </Button>
            </form>

            <div
                className="text-center text-muted"
                style={{
                    marginTop: m?.gapFooter ?? 32,
                    fontSize: m?.subSize ?? 14,
                }}
            >
                {t("forgotPassword.rememberPassword")}{" "}
                <a
                    href="/f/010/user-login"
                    className="no-underline hover:underline font-semibold text-foreground"
                >
                    {t("login.signInLink")}
                </a>
            </div>
        </div>
    );
}
