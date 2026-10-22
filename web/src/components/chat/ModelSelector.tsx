"use client";

import { useMemo, useState, useRef, useLayoutEffect } from "react";
import { ListBox, Select } from "@heroui/react";
import { ModelInfo } from "@/api/graphql";
import { useI18n } from "@/context/I18nContext";
import {
  SelectorBadge,
  SelectorCheck,
  SelectorGroupLabel,
  SelectorHeader,
  selectorItemStyle,
  selectorListStyle,
} from "./selector-ui";

// 模型图标（单色火花，呼应"智能模型"语义）
function SparklesIcon({ style }: { style?: React.CSSProperties }) {
  return (
    <svg
      aria-hidden
      style={{ width: 14, height: 14, ...style }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
      <path d="M20 3v4" />
      <path d="M22 5h-4" />
    </svg>
  );
}

// 模型选择器 —— 触发器为「图标 + 模型名 + 箭头」的安静胶囊，
// 宽度自适应当前模型名长度；弹层内按厂商分块展示，
// 用户自定义模型（非系统模型）归入底部的 Custom 分组。
export function ModelSelector({
  models,
  selectedModel,
  setSelectedModel,
  isLoadingModels,
  isSmall,
}: {
  models: ModelInfo[];
  selectedModel: ModelInfo | null;
  setSelectedModel: (m: ModelInfo | null) => void;
  isLoadingModels: boolean;
  isSmall: boolean;
}) {
  const measureRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const { t } = useI18n();

  // 按厂商分组：系统模型以厂商名成块（保持首次出现顺序），
  // 用户自定义模型统一收进底部的 Custom 分组。
  const { providerGroups, customModels } = useMemo(() => {
    const groups = new Map<string, ModelInfo[]>();
    const custom: ModelInfo[] = [];
    for (const model of models) {
      if (model.isSystem) {
        const key = model.provider || "Other";
        const list = groups.get(key);
        if (list) {
          list.push(model);
        } else {
          groups.set(key, [model]);
        }
      } else {
        custom.push(model);
      }
    }
    return {
      providerGroups: Array.from(groups.entries()),
      customModels: custom,
    };
  }, [models]);

  // 触发器只显示模型名，提供方等完整信息放入弹层，避免胶囊过长显得拥挤
  const displayText = selectedModel
    ? selectedModel.name
    : isLoadingModels
      ? t("chat.modelLoading")
      : t("chat.noModels");

  useLayoutEffect(() => {
    if (measureRef.current) {
      setWidth(measureRef.current.offsetWidth);
    }
  }, [displayText, isSmall]);

  // 固定开销：左内边距 11 + 图标 14 + 间距 6 + 箭头区域 28 + 描边余量 5
  const minW = isSmall ? 104 : 120;
  const maxW = isSmall ? 220 : 260;
  const triggerWidth =
    width != null
      ? `min(${maxW}px, max(${minW}px, ${width + 64}px))`
      : `${minW}px`;

  return (
    <Select
      aria-label={t("sidebar.modelSelection")}
      value={selectedModel ? String(selectedModel.id) : null}
      onChange={(key) => {
        const model = models.find((m) => m.id === Number(key));
        setSelectedModel(model || null);
      }}
      isDisabled={isLoadingModels || models.length === 0}
      disabledKeys={models
        .filter(
          (m) =>
            m.name.includes("Under deployment") ||
            m.provider.includes("Under deployment"),
        )
        .map((m) => String(m.id))}
      placeholder={isLoadingModels ? t("chat.modelLoading") : t("chat.noModels")}
      variant="secondary"
      className="w-auto"
      style={{ width: triggerWidth }}
    >
      <Select.Trigger
        className={`pill-trigger selector-trigger w-full ${isSmall ? "h-9" : "h-10"} flex items-center`}
      >
        <SparklesIcon style={{ color: "var(--fg3)", flexShrink: 0 }} />
        <Select.Value className="flex-1 min-w-0">
          {() => (
            <span
              className={`block truncate ${isLoadingModels ? "animate-pulse" : ""}`}
              style={{
                fontSize: isSmall ? 12 : 13,
                fontWeight: 500,
                letterSpacing: "-0.1px",
                color: selectedModel ? "var(--fg1)" : "var(--fg3)",
              }}
            >
              {displayText}
            </span>
          )}
        </Select.Value>
        <Select.Indicator style={{ color: "var(--fg3)" }} />
      </Select.Trigger>
      <Select.Popover
        className="selector-popover"
        style={{ minWidth: 240, maxWidth: 320 }}
      >
        <SelectorHeader>{t("sidebar.modelSelection")}</SelectorHeader>
        <ListBox style={selectorListStyle}>
          {providerGroups.map(([provider, group]) => (
            <ListBox.Section key={provider}>
              <SelectorGroupLabel>{provider}</SelectorGroupLabel>
              {group.map((model) => (
                <ListBox.Item
                  key={model.id}
                  id={String(model.id)}
                  textValue={`${model.name} (${model.provider})`}
                  style={selectorItemStyle}
                >
                  {({ isSelected }) => (
                    <>
                      <span className="flex items-center gap-1.5 flex-1 min-w-0">
                        <span
                          className="truncate"
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--fg1)",
                          }}
                        >
                          {model.name}
                        </span>
                        {model.isSystem && (
                          <SelectorBadge>{t("chat.sysBadge")}</SelectorBadge>
                        )}
                      </span>
                      <SelectorCheck visible={isSelected} />
                    </>
                  )}
                </ListBox.Item>
              ))}
            </ListBox.Section>
          ))}
          {customModels.length > 0 && (
            <ListBox.Section key="__custom__">
              <SelectorGroupLabel>{t("chat.customGroup")}</SelectorGroupLabel>
              {customModels.map((model) => (
                <ListBox.Item
                  key={model.id}
                  id={String(model.id)}
                  textValue={`${model.name} (${model.provider})`}
                  style={selectorItemStyle}
                >
                  {({ isSelected }) => (
                    <>
                      <span className="flex flex-col flex-1 min-w-0 gap-0.5">
                        <span
                          className="truncate"
                          style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: "var(--fg1)",
                          }}
                        >
                          {model.name}
                        </span>
                        <span
                          className="truncate"
                          style={{ fontSize: 11, color: "var(--fg3)" }}
                        >
                          {model.provider}
                        </span>
                      </span>
                      <SelectorCheck visible={isSelected} />
                    </>
                  )}
                </ListBox.Item>
              ))}
            </ListBox.Section>
          )}
        </ListBox>
      </Select.Popover>
      {/* 隐藏测量节点：用于触发器宽度自适应 */}
      <span
        ref={measureRef}
        aria-hidden
        style={{
          fontSize: isSmall ? 12 : 13,
          fontWeight: 500,
          position: "absolute",
          visibility: "hidden",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          left: -9999,
          top: -9999,
        }}
      >
        {displayText}
      </span>
    </Select>
  );
}
