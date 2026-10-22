/**
 * SQL 查询结果图表组件
 *
 * 后端 SQL Agent 通过深度意图识别（不再依赖关键词）决定是否推荐图表，
 * 返回 chart_config: {type, x_column, y_columns, title, intent, reason}。
 * 前端据此 + 实际数据行渲染 SVG 图表，并显示意图标签与选择理由。
 *
 * 支持：bar / line / area / pie / scatter 五种类型，
 * 纯手绘 SVG + framer-motion 动画，零第三方图表库依赖，
 * 黑白单色风格与全局一致。散点图带 hover tooltip。
 */

"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useTheme } from "@/context/ThemeContext";

export interface ChartConfig {
  type: "bar" | "line" | "pie" | "area" | "scatter";
  x_column: string;
  y_columns: string[];
  title?: string;
  intent?: string;
  reason?: string;
}

interface ChartViewProps {
  config: ChartConfig;
  data: Record<string, unknown>[];
  rowCount?: number;
  /** 当前图表类型（受控）；若提供 onTypeChange 则启用类型切换器 */
  currentType?: ChartConfig["type"];
  onTypeChange?: (t: ChartConfig["type"]) => void;
  /** 数据支持切换的候选类型集合（由 ResultView 计算后传入） */
  switchableTypes?: ChartConfig["type"][];
}

// ── 辅助：数值提取 + 格式化 ──
function toNum(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function formatNum(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n * 100) / 100);
}

function formatLabel(s: string, maxLen = 12): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

// ── 柱状图 ──
function BarChart({
  rows,
  xCol,
  yCols,
  isDark,
}: {
  rows: Record<string, unknown>[];
  xCol: string;
  yCols: string[];
  isDark: boolean;
}) {
  const W = 680;
  const H = 300;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 50;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxVal = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      for (const y of yCols) {
        m = Math.max(m, toNum(r[y]));
      }
    }
    return m > 0 ? m : 1;
  }, [rows, yCols]);

  const n = rows.length;
  const groupW = n > 0 ? plotW / n : plotW;
  const barW = Math.min((groupW * 0.7) / yCols.length, 28);
  const gap = 2;

  const axisColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const gridColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const labelColor = "var(--fg3)";
  const yShades = isDark
    ? yCols.map((_, i) => `rgba(255,255,255,${0.85 - i * 0.25})`)
    : yCols.map((_, i) => `rgba(0,0,0,${0.85 - i * 0.25})`);

  // Y 轴 4 档刻度
  const gridFracs = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.floor(n / 10));

  // 悬停 tooltip
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    label: string;
    values: string;
  } | null>(null);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: "auto" }}
      onMouseLeave={() => setHover(null)}
    >
      {/* 网格线 + Y 刻度 */}
      {gridFracs.map((f) => {
        const y = PAD_T + plotH - f * plotH;
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={gridColor} strokeWidth={1} />
            <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10} fill={axisColor}>
              {formatNum(maxVal * f)}
            </text>
          </g>
        );
      })}

      {/* 柱组 */}
      {rows.map((r, i) => {
        const groupX = PAD_L + i * groupW;
        const hoverInfo = {
          x: groupX + groupW / 2,
          y: PAD_T + 8,
          label: String(r[xCol] ?? ""),
          values: yCols.map((y) => `${y}=${formatNum(toNum(r[y]))}`).join(", "),
        };
        return (
          <g key={i}>
            {yCols.map((y, yi) => {
              const v = toNum(r[y]);
              const h = (v / maxVal) * plotH;
              const x = groupX + (groupW - yCols.length * (barW + gap) + gap) / 2 + yi * (barW + gap);
              const bh = Math.max(0, h);
              const by = PAD_T + plotH - bh;
              return (
                <motion.rect
                  key={y}
                  x={x}
                  width={barW}
                  rx={2}
                  fill={yShades[yi]}
                  initial={{ height: 0, y: PAD_T + plotH }}
                  animate={{ height: bh, y: by }}
                  transition={{ duration: 0.5, delay: i * 0.02, ease: "easeOut" }}
                />
              );
            })}
            {/* 透明 hit-area 触发整组 tooltip */}
            <rect
              x={groupX}
              y={PAD_T}
              width={groupW}
              height={plotH}
              fill="transparent"
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHover(hoverInfo)}
            />
            {/* X 轴标签 */}
            {i % labelStep === 0 && (
              <text
                x={groupX + groupW / 2}
                y={H - PAD_B + 16}
                textAnchor="middle"
                fontSize={10}
                fill={axisColor}
              >
                {formatLabel(String(r[xCol] ?? ""))}
              </text>
            )}
          </g>
        );
      })}

      {/* 图例 */}
      {yCols.length > 1 && (
        <g transform={`translate(${PAD_L}, ${H - 14})`}>
          {yCols.map((y, yi) => (
            <g key={y} transform={`translate(${yi * 100}, 0)`}>
              <rect width={10} height={10} fill={yShades[yi]} rx={2} />
              <text x={14} y={9} fontSize={10} fill={labelColor}>
                {formatLabel(y, 14)}
              </text>
            </g>
          ))}
        </g>
      )}

      {/* Tooltip */}
      {hover && (
        <g pointerEvents="none">
          <rect
            x={Math.min(hover.x - 60, W - PAD_R - 130)}
            y={hover.y - 4}
            width={130}
            height={32}
            rx={6}
            fill="var(--card)"
            opacity={0.92}
            stroke="var(--divider-strong)"
            strokeWidth={0.5}
          />
          <text x={Math.min(hover.x - 55, W - PAD_R - 125)} y={hover.y + 9} fontSize={10} fill={axisColor}>
            {formatLabel(hover.label, 16)}
          </text>
          <text x={Math.min(hover.x - 55, W - PAD_R - 125)} y={hover.y + 22} fontSize={9} fill={axisColor}>
            {formatLabel(hover.values, 22)}
          </text>
        </g>
      )}
    </svg>
  );
}

