/**
 * Agent 选择器组件
 * 允许用户选择使用哪个 Agent（通用助手、数据库查询、代码生成）
 */

"use client";

import { ListBox, Select } from "@heroui/react";

// Agent 类型
export type AgentType = "general" | "sql" | "code";

// Agent 选项类型
interface AgentOption {
    value: AgentType;
    label: string;
    description: string;
    icon: string;
    disabled?: boolean; // 是否禁用
    badge?: string; // 徽章文本（如 "Under development"）
}

// Agent 选项（移除自动选择，只保留具体的 Agent）
export const AGENT_OPTIONS: AgentOption[] = [
    {
        value: "general",
        label: "General Agent",
        description: "For general conversation and Q&A",
        icon: "💬",
    },
    {
        value: "sql",
        label: "SQL Agent",
        description: "For database queries and data analysis",
        icon: "🗄️",
    },
    {
        value: "code",
        label: "Code Agent",
        description: "For code generation and development",
        icon: "💻",
        disabled: true, // 标记为开发中，不可选择
        badge: "Under development", // 显示开发中徽章
    },
];

interface AgentSelectorProps {
    selectedAgent: AgentType;
    onAgentChange: (agent: AgentType) => void;
    variant?: "inline" | "dropdown"; // inline: 内联选择，dropdown: 下拉选择
    size?: "default" | "small"; // default: 44px 高度，small: 36px 高度
}

export function AgentSelector({
    selectedAgent,
    onAgentChange,
    variant = "inline",
    size = "default",
}: AgentSelectorProps) {
    // 根据尺寸调整样式
    const isSmall = size === "small";
    const disabledKeys = AGENT_OPTIONS.filter((o) => o.disabled).map(
        (o) => o.value,
    );

    if (variant === "dropdown") {
        // 下拉选择模式（HeroUI Select）
        return (
            <Select
                aria-label="Agent"
                value={selectedAgent}
                onChange={(key) => onAgentChange(key as AgentType)}
                disabledKeys={disabledKeys}
                variant="secondary"
                className="w-auto"
            >
                <Select.Trigger
                    className={`${isSmall ? "h-9 px-1.5" : "h-11 px-2"} min-w-[120px] max-w-[200px] whitespace-nowrap overflow-hidden flex items-center`}
                >
                    <Select.Value
                        className={`!flex !flex-1 !min-w-0 h-auto ${isSmall ? "h-7 text-xs" : "h-9 text-sm"} px-2.5 !items-center !justify-center !text-center rounded-md font-medium truncate bg-default/60 text-foreground`}
                    >
                        {({ selectedText, isPlaceholder }) => (
                            <span className="block w-full text-center truncate">
                                {isPlaceholder ? "Select Agent" : selectedText}
                            </span>
                        )}
                    </Select.Value>
                </Select.Trigger>
                <Select.Popover>
                    <ListBox>
                        {AGENT_OPTIONS.map((option) => (
                            <ListBox.Item
                                key={option.value}
                                id={option.value}
                                textValue={option.label}
                            >
                                {({ isSelected }) => (
                                    <span className="flex items-center gap-2 w-full">
                                        <span
                                            className={`inline-block w-2 h-2 rounded-full shrink-0 transition-opacity ${
                                                isSelected
                                                    ? "bg-green-500 opacity-100"
                                                    : "opacity-0"
                                            }`}
                                        />
                                        <span className="flex-1">{option.label}</span>
                                        {option.badge && (
                                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-default text-muted">
                                                {option.badge}
                                            </span>
                                        )}
                                    </span>
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
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${
                            isDisabled
                                ? "bg-default text-muted cursor-not-allowed opacity-60"
                                : isSelected
                                  ? "bg-accent text-accent-foreground shadow-sm"
                                  : "bg-default text-foreground hover:bg-default-hover"
                        }`}
                        title={option.description}
                    >
                        {isSelected && (
                            <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
                        )}
                        <span>{option.label}</span>
                        {option.badge && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-secondary text-muted">
                                {option.badge}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
