"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedCharacters } from "./AnimatedCharacters";

interface LeftPanelProps {
  isTyping: boolean;
  isPasswordFocused: boolean;
  showPassword: boolean;
  passwordLength: number;
  isDark?: boolean;
}

/** AnimatedCharacters 设计画布（角色最高约 440px） */
const CHARS_BASE_W = 550;
const CHARS_BASE_H = 440;
/** 画布相对可用区的呼吸留白，避免贴边与盖住 Logo/Footer */
const FIT_BREATH = 0.9;
const SCALE_MIN = 0.28;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/**
 * 将固定像素角色画布等比缩放到父容器内，并保留呼吸边距。
 * 不改动 AnimatedCharacters 内部动画逻辑（对齐 STANDARD-FRONTEND 附录 D）。
 */
function ScaledAnimatedCharacters(props: {
  isTyping: boolean;
  isPasswordFocused: boolean;
  showPassword: boolean;
  passwordLength: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (w <= 0 || h <= 0) return;
      const next = Math.min(w / CHARS_BASE_W, h / CHARS_BASE_H, 1) * FIT_BREATH;
      setScale(Math.max(SCALE_MIN, next));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const slotW = CHARS_BASE_W * scale;
  const slotH = CHARS_BASE_H * scale;

  return (
    <div
      ref={wrapRef}
      className="flex h-full w-full min-h-0 items-center justify-center overflow-hidden"
    >
      <div
        style={{
          width: slotW,
          height: slotH,
          position: "relative",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: CHARS_BASE_W,
            height: CHARS_BASE_H,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <AnimatedCharacters {...props} />
        </div>
      </div>
    </div>
  );
}

/** Logo / Footer 随左栏尺寸轻量缩放，与角色画布节奏一致 */
function useChromeMetrics() {
  const panelRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 900 });

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const chrome = useMemo(() => {
    // 以常见半屏 ~720×900 为 1.0；矮屏优先压间距
    const raw = Math.min(size.w / 720, size.h / 900, 1);
    const t = clamp((raw - 0.45) / 0.55, 0, 1);
    const eased = 1 - (1 - t) ** 3;
    const type = lerp(0.86, 1, eased);
    const space = lerp(0.7, 1, eased);
    return {
      padX: Math.round(lerp(20, 40, eased)),
      padTop: Math.round(24 * space),
      padBottom: Math.round(24 * space),
      brandGap: Math.round(10 * space),
      brandIcon: Math.round(28 * type),
      brandText: +(16 * type).toFixed(2),
      footerText: +(13 * type).toFixed(2),
      footerGapX: Math.round(28 * space),
      charsPadX: Math.round(lerp(12, 32, eased)),
      charsPadY: Math.round(lerp(4, 12, eased)),
    };
  }, [size.w, size.h]);

  return { panelRef, chrome };
}

export default function LeftPanel({
  isTyping,
  isPasswordFocused,
  showPassword,
  passwordLength,
  isDark = false,
}: LeftPanelProps) {
  const { panelRef, chrome: c } = useChromeMetrics();
  const overlayBg = isDark
    ? "rgba(28, 28, 30, 0.55)"
    : "rgba(212, 212, 218, 0.42)";
  const linkColor = isDark
    ? "rgba(200, 200, 200, 0.7)"
    : "rgba(60, 60, 60, 0.7)";
  const brandColor = isDark ? "#ffffff" : "#1d1d1f";

  return (
    <div
      ref={panelRef}
      className="relative hidden h-full min-h-0 flex-col overflow-hidden md:flex"
    >
      {/* ── Background: vivid color blobs as blur source ── */}
      <div className="absolute inset-0 z-0">
        <div
          className="absolute top-[10%] left-[5%] h-75 w-75 rounded-full"
          style={{
            background: isDark
              ? "rgba(60, 60, 60, 0.4)"
              : "rgba(175, 175, 182, 0.6)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute top-[30%] right-[10%] h-65 w-65 rounded-full"
          style={{
            background: isDark
              ? "rgba(80, 80, 80, 0.3)"
              : "rgba(180, 180, 187, 0.55)",
            filter: "blur(80px)",
          }}
        />
        <div
          className="absolute bottom-[10%] left-[15%] h-87.5 w-87.5 rounded-full"
          style={{
            background: isDark
              ? "rgba(50, 50, 50, 0.25)"
              : "rgba(190, 190, 197, 0.5)",
            filter: "blur(100px)",
          }}
        />
        <div
          className="absolute bottom-[25%] right-[5%] h-50 w-50 rounded-full"
          style={{
            background: isDark
              ? "rgba(70, 70, 70, 0.3)"
              : "rgba(178, 178, 185, 0.55)",
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

      {/* Logo — 文档流占位，字号随栏宽轻量缩放 */}
      <div
        className="relative z-10 flex shrink-0 items-center min-w-0"
        style={{
          gap: c.brandGap,
          paddingLeft: c.padX,
          paddingRight: c.padX,
          paddingTop: c.padTop,
          paddingBottom: Math.round(c.padTop * 0.35),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicon.ico"
          alt="Data Agent logo"
          className="shrink-0"
          style={{ width: c.brandIcon, height: c.brandIcon }}
        />
        <span
          className="truncate font-semibold"
          style={{
            color: brandColor,
            fontSize: c.brandText,
            letterSpacing: "-0.2px",
          }}
        >
          Data Agent
        </span>
      </div>

      {/* Animated Characters — 等比 + 呼吸边距，永不盖住上下 chrome */}
      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center"
        style={{
          paddingLeft: c.charsPadX,
          paddingRight: c.charsPadX,
          paddingTop: c.charsPadY,
          paddingBottom: c.charsPadY,
        }}
      >
        <ScaledAnimatedCharacters
          isTyping={isTyping}
          isPasswordFocused={isPasswordFocused}
          showPassword={showPassword}
          passwordLength={passwordLength}
        />
      </div>

      {/* Footer Links */}
      <div
        className="relative z-10 flex shrink-0 flex-wrap"
        style={{
          color: linkColor,
          gap: `${Math.round(8 * (c.footerGapX / 28))}px ${c.footerGapX}px`,
          paddingLeft: c.padX,
          paddingRight: c.padX,
          paddingBottom: c.padBottom,
          paddingTop: Math.round(c.padBottom * 0.35),
          fontSize: c.footerText,
        }}
      >
        <a
          href="#"
          className="transition-opacity duration-200 hover:opacity-80"
          style={{ color: linkColor }}
        >
          Privacy Policy
        </a>
        <a
          href="#"
          className="transition-opacity duration-200 hover:opacity-80"
          style={{ color: linkColor }}
        >
          Terms of Service
        </a>
        <a
          href="#"
          className="transition-opacity duration-200 hover:opacity-80"
          style={{ color: linkColor }}
        >
          Contact
        </a>
      </div>
    </div>
  );
}
