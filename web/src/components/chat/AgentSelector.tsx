/**
 * Agent 选择器组件
 * 允许用户选择使用哪个 Agent（通用助手、数据库查询、代码生成）
 */

"use client";

import type { CSSProperties } from "react";
import { ListBox, Select } from "@heroui/react";
import { useI18n } from "@/context/I18nContext";
import {
  SelectorBadge,
  SelectorCheck,
  SelectorHeader,
  selectorItemStyle,
  selectorListStyle,
} from "./selector-ui";

// Agent 类型
export type AgentType = "general" | "sql" | "code";

// Agent 选项类型
interface AgentOption {
    value: AgentType;
    label: string;
    description: string;
    disabled?: boolean; // 是否禁用
    badge?: string; // 徽章文本（如 "Under development"）
}

// Agent 选项（移除自动选择，只保留具体的 Agent）
export const AGENT_OPTIONS: AgentOption[] = [
    {
        value: "general",
        label: "General Agent",
        description: "For general conversation and Q&A",
    },
    {
        value: "sql",
        label: "SQL Agent",
        description: "For database queries and data analysis",
    },
    {
        value: "code",
        label: "Code Agent",
        description: "For code generation and development",
        disabled: true, // 标记为开发中，不可选择
        badge: "Under development", // 显示开发中徽章
    },
];

// 单色线性图标（替换原 emoji，与整体 Apple 风格一致）
function AgentIcon({
    type,
    style,
}: {
    type: AgentType;
    style?: CSSProperties;
}) {
    const common = {
        "aria-hidden": true,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        style: { width: 14, height: 14, ...style },
    };
    switch (type) {
        case "general":
            // 对话气泡
            return (
                <svg {...common}>
                    <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                </svg>
            );
        case "sql":
            // 数据库
            return (
                <svg {...common}>
                    <ellipse cx="12" cy="5" rx="9" ry="3" />
                    <path d="M3 5v14a9 3 0 0 0 18 0V5" />
                    <path d="M3 12a9 3 0 0 0 18 0" />
                </svg>
            );
        case "code":
            // 代码括号
            return (
                <svg {...common}>
                    <path d="m16 18 6-6-6-6" />
                    <path d="m8 6-6 6 6 6" />
                </svg>
            );
    }
}

interface AgentSelectorProps {
    selectedAgent: AgentType;
    onAgentChange: (agent: AgentType) => void;
    variant?: "inline" | "dropdown"; // inline: 内联选择，dropdown: 下拉选择
    size?: "default" | "small"; // default: 40px 高度，small: 36px 高度
}

export function AgentSelector({
    selectedAgent,
    onAgentChange,
    variant = "inline",
    size = "default",
}: AgentSelectorProps) {
    // 根据尺寸调整样式
    const isSmall = size === "small";
    const { t } = useI18n();
    const disabledKeys = AGENT_OPTIONS.filter((o) => o.disabled).map(
        (o) => o.value,
    );
    const selectedOption =
        AGENT_OPTIONS.find((o) => o.value === selectedAgent) ?? null;

    if (variant === "dropdown") {
        // 下拉选择模式（HeroUI Select）——「图标 + 名称 + 箭头」的安静胶囊
        return (
            <Select
                aria-label={t("chat.agentSelection")}
                value={selectedAgent}
                onChange={(key) => onAgentChange(key as AgentType)}
                disabledKeys={disabledKeys}
                variant="secondary"
                className="w-auto"
            >
                <Select.Trigger
                    className={`pill-trigger selector-trigger ${isSmall ? "h-9" : "h-10"} max-w-[200px] flex items-center`}
                >
                    <AgentIcon
                        type={selectedAgent}
                        style={{ color: "var(--fg3)", flexShrink: 0 }}
                    />
                    <Select.Value className="flex-1 min-w-0">
                        {() => (
                            <span
                                className="block truncate"
                                style={{
                                    fontSize: isSmall ? 12 : 13,
                                    fontWeight: 500,
                                    letterSpacing: "-0.1px",
                                    color: "var(--fg1)",
                                }}
                            >
                                {selectedOption?.label ?? "Select Agent"}
                            </span>
                        )}
                    </Select.Value>
                    <Select.Indicator style={{ color: "var(--fg3)" }} />
                </Select.Trigger>
                <Select.Popover
                    className="selector-popover"
                    style={{ minWidth: 260, maxWidth: 320 }}
                >
                    <SelectorHeader>{t("chat.agentSelection")}</SelectorHeader>
                    <ListBox style={selectorListStyle}>
                        {AGENT_OPTIONS.map((option) => (
                            <ListBox.Item
                                key={option.value}
                                id={option.value}
                                textValue={option.label}
                                style={selectorItemStyle}
                            >
                                {({ isSelected }) => (
                                    <>
                                        {/* 图标容器：浅底 + 细描边的小方块 */}
                                        <span
                                            className="flex items-center justify-center shrink-0"
                                            style={{
                                                width: 28,
                                                height: 28,
                                                borderRadius: 8,
                                                background: "var(--surface-1)",
                                                border: "0.5px solid var(--divider)",
                                                color: "var(--fg2)",
                                            }}
                                        >
                                            <AgentIcon type={option.value} />
                                        </span>
                                        <span className="flex flex-col flex-1 min-w-0 gap-0.5">
                                            <span className="flex items-center gap-1.5 min-w-0">
                                                <span
                                                    className="truncate"
                                                    style={{
                                                        fontSize: 13,
                                                        fontWeight: 500,
                                                        color: "var(--fg1)",
                                                    }}
                                                >
                                                    {option.label}
                                                </span>
                                                {option.badge && (
                                                    <SelectorBadge>
                                                        {option.badge}
                                                    </SelectorBadge>
                                                )}
                                            </span>
                                            <span
                                                className="truncate"
                                                style={{
                                                    fontSize: 11,
                                                    color: "var(--fg3)",
                                                }}
                                            >
                                                {option.description}
                                            </span>
                                        </span>
                                        <SelectorCheck visible={isSelected} />
                                    </>
                                )}
                            </ListBox.Item>
                        ))}
                    </ListBox>
                </Select.Popover>
            </Select>
        );
    }

    // 内联选择模式（默认，显示所有选项）
    return (
        <div className="flex flex-wrap gap-2 mb-3">
            {AGENT_OPTIONS.map((option) => {
                const isDisabled = option.disabled;
                const isSelected = selectedAgent === option.value;

                return (
                    <button
                        key={option.label}
                        onClick={() => {
                            if (!isDisabled) {
                                onAgentChange(option.value);
                            }
                        }}
                        disabled={isDisabled}
                        className={`chip-btn px-3 py-1.5 text-sm font-medium flex items-center gap-1.5${
                            isSelected ? " chip-btn-active" : ""
                        }`}
                        style={{ borderRadius: 980 }}
                        title={option.description}
                    >
                        <AgentIcon type={option.value} />
                        <span>{option.label}</span>
                        {option.badge && (
                            <span
                                className="text-xs px-1.5 py-0.5 rounded-full"
                                style={{
                                    background: isSelected
                                        ? "rgba(128,128,128,0.25)"
                                        : "var(--badge-bg)",
                                    color: "inherit",
                                    opacity: 0.85,
                                }}
                            >
                                {option.badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
