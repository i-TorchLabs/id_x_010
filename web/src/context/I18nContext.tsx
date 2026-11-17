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

// v2：默认语言改为英文；旧键 "lang" 存的多为 navigator 自动探测结果，
// 不再继承（一次性重置为英文默认），用户切换后写入新键并持久化。
const LANG_STORAGE_KEY = "lang.v2";
const LEGACY_LANG_STORAGE_KEY = "lang";

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
  // 默认语言：英文（en-US）；用户手动切换后以 localStorage 为准
  if (typeof window === "undefined") return "en-US";
  const stored = localStorage.getItem(LANG_STORAGE_KEY);
  if (stored === "zh-CN" || stored === "en-US") return stored;
  return "en-US";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(getInitialLang);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LANG_STORAGE_KEY, lang);
      localStorage.removeItem(LEGACY_LANG_STORAGE_KEY);
    }
  }, [lang]);

  const setLang = (next: Lang) => setLangState(next);

  const t = (key: string, vars?: Record<string, string | number>): string => {
    const dict = DICTS[lang] || DICTS["en-US"];
    let text = dict[key] || DICTS["en-US"][key] || key;
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
    // 未在 Provider 内：返回默认 en-US，避免 SSR 报错
    return {
      lang: "en-US",
      setLang: () => {},
      t: (key) => DICTS["en-US"][key] || key,
    };
  }
  return ctx;
}
