"use client";

import { Avatar, Button, Separator } from "@heroui/react";
import { motion } from "framer-motion";
import { PromptPanel } from "./PromptPanel";
import type { MarkdownPromptItem } from "@/api/graphql";
import { useI18n } from "@/context/I18nContext";

export type ModelType = "local" | "external";

const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
    { value: "local", label: "sidebar.modelLocal" },
    { value: "external", label: "sidebar.modelExternal" },
];

const EXPANDED_WIDTH = 288;
const COLLAPSED_WIDTH = 56;

interface ChatSidebarProps {
    onNewChat: () => void;
    modelType?: ModelType;
    onModelChange?: (model: ModelType) => void;
    userName?: string;
    userEmail?: string;
    avatarUrl?: string | null;
    onLogout?: () => void;
    onSettings?: () => void;
    onUsageStats?: () => void;
    onEditProfile?: () => void;
    onActivePromptChange?: (prompt: MarkdownPromptItem | null) => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

// ── Minimalist line icons (24×24, stroke 1.8) ──

type IconProps = { className?: string; style?: React.CSSProperties };

const NewChatIcon = ({ className }: IconProps) => (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
    </svg>
);

const ModelIcon = ({ className, style }: IconProps) => (
    <svg className={className} style={style} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <rect x="3" y="6" width="18" height="12" rx="2" />
        <path d="M12 18v2M8 20h8" />
    </svg>
);

const PromptIcon = ({ className }: IconProps) => (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z" />
        <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
);

const UsageIcon = ({ className }: IconProps) => (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M4 20V4M4 20h16" />
        <path d="M8 16v-3M13 16V9M18 16v-6" />
    </svg>
);

const GearIcon = ({ className }: IconProps) => (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" />
    </svg>
);

const LogoutIcon = ({ className }: IconProps) => (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
);

const LogoIcon = ({ className }: IconProps) => (
    <svg className={className} fill="none" stroke="var(--accent-fg)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
        <path d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
);

// Panel collapse/expand toggle icon — simple chevron pair
const PanelToggleIcon = ({ collapsed, className }: { collapsed: boolean; className?: string }) => (
    <motion.svg
        className={className}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        viewBox="0 0 24 24"
        animate={{ rotate: collapsed ? 180 : 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
    >
        <path d="M11 6l-6 6 6 6M19 6l-6 6 6 6" />
    </motion.svg>
);

export function ChatSidebar({
    onNewChat,
    modelType,
    onModelChange,
    userName: userNameProp,
    userEmail: userEmailProp,
    avatarUrl,
    onLogout,
    onSettings,
    onUsageStats,
    onEditProfile,
    onActivePromptChange,
    isCollapsed = false,
    onToggleCollapse,
}: ChatSidebarProps) {
    const { t } = useI18n();
    const userName = userNameProp ?? t("sidebar.defaultUserName");
    const userEmail = userEmailProp ?? t("sidebar.defaultUserEmail");
    const showModelSection = modelType !== undefined && onModelChange;
    const width = isCollapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH;

    const iconBtnBase: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "10px",
        color: "var(--fg2)",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        transition: "background 150ms ease, color 150ms ease",
    };

    const handleHover = (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.style.background = "var(--hover-bg)";
        e.currentTarget.style.color = "var(--fg1)";
    };
    const handleLeave = (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--fg2)";
    };

    // ── Collapsed rail: icon-only column ──
    // Toggle button + brand icon stacked vertically (top-right corner)
    if (isCollapsed) {
        return (
            <motion.aside
                initial={{ width: 0 }}
                animate={{ width }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="shrink-0 h-full overflow-hidden"
                style={{ background: "var(--bg)" }}
            >
                <div
                    className="h-full flex flex-col items-center px-2 pt-2 pb-3 gap-1.5"
                    style={{ borderRight: "0.5px solid var(--divider)" }}
                >
                    {/* ── Top: toggle button (right-upper corner) then brand icon below ── */}
                    {onToggleCollapse && (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            aria-label={t("sidebar.ariaExpand")}
                            title={t("sidebar.tooltipExpand")}
                            style={{ ...iconBtnBase, width: "36px", height: "36px" }}
                            onMouseEnter={handleHover}
                            onMouseLeave={handleLeave}
                        >
                            <PanelToggleIcon collapsed={true} className="w-[18px] h-[18px]" />
                        </button>
                    )}

                    {/* Brand icon directly below toggle */}
                    <div
                        className="flex items-center justify-center mb-1"
                        style={{ width: "28px", height: "28px", borderRadius: "8px", background: "var(--accent)", boxShadow: "var(--shadow-sm)" }}
                    >
                        <LogoIcon className="w-4 h-4" />
                    </div>

                    <div className="w-7 my-0.5" style={{ borderTop: "0.5px solid var(--divider)" }} />

                    {/* ── New Chat ── */}
                    <button type="button" onClick={onNewChat} aria-label={t("sidebar.ariaNewChat")} title={t("sidebar.tooltipNewChat")} style={{ ...iconBtnBase, width: "36px", height: "36px" }} onMouseEnter={handleHover} onMouseLeave={handleLeave}>
                        <NewChatIcon className="w-[18px] h-[18px]" />
                    </button>

                    {/* ── Model (computer icon) ── */}
                    {showModelSection && (
                        <button
                            type="button"
                            onClick={() => onModelChange?.(modelType === "external" ? "local" : "external")}
                            aria-label={t("sidebar.tooltipModel", { name: modelType })}
                            title={t("sidebar.tooltipModel", { name: modelType })}
                            style={{ ...iconBtnBase, width: "36px", height: "36px", background: "var(--surface-1)" }}
                            onMouseEnter={handleHover}
                            onMouseLeave={handleLeave}
                        >
                            <ModelIcon className="w-[18px] h-[18px]" />
                        </button>
                    )}

                    {/* ── Prompts ── */}
                    <button type="button" onClick={onActivePromptChange?.bind(null, null)} aria-label={t("sidebar.ariaPromptLibrary")} title={t("sidebar.tooltipPromptLibrary")} style={{ ...iconBtnBase, width: "36px", height: "36px" }} onMouseEnter={handleHover} onMouseLeave={handleLeave}>
                        <PromptIcon className="w-[18px] h-[18px]" />
                    </button>

                    <div className="flex-1" aria-hidden />

                    <div className="w-7 my-0.5" style={{ borderTop: "0.5px solid var(--divider)" }} />

                    {/* ── User avatar ── */}
                    <button type="button" onClick={onEditProfile} disabled={!onEditProfile} aria-label={t("sidebar.ariaEditProfile")} title={userName} className="rounded-full transition-transform hover:scale-105 mb-1">
                        <Avatar size="sm" style={{ width: "28px", height: "28px" }}>
                            {avatarUrl && <Avatar.Image src={avatarUrl} alt={userName} />}
                            <Avatar.Fallback className="text-xs font-semibold" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
                                {userName.slice(0, 1).toUpperCase()}
                            </Avatar.Fallback>
                        </Avatar>
                    </button>

                    {onUsageStats && (
                        <button type="button" onClick={onUsageStats} aria-label={t("sidebar.ariaUsage")} title={t("sidebar.tooltipUsage")} style={{ ...iconBtnBase, width: "36px", height: "36px" }} onMouseEnter={handleHover} onMouseLeave={handleLeave}>
                            <UsageIcon className="w-[18px] h-[18px]" />
                        </button>
                    )}
                    {onSettings && (
                        <button type="button" onClick={onSettings} aria-label={t("sidebar.ariaSettings")} title={t("sidebar.tooltipSettings")} style={{ ...iconBtnBase, width: "36px", height: "36px" }} onMouseEnter={handleHover} onMouseLeave={handleLeave}>
                            <GearIcon className="w-[18px] h-[18px]" />
                        </button>
                    )}
                    {onLogout && (
                        <button type="button" onClick={onLogout} aria-label={t("sidebar.ariaLogout")} title={t("sidebar.tooltipLogout")} style={{ ...iconBtnBase, width: "36px", height: "36px" }} onMouseEnter={handleHover} onMouseLeave={handleLeave}>
                            <LogoutIcon className="w-[18px] h-[18px]" />
                        </button>
                    )}
                </div>
            </motion.aside>
        );
    }

    // ── Expanded sidebar ──
    return (
        <motion.aside
            initial={{ width: 0 }}
            animate={{ width }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="shrink-0 h-full overflow-hidden"
            style={{ background: "var(--bg)" }}
        >
            <div
                className="w-72 h-full flex flex-col"
                style={{ borderRight: "0.5px solid var(--divider)" }}
            >
                {/* ── Brand row + collapse button at right-upper corner ── */}
                <div className="flex items-center gap-2.5 px-4 h-14 shrink-0">
                    <div
                        className="flex items-center justify-center"
                        style={{ width: "24px", height: "24px", borderRadius: "7px", background: "var(--accent)", boxShadow: "var(--shadow-sm)" }}
                    >
                        <LogoIcon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 flex flex-col">
                        <span className="font-display leading-tight" style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.32px", color: "var(--fg1)" }}>
                          {t("sidebar.brandName")}
                        </span>
                        <span className="font-text leading-tight" style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--fg3)" }}>
                            {t("sidebar.brandSubtitle")}
                        </span>
                    </div>
                    {/* Independent collapse toggle button — upper right corner */}
                    {onToggleCollapse && (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            aria-label={t("sidebar.ariaCollapse")}
                            title={t("sidebar.tooltipCollapse")}
                            style={{ ...iconBtnBase, width: "28px", height: "28px" }}
                            onMouseEnter={handleHover}
                            onMouseLeave={handleLeave}
                        >
                            <PanelToggleIcon collapsed={false} className="w-[15px] h-[15px]" />
                        </button>
                    )}
                </div>

                <Separator />

                {/* ── New Chat ── */}
                <div className="px-4 pt-3 pb-2 shrink-0">
                    <Button
                        fullWidth
                        variant="primary"
                        onPress={onNewChat}
                        className="rounded-full font-semibold"
                        style={{ boxShadow: "var(--shadow-inset), var(--shadow-sm)", letterSpacing: "-0.01em", transition: "box-shadow 180ms ease, transform 180ms ease" }}
                    >
                        <NewChatIcon className="w-4 h-4" />
                        {t("sidebar.newChat")}
                    </Button>
                </div>

                {/* ── Model Selection (computer icon) ── */}
                {showModelSection && (
                    <div className="px-4 shrink-0">
                        <p className="label-section mb-2 px-1 flex items-center gap-1.5">
                            <ModelIcon className="w-3.5 h-3.5" style={{ color: "var(--fg4)" }} />
                            {t("sidebar.modelSelection")}
                        </p>
                        <div className="flex flex-col gap-1">
                            {MODEL_OPTIONS.map((option) => {
                                const isSelected = modelType === option.value;
                                return (
                                    <Button
                                        key={option.value}
                                        fullWidth
                                        variant={isSelected ? "secondary" : "ghost"}
                                        onPress={() => onModelChange?.(option.value)}
                                        className="justify-start"
                                        style={{
                                            borderRadius: "10px",
                                            background: isSelected ? "var(--surface-1)" : "transparent",
                                            border: isSelected ? "0.5px solid var(--divider-strong)" : "0.5px solid transparent",
                                        }}
                                    >
                                        <span className="flex-1 text-left" style={{ fontSize: "13px", fontWeight: isSelected ? 600 : 500, color: isSelected ? "var(--fg1)" : "var(--fg2)" }}>
                                            {t(option.label)}
                                        </span>
                                        {isSelected && (
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" style={{ color: "var(--fg1)" }}>
                                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                            </svg>
                                        )}
                                    </Button>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* ── Prompt Library ── */}
                <div className="mt-4 shrink-0">
                    <PromptPanel onActivePromptChange={onActivePromptChange} />
                </div>

                <div className="flex-1" aria-hidden />

                <Separator />

                {/* ── User Footer ── */}
                <div
                    className="px-3 py-2.5 shrink-0 flex items-center gap-2 mx-2 mb-2 rounded-xl"
                    style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)" }}
                >
                    <button
                        type="button"
                        onClick={onEditProfile}
                        disabled={!onEditProfile}
                        aria-label={t("sidebar.ariaEditProfile")}
                        className="shrink-0 rounded-full transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-offset-2"
                        style={{ outlineOffset: 2, cursor: onEditProfile ? "pointer" : "default" }}
                    >
                        <Avatar size="sm">
                            {avatarUrl && <Avatar.Image src={avatarUrl} alt={userName} />}
                            <Avatar.Fallback className="text-xs font-semibold" style={{ background: "var(--accent)", color: "var(--accent-fg)" }}>
                                {userName.slice(0, 1).toUpperCase()}
                            </Avatar.Fallback>
                        </Avatar>
                    </button>
                    <div className={`flex-1 min-w-0 ${onEditProfile ? "cursor-pointer" : ""}`} onClick={onEditProfile}>
                        <p className="font-text truncate" style={{ fontSize: "13px", fontWeight: 600, color: "var(--fg1)", letterSpacing: "-0.01em" }}>
                            {userName}
                        </p>
                        <p className="font-text truncate" style={{ fontSize: "11px", color: "var(--fg3)" }}>
                            {userEmail}
                        </p>
                    </div>
                    {onUsageStats && (
                        <Button isIconOnly variant="ghost" size="sm" onPress={onUsageStats} aria-label={t("sidebar.ariaUsage")} className="icon-btn">
                            <UsageIcon className="w-[18px] h-[18px]" />
                        </Button>
                    )}
                    {onSettings && (
                        <Button isIconOnly variant="ghost" size="sm" onPress={onSettings} aria-label={t("sidebar.ariaSettings")} className="icon-btn">
                            <GearIcon className="w-[18px] h-[18px]" />
                        </Button>
                    )}
                    {onLogout && (
                        <Button isIconOnly variant="ghost" size="sm" onPress={onLogout} aria-label={t("sidebar.ariaLogout")} className="icon-btn">
                            <LogoutIcon className="w-[18px] h-[18px]" />
                        </Button>
                    )}
                </div>
            </div>
        </motion.aside>
    );
}

export { EXPANDED_WIDTH, COLLAPSED_WIDTH };
