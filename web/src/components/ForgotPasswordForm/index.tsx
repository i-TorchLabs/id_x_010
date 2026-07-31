"use client";

import React from "react";
import {
    Alert,
    Button,
    Checkbox,
    FieldError,
    Input,
    Label,
    TextField,
} from "@heroui/react";

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
                        Check your email
                    </h1>
                    <p className="text-[14px] text-muted">
                        We have sent password reset instructions to {email}
                    </p>
                </div>

                <Button
                    fullWidth
                    variant="primary"
                    size="lg"
                    className="rounded-full font-semibold"
                    onPress={() => (window.location.href = "/f/login")}
                >
                    Back to Login
                </Button>
            </div>
        );
    }

    return (
        <div className="w-full max-w-100">
            <div className="flex justify-center mb-6">
                <svg viewBox="0 0 24 24" fill="none" className="w-8 h-8">
                    <path d="M12 2L13.5 9H10.5L12 2Z" fill="#1d1d1f" />
                    <path d="M12 22L10.5 15H13.5L12 22Z" fill="#1d1d1f" />
                    <path d="M2 12L9 10.5V13.5L2 12Z" fill="#1d1d1f" />
                    <path d="M22 12L15 13.5V10.5L22 12Z" fill="#1d1d1f" />
                </svg>
            </div>

            <div className="text-center mb-9">
                <h1 className="text-[28px] font-semibold mb-1.5 leading-[1.14] tracking-[-0.28px] text-foreground">
                    Reset your password
                </h1>
                <p className="text-[14px] text-muted">
                    Enter your email to receive reset instructions
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
                            Email
                        </Label>
                        <Input
                            id="email"
                            type="email"
                            fullWidth
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            onFocus={() => setIsTyping(true)}
                            onBlur={() => setIsTyping(false)}
                            placeholder="you@example.com"
                            autoComplete="off"
                        />
                        {emailError && (
                            <FieldError>Invalid email address</FieldError>
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
                                I agree to the{" "}
                                <a
                                    href="/terms"
                                    className="no-underline hover:underline text-foreground font-medium"
                                >
                                    Terms of Service
                                </a>
                            </span>
                        </Checkbox.Content>
                    </Checkbox>
                    {termsError && (
                        <p className="text-[12px] mt-1 text-danger">
                            You must agree to the Terms of Service
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
                    {isSubmitting ? "Sending..." : "Send Reset Link"}
                </Button>
            </form>

            <div className="text-center mt-8 text-[14px] text-muted">
                Remember your password?{" "}
                <a
                    href="/f/login"
                    className="no-underline hover:underline text-foreground font-semibold"
                >
                    Log In
                </a>
            </div>
        </div>
    );
}
