/**
 * 数据库选择器组件
 * 允许用户选择要查询的数据库
 * UI 展示 label（如"原始数据库"），后端使用 key（如"postgres"）
 */

"use client";

import { useState, useEffect } from "react";
import { ListBox, Select } from "@heroui/react";
import { databaseGraphqlApi, DatabaseInfo } from "@/api/graphql";

interface DatabaseSelectorProps {
  selectedDb: string | null;
  onDbChange: (dbName: string | null) => void;
  size?: "default" | "small"; // default: 44px height, small: 36px height
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
        className={`pill-trigger ${isSmall ? "h-9 px-1.5" : "h-11 px-2"} min-w-[100px] max-w-[180px] whitespace-nowrap overflow-hidden flex items-center rounded-lg`}
      >
        <Select.Value
          className={`!flex !flex-1 !min-w-0 h-auto ${isSmall ? "h-7 text-xs" : "h-9 text-sm"} px-2.5 !items-center !justify-center !text-center rounded-md font-medium truncate bg-default/60 text-foreground`}
        >
          {({ selectedText, isPlaceholder }) => (
            <span className="block w-full text-center truncate">
              {isPlaceholder ? (isLoading ? "Loading..." : "No databases") : selectedText}
            </span>
          )}
        </Select.Value>
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {databases.map((db) => (
            <ListBox.Item key={db.key} id={db.key} textValue={db.label}>
              {({ isSelected }) => (
                <span className="flex items-center gap-2 w-full">
                  <span
                    className={`inline-block w-2 h-2 rounded-full shrink-0 transition-opacity ${
                      isSelected ? "bg-green-500 opacity-100" : "opacity-0"
                    }`}
                  />
                  <span className="flex-1">{db.label}</span>
                </span>
              )}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
