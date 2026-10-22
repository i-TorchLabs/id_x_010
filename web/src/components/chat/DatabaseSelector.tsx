/**
 * 数据库选择器组件
 * 允许用户选择要查询的数据库
 * UI 展示 label（如"原始数据库"），后端使用 key（如"postgres"）
 */

"use client";

import type { CSSProperties } from "react";
import { useState, useEffect } from "react";
import { ListBox, Select } from "@heroui/react";
import { databaseGraphqlApi, DatabaseInfo } from "@/api/graphql";
import {
  SelectorCheck,
  SelectorHeader,
  selectorItemStyle,
  selectorListStyle,
} from "./selector-ui";

// 数据库图标（单色圆柱）
function DatabaseIcon({ style }: { style?: CSSProperties }) {
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
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </svg>
  );
}

interface DatabaseSelectorProps {
  selectedDb: string | null;
  onDbChange: (dbName: string | null) => void;
  size?: "default" | "small"; // default: 40px height, small: 36px height
}

export function DatabaseSelector({
  selectedDb,
  onDbChange,
  size = "default",
}: DatabaseSelectorProps) {
  const isSmall = size === "small";

  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const loadDatabases = async () => {
      setIsLoading(true);
      try {
        const response = await databaseGraphqlApi.getDatabases();
        if (response.getDatabases.success) {
          setDatabases(response.getDatabases.databases);
          if (response.getDatabases.databases.length > 0 && !selectedDb) {
            onDbChange(response.getDatabases.databases[0].key);
          }
        }
      } catch (error) {
        console.error("Failed to load database list:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDatabases();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedLabel =
    databases.find((db) => db.key === selectedDb)?.label ?? null;
  const displayText =
    selectedLabel ?? (isLoading ? "Loading..." : "No databases");

  return (
    <Select
      aria-label="Database"
      value={selectedDb}
      onChange={(key) => onDbChange(key ? String(key) : null)}
      isDisabled={isLoading || databases.length === 0}
      placeholder={isLoading ? "Loading..." : "No databases"}
      variant="secondary"
      className="w-auto"
    >
      <Select.Trigger
        className={`pill-trigger selector-trigger ${isSmall ? "h-9" : "h-10"} max-w-[180px] flex items-center`}
      >
        <DatabaseIcon style={{ color: "var(--fg3)", flexShrink: 0 }} />
        <Select.Value className="flex-1 min-w-0">
          {() => (
            <span
              className={`block truncate ${isLoading ? "animate-pulse" : ""}`}
              style={{
                fontSize: isSmall ? 12 : 13,
                fontWeight: 500,
                letterSpacing: "-0.1px",
                color: selectedLabel ? "var(--fg1)" : "var(--fg3)",
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
        style={{ minWidth: 200, maxWidth: 280 }}
      >
        <SelectorHeader>Database</SelectorHeader>
        <ListBox style={selectorListStyle}>
          {databases.map((db) => (
            <ListBox.Item
              key={db.key}
              id={db.key}
              textValue={db.label}
              style={selectorItemStyle}
            >
              {({ isSelected }) => (
                <>
                  <span
                    className="flex-1 min-w-0 truncate"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--fg1)",
                    }}
                  >
                    {db.label}
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
