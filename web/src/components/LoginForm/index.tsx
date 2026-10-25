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

interface LoginFormProps {
  email: string;
  setEmail: (email: string) => void;
  password: string;
  setPassword: (password: string) => void;
  showPassword: boolean;
  setShowPassword: (showPassword: boolean) => void;
  isTyping: boolean;
  setIsTyping: (isTyping: boolean) => void;
  isPasswordFocused: boolean;
  setIsPasswordFocused: (focused: boolean) => void;
  isSubmitting: boolean;
  onSubmit: (e: React.FormEvent) => Promise<void>;
  errorMsg: string;
  emailError: boolean;
  passwordError: boolean;
  onSsoClick: () => void;
  isAdmin?: boolean;
}

export default function LoginForm({
  email,
  setEmail,
  password,
  setPassword,
  showPassword,
  setShowPassword,
  isTyping,
  setIsTyping,
  isPasswordFocused,
  setIsPasswordFocused,
  isSubmitting,
  onSubmit,
  errorMsg,
  emailError,
  passwordError,
  onSsoClick,
  isAdmin = false,
}: LoginFormProps) {
  const { t } = useI18n();
  const eyeIcon = showPassword ? (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
      />
    </svg>
  ) : (
    <svg
      className="w-5 h-5"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );

  return (
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
          {isAdmin ? t("login.adminTitle") : t("login.welcomeTitle")}
        </h1>
        <p className="text-[14px] text-muted">
          {isAdmin ? t("login.adminSubtitle") : t("login.userSubtitle")}
        </p>
      </div>

      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
      >
        {/* Email Field */}
        <div className="mb-5">
          <TextField
            fullWidth
            isInvalid={emailError}
            validationBehavior="aria"
          >
            <Label htmlFor="email" className="text-sm font-semibold">
              {t("login.emailLabel")}
            </Label>
            <Input
              id="email"
              type="email"
              fullWidth
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setIsTyping(true)}
              onBlur={() => setIsTyping(false)}
              placeholder={t("login.emailPlaceholder")}
              autoComplete="off"
            />
            {emailError && <FieldError>{t("login.errorInvalidEmail")}</FieldError>}
          </TextField>
        </div>

        {/* Password Field */}
        <div className="mb-5">
          <TextField
            fullWidth
            isInvalid={passwordError}
            validationBehavior="aria"
          >
            <Label htmlFor="password" className="text-sm font-semibold">
              {t("login.passwordLabel")}
            </Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? "text" : "password"}
                fullWidth
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setIsPasswordFocused(true)}
                onBlur={() => setIsPasswordFocused(false)}
                placeholder={t("login.passwordPlaceholder")}
                className="pr-11"
              />
              <button
                type="button"
                className="icon-btn-sm absolute right-2 top-1/2 -translate-y-1/2 z-10"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("login.ariaHidePassword") : t("login.ariaShowPassword")}
              >
                {eyeIcon}
              </button>
            </div>
            {passwordError && (
              <FieldError>{t("login.errorPasswordTooShort")}</FieldError>
            )}
          </TextField>
        </div>

        {/* Options Group */}
        <div className="flex items-center justify-between mb-6">
          <Checkbox defaultSelected name="remember">
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <span className="text-sm">{t("login.rememberMe")}</span>
            </Checkbox.Content>
          </Checkbox>
          <a
            href="/f/010/forgot-password"
            className="text-[14px] no-underline hover:underline text-foreground font-medium"
          >
            {t("login.forgotPassword")}
          </a>
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

        {/* Submit */}
        <Button
          type="submit"
          fullWidth
          variant="primary"
          size="lg"
          isDisabled={isSubmitting}
          className="rounded-full font-semibold"
        >
          {isSubmitting
            ? t("login.signingIn")
            : isAdmin
              ? t("login.adminSignIn")
              : t("login.logIn")}
        </Button>

        {/* SSO 分隔与入口（仅普通用户登录页展示，管理后台不提供 SSO） */}
        {!isAdmin && (
          <>
            <div className="flex items-center gap-3 my-5">
              <span className="flex-1 h-px" style={{ background: "var(--divider)" }} />
              <span className="text-xs text-muted">{t("login.or")}</span>
              <span className="flex-1 h-px" style={{ background: "var(--divider)" }} />
            </div>
            <Button
              type="button"
              fullWidth
              variant="secondary"
              size="lg"
              className="rounded-full font-semibold"
              onPress={onSsoClick}
            >
              {t("login.signInWithSso")}
            </Button>
          </>
        )}
      </form>

      {/* Footer link */}
      <div className="text-center mt-8 text-[14px] text-muted">
        {isAdmin ? (
          <>
            {t("login.adminFooterPrompt")}{" "}
            <a
              href="/f/010/user-login"
              className="no-underline hover:underline text-foreground font-semibold"
            >
              {t("login.userSignInLink")}
            </a>
          </>
        ) : (
          <>
            <div>
              {t("login.noAccountPrompt")}{" "}
              <a
                href="/f/010/user-register"
                className="no-underline hover:underline text-foreground font-semibold"
              >
                {t("login.signUpLink")}
              </a>
            </div>
            <div className="mt-2">
              <a
                href="/f/010/admin-login"
                className="no-underline hover:underline text-foreground font-semibold"
              >
                {t("login.adminLoginLink")}
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