// ── 折线图 ──
function LineChart({
  rows,
  xCol,
  yCols,
  isDark,
}: {
  rows: Record<string, unknown>[];
  xCol: string;
  yCols: string[];
  isDark: boolean;
}) {
  const W = 680;
  const H = 300;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 50;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxVal = useMemo(() => {
    let m = 0;
    for (const r of rows) {
      for (const y of yCols) m = Math.max(m, toNum(r[y]));
    }
    return m > 0 ? m : 1;
  }, [rows, yCols]);

  const n = rows.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  const axisColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const gridColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const labelColor = "var(--fg3)";
  const lineColors = isDark
    ? yCols.map((_, i) => `rgba(255,255,255,${0.9 - i * 0.3})`)
    : yCols.map((_, i) => `rgba(0,0,0,${0.9 - i * 0.3})`);

  const gridFracs = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.floor(n / 8));

  // 构建每条线的 points
  const lines = yCols.map((y) => {
    const pts = rows.map((r, i) => ({
      x: PAD_L + i * stepX,
      y: PAD_T + plotH - (toNum(r[y]) / maxVal) * plotH,
    }));
    return { y, pts, color: lineColors[yCols.indexOf(y)] };
  });

  const pathD = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {gridFracs.map((f) => {
        const y = PAD_T + plotH - f * plotH;
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={gridColor} strokeWidth={1} />
            <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10} fill={axisColor}>
              {formatNum(maxVal * f)}
            </text>
          </g>
        );
      })}

      {lines.map((ln, li) => (
        <g key={ln.y}>
          <motion.path
            d={pathD(ln.pts)}
            fill="none"
            stroke={ln.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, delay: li * 0.15, ease: "easeInOut" }}
          />
          {ln.pts.map((p, pi) => (
            <motion.circle
              key={pi}
              cx={p.x}
              cy={p.y}
              r={2.5}
              fill={ln.color}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.5 + pi * 0.03 }}
            />
          ))}
        </g>
      ))}

      {rows.map((r, i) =>
        i % labelStep === 0 ? (
          <text
            key={i}
            x={PAD_L + i * stepX}
            y={H - PAD_B + 16}
            textAnchor="middle"
            fontSize={10}
            fill={axisColor}
          >
            {formatLabel(String(r[xCol] ?? ""))}
          </text>
        ) : null,
      )}

      {yCols.length > 1 && (
        <g transform={`translate(${PAD_L}, ${H - 14})`}>
          {yCols.map((y, yi) => (
            <g key={y} transform={`translate(${yi * 100}, 0)`}>
              <rect width={10} height={10} fill={lineColors[yi]} rx={2} />
              <text x={14} y={9} fontSize={10} fill={labelColor}>
                {formatLabel(y, 14)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// ── 饼图 ──
function PieChart({
  rows,
  xCol,
  yCol,
  isDark,
}: {
  rows: Record<string, unknown>[];
  xCol: string;
  yCol: string;
  isDark: boolean;
}) {
  const CX = 180;
  const CY = 150;
  const R = 100;

  const slices = useMemo(() => {
    const total = rows.reduce((s, r) => s + toNum(r[yCol]), 0);
    if (total <= 0) return [];
    let acc = 0;
    return rows.map((r, i) => {
      const v = toNum(r[yCol]);
      const frac = v / total;
      const a0 = acc * 2 * Math.PI - Math.PI / 2;
      acc += frac;
      const a1 = acc * 2 * Math.PI - Math.PI / 2;
      const largeArc = frac > 0.5 ? 1 : 0;
      const x0 = CX + R * Math.cos(a0);
      const y0 = CY + R * Math.sin(a0);
      const x1 = CX + R * Math.cos(a1);
      const y1 = CY + R * Math.sin(a1);
      const d = `M${CX},${CY} L${x0},${y0} A${R},${R} 0 ${largeArc} 1 ${x1},${y1} Z`;
      return { d, label: String(r[xCol] ?? ""), value: v, frac, idx: i };
    });
  }, [rows, xCol, yCol]);

  const labelColor = "var(--fg3)";
  const shades = isDark
    ? slices.map((_, i) => `rgba(255,255,255,${0.95 - i * 0.12})`)
    : slices.map((_, i) => `rgba(0,0,0,${0.95 - i * 0.12})`);

  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 360 300" style={{ width: 240, height: 200 }}>
        {slices.map((s, i) => (
          <motion.path
            key={i}
            d={s.d}
            fill={shades[i]}
            stroke={isDark ? "#1c1c1e" : "#fff"}
            strokeWidth={1}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            style={{ transformOrigin: `${CX}px ${CY}px` }}
          />
        ))}
      </svg>
      {/* 图例 */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span
              className="shrink-0"
              style={{ width: 10, height: 10, background: shades[i], borderRadius: 2 }}
            />
            <span className="truncate flex-1" style={{ color: labelColor }}>
              {formatLabel(s.label, 16)}
            </span>
            <span className="shrink-0 font-medium" style={{ color: "var(--fg2)" }}>
              {((s.frac || 0) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 面积图（面积折线，强调累积/趋势） ──
function AreaChart({
  rows,
  xCol,
  yCols,
  isDark,
}: {
  rows: Record<string, unknown>[];
  xCol: string;
  yCols: string[];
  isDark: boolean;
}) {
  const W = 680;
  const H = 300;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 50;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxVal = useMemo(() => {
    let m = 0;
    for (const r of rows) for (const y of yCols) m = Math.max(m, toNum(r[y]));
    return m > 0 ? m : 1;
  }, [rows, yCols]);

  const n = rows.length;
  const stepX = n > 1 ? plotW / (n - 1) : 0;

  const gridColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const labelColor = "var(--fg3)";
  const areaColors = isDark
    ? yCols.map((_, i) => `rgba(255,255,255,${0.35 - i * 0.12})`)
    : yCols.map((_, i) => `rgba(0,0,0,${0.35 - i * 0.12})`);
  const strokeColors = isDark
    ? yCols.map((_, i) => `rgba(255,255,255,${0.9 - i * 0.25})`)
    : yCols.map((_, i) => `rgba(0,0,0,${0.9 - i * 0.25})`);

  const gridFracs = [0, 0.25, 0.5, 0.75, 1];
  const labelStep = Math.max(1, Math.floor(n / 8));

  const lines = yCols.map((y, yi) => {
    const pts = rows.map((r, i) => ({
      x: PAD_L + i * stepX,
      y: PAD_T + plotH - (toNum(r[y]) / maxVal) * plotH,
    }));
    const linePath = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`)
      .join(" ");
    const areaPath =
      pts.length > 0
        ? `${linePath} L${pts[pts.length - 1].x},${PAD_T + plotH} L${pts[0].x},${PAD_T + plotH} Z`
        : "";
    return { y, linePath, areaPath, color: strokeColors[yi], fill: areaColors[yi], pts };
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {gridFracs.map((f) => {
        const y = PAD_T + plotH - f * plotH;
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={gridColor} strokeWidth={1} />
            <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10} fill={axisColor}>
              {formatNum(maxVal * f)}
            </text>
          </g>
        );
      })}

      {lines.map((ln, li) => (
        <g key={ln.y}>
          <motion.path
            d={ln.areaPath}
            fill={ln.fill}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: li * 0.1 }}
          />
          <motion.path
            d={ln.linePath}
            fill="none"
            stroke={ln.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.8, delay: li * 0.1, ease: "easeInOut" }}
          />
        </g>
      ))}

      {rows.map((r, i) =>
        i % labelStep === 0 ? (
          <text
            key={i}
            x={PAD_L + i * stepX}
            y={H - PAD_B + 16}
            textAnchor="middle"
            fontSize={10}
            fill={axisColor}
          >
            {formatLabel(String(r[xCol] ?? ""))}
          </text>
        ) : null,
      )}

      {yCols.length > 1 && (
        <g transform={`translate(${PAD_L}, ${H - 14})`}>
          {yCols.map((y, yi) => (
            <g key={y} transform={`translate(${yi * 100}, 0)`}>
              <rect width={10} height={10} fill={strokeColors[yi]} rx={2} />
              <text x={14} y={9} fontSize={10} fill={labelColor}>
                {formatLabel(y, 14)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// ── 散点图（双数值列相关性） ──
function ScatterChart({
  rows,
  xCol,
  yCols,
  isDark,
}: {
  rows: Record<string, unknown>[];
  xCol: string;
  yCols: string[];
  isDark: boolean;
}) {
  const W = 680;
  const H = 300;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 16;
  const PAD_B = 50;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const { maxX, maxY } = useMemo(() => {
    let mx = 0;
    let my = 0;
    for (const r of rows) {
      mx = Math.max(mx, toNum(r[xCol]));
      for (const y of yCols) my = Math.max(my, toNum(r[y]));
    }
    return { maxX: mx > 0 ? mx : 1, maxY: my > 0 ? my : 1 };
  }, [rows, xCol, yCols]);

  const gridColor = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const labelColor = "var(--fg3)";
  const pointColors = isDark
    ? yCols.map((_, i) => `rgba(255,255,255,${0.85 - i * 0.25})`)
    : yCols.map((_, i) => `rgba(0,0,0,${0.85 - i * 0.25})`);

  const gridFracs = [0, 0.25, 0.5, 0.75, 1];
  const [hover, setHover] = useState<{ x: number; y: number; label: string; value: string } | null>(null);

  const points = useMemo(() => {
    const out: { cx: number; cy: number; color: string; rowIdx: number; yCol: string; raw: Record<string, unknown> }[] = [];
    rows.forEach((r, i) => {
      const cx = PAD_L + (toNum(r[xCol]) / maxX) * plotW;
      yCols.forEach((y, yi) => {
        const cy = PAD_T + plotH - (toNum(r[y]) / maxY) * plotH;
        out.push({ cx, cy, color: pointColors[yi], rowIdx: i, yCol: y, raw: r });
      });
    });
    return out;
  }, [rows, xCol, yCols, maxX, maxY, pointColors]);

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ height: "auto" }}
      onMouseLeave={() => setHover(null)}
    >
      {gridFracs.map((f) => {
        const y = PAD_T + plotH - f * plotH;
        return (
          <g key={f}>
            <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={gridColor} strokeWidth={1} />
            <text x={PAD_L - 8} y={y + 3} textAnchor="end" fontSize={10} fill={axisColor}>
              {formatNum(maxY * f)}
            </text>
          </g>
        );
      })}

      {points.map((p, i) => (
        <motion.circle
          key={i}
          cx={p.cx}
          cy={p.cy}
          r={3.5}
          fill={p.color}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.3, delay: i * 0.005 }}
          style={{ cursor: "pointer" }}
          onMouseEnter={() => {
            const xv = String(p.raw[xCol] ?? "");
            const yv = String(p.raw[p.yCol] ?? "");
            setHover({ x: p.cx, y: p.cy, label: `${xCol}=${xv}, ${p.yCol}=${yv}`, value: yv });
          }}
        />
      ))}

      {hover && (
        <g pointerEvents="none">
          <rect
            x={hover.x + 8}
            y={hover.y - 18}
            width={Math.max(80, hover.label.length * 6 + 12)}
            height={20}
            rx={6}
            fill="var(--card)"
            opacity={0.92}
            stroke="var(--divider-strong)"
            strokeWidth={0.5}
          />
          <text x={hover.x + 14} y={hover.y - 4} fontSize={10} fill={axisColor}>
            {hover.label}
          </text>
        </g>
      )}

      <text x={PAD_L} y={H - PAD_B + 36} fontSize={10} fill={axisColor}>
        x: {xCol}
      </text>

      {yCols.length > 1 && (
        <g transform={`translate(${PAD_L}, ${H - 14})`}>
          {yCols.map((y, yi) => (
            <g key={y} transform={`translate(${yi * 100}, 0)`}>
              <rect width={10} height={10} fill={pointColors[yi]} rx={2} />
              <text x={14} y={9} fontSize={10} fill={labelColor}>
                {formatLabel(y, 14)}
              </text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

// ── 主组件 ──
export function ChartView({
  config,
  data,
  rowCount,
  currentType,
  onTypeChange,
  switchableTypes,
}: ChartViewProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const rows = (data || []).slice(0, 30); // 图表最多渲染 30 行避免拥挤

  // 实际渲染类型：受控（currentType）优先，否则回退 config.type
  const renderType = currentType || config.type;

  if (rows.length === 0) return null;

  // 数据适配性预检：bar/line/area/scatter 要求 y_columns 至少有一个数值列；
  // 不满足时回退到"无图表"占位，避免渲染异常
  const hasNumericY = config.y_columns.some((c) =>
    rows.some((r) => {
      const v = r[c];
      if (typeof v === "number") return true;
      if (typeof v === "string" && v.trim()) {
        return !isNaN(Number(v.replace(",", "")));
      }
      return false;
    }),
  );

  // 类型切换器：仅在提供 onTypeChange 且有可切换类型时显示
  const showTypeSwitcher =
    !!onTypeChange && (switchableTypes?.length ?? 0) > 1;
  const typeLabels: Record<ChartConfig["type"], string> = {
    bar: "Bar",
    line: "Line",
    area: "Area",
    pie: "Pie",
    scatter: "Scatter",
  };

  return (
    <div
      className="rounded-xl px-4 py-3"
      style={{
        background: "var(--surface-1)",
        border: "0.5px solid var(--divider-strong)",
        boxShadow: "var(--shadow-inset), var(--shadow-xs)",
        marginTop: "12px",
      }}
    >
      {/* 标题 + 意图标签 */}
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span
            className="font-text"
            style={{
              fontSize: "12px",
              fontWeight: 600,
              color: "var(--fg2)",
              letterSpacing: "0.01em",
            }}
          >
            {config.title || "Chart"}
          </span>
          {config.intent && (
            <span
              className="font-text"
              style={{
                fontSize: "10px",
                color: "var(--fg4)",
                background: "var(--surface-2)",
                padding: "1px 6px",
                borderRadius: 4,
                border: "0.5px solid var(--divider)",
              }}
            >
              {config.intent}
            </span>
          )}
        </div>
        {rowCount && rowCount > rows.length ? (
          <span
            className="font-text"
            style={{
              fontSize: "10px",
              color: "var(--fg4)",
            }}
          >
            Showing top {rows.length} of {rowCount} rows
          </span>
        ) : null}
      </div>

      {/* 后端给出的图表选择理由（帮助用户理解为何呈现此图） */}
      {config.reason && (
        <div
          className="font-text mb-2"
          style={{
            fontSize: "11px",
            color: "var(--fg3)",
            fontStyle: "italic",
          }}
        >
          {config.reason}
        </div>
      )}

      {/* 图表本体 */}
      {!hasNumericY ? (
        <div
          className="font-text"
          style={{
            fontSize: "11px",
            color: "var(--fg4)",
            padding: "24px 0",
            textAlign: "center",
          }}
        >
          No available numeric fields in data columns, cannot render {renderType} chart.
        </div>
      ) : (
        <>
          {renderType === "bar" && (
            <BarChart rows={rows} xCol={config.x_column} yCols={config.y_columns} isDark={isDark} />
          )}
          {renderType === "line" && (
            <LineChart rows={rows} xCol={config.x_column} yCols={config.y_columns} isDark={isDark} />
          )}
          {renderType === "area" && (
            <AreaChart rows={rows} xCol={config.x_column} yCols={config.y_columns} isDark={isDark} />
          )}
          {renderType === "scatter" && (
            <ScatterChart rows={rows} xCol={config.x_column} yCols={config.y_columns} isDark={isDark} />
          )}
          {renderType === "pie" && (
            <PieChart
              rows={rows}
              xCol={config.x_column}
              yCol={config.y_columns[0]}
              isDark={isDark}
            />
          )}
        </>
      )}

      {/* 图表类型切换器 */}
      {showTypeSwitcher && (
        <div
          className="flex items-center gap-1 mt-2 justify-end"
          style={{ paddingTop: 4 }}
        >
          {(switchableTypes || []).map((t) => {
            const active = t === renderType;
            return (
              <button
                key={t}
                type="button"
                onClick={() => onTypeChange!(t)}
                className={`chip-btn${active ? " chip-btn-active" : ""}`}
                style={{
                  fontSize: "10px",
                  fontWeight: 500,
                  padding: "3px 10px",
                  borderRadius: 980,
                }}
              >
                {typeLabels[t]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
