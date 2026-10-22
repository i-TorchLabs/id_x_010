/**
 * SQL 查询结果视图组件
 *
 * 在"表格 / 图表"两种视图间切换，默认 auto：
 * - 有 chart_config → 显示图表（用户可切到表格）
 * - 无 chart_config → 显示表格
 *
 * 设计目的：
 * - 之前 resultData 仅在 chartConfig 存在时才会通过 ChartView 渲染，
 *   即用户没要求"画图"时完全看不到查询结果；
 * - 现在后端主动推荐图表，但用户仍可能想看原始数据，因此始终可切换。
 */

"use client";

import { useState, useMemo } from "react";
import { ChartView, type ChartConfig } from "@/components/chat/ChartView";

interface ResultViewProps {
  columns?: string[];
  data?: Record<string, unknown>[];
  rowCount?: number;
  chartConfig?: ChartConfig | null;
  /** 初始视图模式：auto=按 chart_config 决定；可被用户切换覆盖 */
  defaultMode?: "auto" | "table" | "chart";
}

// ── 单元格值格式化 ──
function formatCell(v: unknown, maxLen = 60): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  const s = String(v);
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

// ── 数据视图表格 ──
function ResultTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Record<string, unknown>[];
}) {
  const headerColor = "var(--fg2)";
  const borderColor = "var(--divider)";
  const hoverBg = "var(--hover-bg)";
  const cellColor = "var(--fg2)";
  const mutedColor = "var(--fg4)";

  // 列宽自适应（按列名宽度 + 采样值宽度估算）
  const colWidths = useMemo(() => {
    return columns.map((c) => {
      let max = c.length;
      for (const r of rows.slice(0, 20)) {
        const v = r[c];
        const len = v === null || v === undefined ? 4 : String(v).length;
        if (len > max) max = len;
      }
      // 字符宽近似 8px，加上 padding 16px；上限 240px，下限 80px
      return Math.min(240, Math.max(80, max * 8 + 16));
    });
  }, [columns, rows]);

  return (
    <div
      style={{
        overflowX: "auto",
        borderRadius: 8,
        border: `0.5px solid ${borderColor}`,
      }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: "11px",
          fontFamily: "var(--font-mono, ui-monospace, monospace)",
        }}
      >
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th
                key={c}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  color: headerColor,
                  fontWeight: 600,
                  borderBottom: `0.5px solid ${borderColor}`,
                  background: "var(--surface-1)",
                  width: colWidths[i],
                  whiteSpace: "nowrap",
                  position: "sticky",
                  top: 0,
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr
              key={ri}
              style={{ transition: "background 0.15s" }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = hoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {columns.map((c) => (
                <td
                  key={c}
                  style={{
                    padding: "6px 10px",
                    color: cellColor,
                    borderBottom: `0.5px solid ${borderColor}`,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: colWidths[columns.indexOf(c)],
                  }}
                  title={formatCell(r[c], 200)}
                >
                  {formatCell(r[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div
          style={{
            padding: "16px",
            textAlign: "center",
            color: mutedColor,
            fontSize: "12px",
          }}
        >
          Query result is empty
        </div>
      )}
    </div>
  );
}

// ── 切换按钮 ──
// 外观统一走 globals.css 的 .chip-btn / .chip-btn-active:
// 细描边 + 内高光 + 悬停加深 + 按压回缩,选中态 accent 反转。
function ModeSwitch({
  mode,
  onChange,
  hasChart,
}: {
  mode: "table" | "chart";
  onChange: (m: "table" | "chart") => void;
  hasChart: boolean;
}) {
  const baseStyle: React.CSSProperties = {
    fontSize: "10px",
    fontWeight: 500,
    padding: "3px 10px",
    borderRadius: 980,
    letterSpacing: "0.01em",
  };
  // chart disabled when no chart_config
  const chartDisabled = !hasChart;

  return (
    <div className="inline-flex gap-1" role="group" aria-label="view mode">
      <button
        type="button"
        className={`chip-btn${mode === "table" ? " chip-btn-active" : ""}`}
        style={baseStyle}
        onClick={() => onChange("table")}
      >
        Table
      </button>
      <button
        type="button"
        className={`chip-btn${mode === "chart" ? " chip-btn-active" : ""}`}
        style={baseStyle}
        disabled={chartDisabled}
        onClick={() => onChange("chart")}
        title={chartDisabled ? "No available chart configuration for current data" : ""}
      >
        Chart
      </button>
    </div>
  );
}

export function ResultView({
  columns,
  data,
  rowCount,
  chartConfig,
  defaultMode = "auto",
}: ResultViewProps) {
  const rows = data || [];
  const cols = columns || [];
  const hasChart = !!chartConfig && rows.length > 0;

  const initialMode: "table" | "chart" =
    defaultMode === "table" ? "table" : defaultMode === "chart" ? "chart" : hasChart ? "chart" : "table";
  const [mode, setMode] = useState<"table" | "chart">(initialMode);

  // 图表类型切换状态：初始用后端推荐的类型，用户可手动改。
  // 后端 chartConfig 变化（新一轮查询）时通过 key 重置——ResultView 由
  // 父组件按 message.id 渲染，新消息天然是新实例，无需此处手动同步。
  const [chartType, setChartType] = useState<ChartConfig["type"] | undefined>(
    chartConfig?.type,
  );

  // 计算可切换的类型集合：基于数据结构判断哪些类型有意义
  const switchableTypes = useMemo<ChartConfig["type"][]>(() => {
    if (!chartConfig) return [];
    const numericCols = cols.filter((c) =>
      rows.some((r) => {
        const v = r[c];
        if (typeof v === "number") return true;
        if (typeof v === "string" && v.trim()) {
          return !isNaN(Number(v.replace(",", "")));
        }
        return false;
      }),
    );
    const hasNumeric = numericCols.length >= 1;
    const hasTwoNumeric = numericCols.length >= 2;
    const hasNonNumeric = cols.some((c) => !numericCols.includes(c));

    const types: ChartConfig["type"][] = [];
    if (hasNumeric && hasNonNumeric) {
      types.push("bar");
      types.push("line");
      types.push("area");
    }
    if (hasNonNumeric && hasNumeric && rows.length <= 30) {
      types.push("pie");
    }
    if (hasTwoNumeric) {
      types.push("scatter");
    }
    // 去重并保留当前类型
    const set = new Set(types);
    if (chartType && !set.has(chartType)) set.add(chartType);
    return Array.from(set);
  }, [cols, rows, chartConfig, chartType]);

  if (rows.length === 0 || cols.length === 0) {
    return null;
  }

  // 若用户切换了类型，构造一份覆盖 type 的 config 副本
  const effectiveChartConfig: ChartConfig | null = chartConfig
    ? chartType && chartType !== chartConfig.type
      ? { ...chartConfig, type: chartType }
      : chartConfig
    : null;

  return (
    <div style={{ padding: "0 16px 12px 16px" }}>
      {/* 视图切换条 */}
      <div
        className="flex items-center justify-between mb-2"
        style={{ marginTop: 8 }}
      >
        <span
          className="font-text"
          style={{
            fontSize: "10px",
            color: "var(--fg4)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Result · {rowCount ?? rows.length} rows
        </span>
        <div className="flex items-center gap-2">
          {/* TASK-014：本地导出 CSV。仅导出已加载的 ≤512 行；大数据导出走后端 exportResult mutation */}
          <button
            type="button"
            onClick={() => exportLocalCsv(cols, rows)}
            title="Export current result as CSV (only loaded rows; for full export use the export button in the query panel)"
            className="chip-btn"
            style={{
              fontSize: "11px",
              padding: "3px 10px",
              borderRadius: 980,
            }}
          >
            Export CSV
          </button>
          <ModeSwitch mode={mode} onChange={setMode} hasChart={hasChart} />
        </div>
      </div>

      {/* 视图内容 */}
      {mode === "table" ? (
        <ResultTable columns={cols} rows={rows} />
      ) : effectiveChartConfig ? (
        <ChartView
          config={effectiveChartConfig}
          data={rows}
          rowCount={rowCount}
          currentType={chartType}
          onTypeChange={setChartType}
          switchableTypes={switchableTypes}
        />
      ) : (
        <ResultTable columns={cols} rows={rows} />
      )}
    </div>
  );
}

// TASK-014：前端本地 CSV 导出。大数据场景由后端 exportResult mutation 处理，
// 这里仅导出已加载的 ≤512 行（resultData 已限制），避免网络往返。
function exportLocalCsv(
  columns: string[],
  rows: Record<string, unknown>[],
) {
  try {
    const escapeCell = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = typeof v === "object" ? JSON.stringify(v) : String(v);
      // RFC 4180：含 , " \n 的单元格用双引号包裹
      if (/[,"\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [
      columns.map(escapeCell).join(","),
      ...rows.map((r) => columns.map((c) => escapeCell(r[c])).join(",")),
    ];
    // utf-8-sig BOM 让 Excel 正确识别中文
    const blob = new Blob(["\uFEFF" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("exportLocalCsv failed", e);
    alert("Export failed, please check the console");
  }
}
