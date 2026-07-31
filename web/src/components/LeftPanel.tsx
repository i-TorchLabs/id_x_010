"use client";

import React from "react";
import { AnimatedCharacters } from "./AnimatedCharacters";

interface LeftPanelProps {
  isTyping: boolean;
  isPasswordFocused: boolean;
  showPassword: boolean;
  passwordLength: number;
  isDark?: boolean;
}

export default function LeftPanel({
  isTyping,
  isPasswordFocused,
  showPassword,
  passwordLength,
  isDark = false,
}: LeftPanelProps) {
  const overlayBg = isDark
    ? "rgba(28, 28, 30, 0.55)"
    : "rgba(200, 200, 200, 0.55)";
  const brandColor = isDark ? "#fff" : "#1d1d1f";
  const linkColor = isDark
    ? "rgba(200, 200, 200, 0.7)"
    : "rgba(60, 60, 60, 0.7)";

  return (
    <div className="relative hidden md:flex flex-col justify-between p-4 overflow-hidden">
      {/* ── Background: vivid color blobs as blur source ── */}
      <div className="absolute inset-0 z-0">
        <div
          className="absolute top-[10%] left-[5%] w-75 h-75 rounded-full"
          style={{
            background: isDark
              ? "rgba(60, 60, 60, 0.4)"
              : "rgba(120, 120, 120, 0.6)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute top-[30%] right-[10%] w-65 h-65 rounded-full"
          style={{
            background: isDark
              ? "rgba(80, 80, 80, 0.3)"
              : "rgba(100, 100, 100, 0.5)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute bottom-[10%] left-[15%] w-87.5 h-87.5 rounded-full"
          style={{
            background: isDark
              ? "rgba(50, 50, 50, 0.25)"
              : "rgba(90, 90, 90, 0.45)",
            filter: "blur(100px)",
          }}
        />
        <div
          className="absolute bottom-[25%] right-[5%] w-50 h-50 rounded-full"
          style={{
            background: isDark
              ? "rgba(70, 70, 70, 0.3)"
              : "rgba(110, 110, 110, 0.5)",
            filter: "blur(70px)",
          }}
        />
      </div>

      {/* ── Frosted glass overlay ── */}
      <div
        className="absolute inset-0 z-1"
        style={{
          background: overlayBg,
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
        }}
      />

      {/* Logo */}
      <div
        className="flex items-center gap-2.5 text-base font-semibold z-10 relative"
        style={{ color: brandColor }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-7 h-7 bg-black/10 dark:bg-white/15 backdrop-blur-sm p-1 rounded-md"
        >
          <path d="M12 2L15 9H9L12 2Z" />
          <path d="M12 22L9 15H15L12 22Z" />
          <path d="M2 12L9 9V15L2 12Z" />
          <path d="M22 12L15 15V9L22 12Z" />
        </svg>
        <span>SME AI Labs</span>
      </div>

      {/* Animated Characters */}
      <div className="relative z-10 flex items-end justify-center h-105">
        <AnimatedCharacters
          isTyping={isTyping}
          isPasswordFocused={isPasswordFocused}
          showPassword={showPassword}
          passwordLength={passwordLength}
        />
      </div>

      {/* Footer: Brand + Links */}
      <div
        className="flex items-center gap-7 text-[13px] z-10 relative"
        style={{ color: linkColor }}
      >
        <a
          href="#"
          className="hover:transition-colors duration-200"
          style={{ color: linkColor }}
        >
          Privacy Policy
        </a>
        <a
          href="#"
          className="hover:transition-colors duration-200"
          style={{ color: linkColor }}
        >
          Terms of Service
        </a>
        <a
          href="#"
          className="hover:transition-colors duration-200"
          style={{ color: linkColor }}
        >
          Contact
        </a>
      </div>
    </div>
  );
}
