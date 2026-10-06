"use client";

/**
 * I18n Context（TASK-016）
 *
 * 骨架实现：localStorage 持久化 lang，t(key, vars) 支持 {var} 占位。
 * 全量替换硬编码文案留作下一轮（涉及 ChatHome/LoginForm/AdminPanel 等
 * 9+ 视图，改动面大）——本骨架提供能力，新文案改写优先使用 t()。
 */

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import zhCN from "@/i18n/zh-CN.json";
import enUS from "@/i18n/en-US.json";

export type Lang = "zh-CN" | "en-US";

type Dict = Record<string, string>;
const DICTS: Record<Lang, Dict> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "zh-CN";
  const stored = localStorage.getItem("lang");
  if (stored === "zh-CN" || stored === "en-US") return stored;
  // 按 navigator.language 自动选择
  const nav = navigator.language || "";
  return nav.startsWith("en") ? "en-US" : "zh-CN";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("lang", lang);
    }
  }, [lang]);

  const setLang = (next: Lang) => setLangState(next);

  const t = (key: string, vars?: Record<string, string | number>): string => {
    const dict = DICTS[lang] || DICTS["zh-CN"];
    let text = dict[key] || DICTS["zh-CN"][key] || key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
      }
    }
    return text;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    // 未在 Provider 内：返回默认 zh-CN，避免 SSR 报错
    return {
      lang: "zh-CN",
      setLang: () => {},
      t: (key) => DICTS["zh-CN"][key] || key,
    };
  }
  return ctx;
}
