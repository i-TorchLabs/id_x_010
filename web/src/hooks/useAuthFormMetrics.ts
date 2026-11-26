"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { clamp, lerp, splitTypeSpaceScale } from "./viewportMath";

/** 右侧认证表单设计基准（STANDARD-UI 附录 B，SSO 略收窄） */
export type AuthFormPreset = "sso" | "login" | "register" | "forgot";

const PRESETS: Record<
  AuthFormPreset,
  { baseW: number; baseH: number; titlePx: number; btnPx: number; btnH: number }
> = {
  sso: { baseW: 340, baseH: 260, titlePx: 26, btnPx: 16, btnH: 48 },
  login: { baseW: 360, baseH: 420, titlePx: 26, btnPx: 16, btnH: 48 },
  register: { baseW: 360, baseH: 480, titlePx: 26, btnPx: 16, btnH: 48 },
  forgot: { baseW: 360, baseH: 320, titlePx: 26, btnPx: 16, btnH: 48 },
};

export type AuthFormMetrics = {
  padX: number;
  padY: number;
  formW: number;
  logoBox: number;
  logoIcon: number;
  logoRadius: number;
  titleSize: number;
  subSize: number;
  btnFont: number;
  btnMinH: number;
  gapLogo: number;
  gapHeader: number;
  gapTitle: number;
  gapAlert: number;
  gapField: number;
  gapOptions: number;
  gapFooter: number;
  labelSize: number;
  inputSize: number;
  trackingTitle: number;
  trackingBtn: number;
  typeScale: number;
  spaceScale: number;
};

/**
 * 按右栏可用宽高等比缩放认证表单（字号 / 间距分轨）。
 * 与 LeftPanel 角色画布同一套「容器驱动比例」思路。
 */
export function useAuthFormMetrics(preset: AuthFormPreset = "login") {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const cfg = PRESETS[preset];

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    const update = () => {
      setBox({ w: el.clientWidth, h: el.clientHeight });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const metrics = useMemo<AuthFormMetrics>(() => {
    const padX = clamp(box.w * 0.08, 24, 56);
    const padY = clamp(box.h * 0.05, 20, 56);
    const availW = Math.max(0, box.w - padX * 2);
    const availH = Math.max(0, box.h - padY * 2);

    const aspect = box.w > 0 && box.h > 0 ? box.w / box.h : 1;
    const aspectSoft =
      aspect > 1.15
        ? lerp(1, 0.92, clamp((aspect - 1.15) / 0.6, 0, 1))
        : 1;

    const raw =
      Math.min(availW / cfg.baseW, availH / cfg.baseH, 1) * aspectSoft;
    const { eased, typeScale, spaceScale } = splitTypeSpaceScale(raw);

    const formW = Math.min(cfg.baseW * lerp(0.92, 1, eased), availW || cfg.baseW);

    return {
      padX,
      padY,
      formW,
      logoBox: Math.round(56 * typeScale),
      logoIcon: Math.round(28 * typeScale),
      logoRadius: Math.round(12 * typeScale),
      titleSize: +(cfg.titlePx * typeScale).toFixed(2),
      subSize: +(14 * typeScale).toFixed(2),
      btnFont: +(cfg.btnPx * typeScale).toFixed(2),
      btnMinH: Math.max(44, Math.round(cfg.btnH * typeScale)),
      gapLogo: Math.round(24 * spaceScale),
      gapHeader: Math.round(36 * spaceScale),
      gapTitle: Math.round(8 * spaceScale),
      gapAlert: Math.round(16 * spaceScale),
      gapField: Math.round(20 * spaceScale),
      gapOptions: Math.round(24 * spaceScale),
      gapFooter: Math.round(32 * spaceScale),
      labelSize: +(14 * typeScale).toFixed(2),
      inputSize: +(16 * typeScale).toFixed(2),
      trackingTitle: +(-0.26 * typeScale).toFixed(2),
      trackingBtn: +(-0.32 * typeScale).toFixed(3),
      typeScale,
      spaceScale,
    };
  }, [box.w, box.h, cfg]);

  return { wrapRef, metrics };
}
