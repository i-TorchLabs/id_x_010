"use client";

import { useEffect } from "react";
import { clamp, lerp, splitTypeSpaceScale } from "./viewportMath";

/** 工作台设计基准视口（STANDARD-UI 附录 C 校准量级） */
const BASE_W = 1440;
const BASE_H = 900;

export type WorkbenchScaleVars = {
  scale: number;
  typeScale: number;
  spaceScale: number;
  navH: number;
  padX: number;
  padY: number;
  sidebarW: number;
  sidebarRail: number;
  heroTitle: number;
  heroSub: number;
  tableMaxH: number;
};

function compute(vw: number, vh: number): WorkbenchScaleVars {
  const aspect = vw / Math.max(vh, 1);
  const aspectSoft =
    aspect > 1.6
      ? lerp(1, 0.94, clamp((aspect - 1.6) / 0.8, 0, 1))
      : aspect < 1.1
        ? lerp(1, 0.96, clamp((1.1 - aspect) / 0.3, 0, 1))
        : 1;

  const raw =
    Math.min(vw / BASE_W, vh / BASE_H, 1.05) * aspectSoft;
  const { raw: scale, typeScale, spaceScale } = splitTypeSpaceScale(raw, {
    typeMin: 0.9,
    spaceMin: 0.78,
    max: 1.05,
  });

  return {
    scale,
    typeScale,
    spaceScale,
    navH: Math.round(48 * spaceScale),
    padX: Math.round(lerp(16, 24, spaceScale)),
    padY: Math.round(lerp(12, 16, spaceScale)),
    sidebarW: Math.round(288 * clamp(spaceScale, 0.85, 1)),
    sidebarRail: Math.round(56 * clamp(spaceScale, 0.9, 1)),
    heroTitle: +(clamp(48 * typeScale, 28, 52)).toFixed(2),
    heroSub: +(clamp(15 * typeScale, 13, 16)).toFixed(2),
    // 表格滚动区：视口高度减去顶栏/Tab/页脚余量
    tableMaxH: Math.max(240, Math.round(vh * 0.55)),
  };
}

function applyToDocument(vars: WorkbenchScaleVars) {
  const root = document.documentElement;
  root.style.setProperty("--wb-scale", String(vars.scale));
  root.style.setProperty("--wb-type", String(vars.typeScale));
  root.style.setProperty("--wb-space", String(vars.spaceScale));
  root.style.setProperty("--wb-nav-h", `${vars.navH}px`);
  root.style.setProperty("--wb-pad-x", `${vars.padX}px`);
  root.style.setProperty("--wb-pad-y", `${vars.padY}px`);
  root.style.setProperty("--wb-sidebar-w", `${vars.sidebarW}px`);
  root.style.setProperty("--wb-sidebar-rail", `${vars.sidebarRail}px`);
  root.style.setProperty("--wb-hero-title", `${vars.heroTitle}px`);
  root.style.setProperty("--wb-hero-sub", `${vars.heroSub}px`);
  root.style.setProperty("--wb-table-max-h", `${vars.tableMaxH}px`);
}

/**
 * 全局工作台比例：写入 :root CSS 变量，供聊天 / 管理 / Hero 等消费。
 * 挂在 Providers 即可覆盖全站非认证页。
 */
export function useWorkbenchScale() {
  useEffect(() => {
    const update = () => {
      applyToDocument(
        compute(window.innerWidth, window.innerHeight),
      );
    };
    update();
    window.addEventListener("resize", update);
    // visualViewport 覆盖移动端浏览器 chrome 显隐
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
}
