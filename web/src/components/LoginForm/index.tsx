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
}: LoginFormProps) {
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
          Welcome to SME AI Lab
        </h1>
        <p className="text-[14px] text-muted">Please enter your details</p>
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
            {emailError && <FieldError>Invalid email address</FieldError>}
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
              Password
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
                placeholder="********"
                className="pr-11"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors z-10"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {eyeIcon}
              </button>
            </div>
            {passwordError && (
              <FieldError>Password must be at least 6 characters</FieldError>
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
              <span className="text-sm">Remember for 30 days</span>
            </Checkbox.Content>
          </Checkbox>
          <a
            href="/f/forgot-password"
            className="text-[14px] no-underline hover:underline text-foreground font-medium"
          >
            Forgot password?
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
          {isSubmitting ? "Signing in..." : "Log In"}
        </Button>

        {/* SSO 分隔与入口 */}
        <div className="flex items-center gap-3 my-5">
          <span className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted">or</span>
          <span className="flex-1 h-px bg-border" />
        </div>
        <Button
          type="button"
          fullWidth
          variant="secondary"
          size="lg"
          className="rounded-full font-semibold"
          onClick={onSsoClick}
        >
          Sign in with CUHK SSO
        </Button>
      </form>

      {/* Footer link */}
      <div className="text-center mt-8 text-[14px] text-muted">
        Don&apos;t have an account?{" "}
        <a
          href="/f/register"
          className="no-underline hover:underline text-foreground font-semibold"
        >
          Sign Up
        </a>
      </div>
    </div>
  );
}
