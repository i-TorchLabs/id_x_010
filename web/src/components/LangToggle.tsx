"use client";

import { Button } from "@heroui/react";
import { useI18n, type Lang } from "@/context/I18nContext";

interface LangToggleProps {
    className?: string;
}

const LANGS: Lang[] = ["zh-CN", "en-US"];
const LABELS: Record<Lang, string> = {
    "zh-CN": "中",
    "en-US": "EN",
};

export function LangToggle({ className = "" }: LangToggleProps) {
    const { lang, setLang } = useI18n();

    const next = LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length];

    return (
        <Button
            isIconOnly
            variant="ghost"
            size="sm"
            onPress={() => setLang(next)}
            aria-label={`Switch language to ${next}`}
            className={className}
        >
            <span
                className="text-xs font-semibold"
                style={{ minWidth: 20, textAlign: "center" }}
            >
                {LABELS[lang]}
            </span>
        </Button>
    );
}
