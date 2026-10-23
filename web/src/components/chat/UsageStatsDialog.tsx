/**
 * 流量统计弹窗
 *
 * 展示当前用户近 N 天的用量：
 *  - 顶部三张汇总卡片（请求次数 / 总 token / 花费 USD）
 *  - 中部手绘 SVG 柱状图（按日聚合，可在 Tokens / 花费 两个指标间切换）
 *  - 底部按模型维度的明细列表（调用次数 / token / 花费 + 相对占比条）
 *
 * 数据来源：usageGraphqlApi.getUsageStats —— 后端 stream_chat 结束时落库
 * usage_logs 行，按 user_id + created_at 聚合。
 */

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { motion } from "framer-motion";
import { useTheme } from "@/context/ThemeContext";
import { useI18n } from "@/context/I18nContext";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import {
  usageGraphqlApi,
  type UsageDailyItem,
  type UsageModelBreakdownItem,
} from "@/api/graphql";

type Metric = "tokens" | "cost";

const RANGE_OPTIONS: { value: number; label: string }[] = [
  { value: 7, label: "usage.range7d" },
  { value: 30, label: "usage.range30d" },
  { value: 90, label: "usage.range90d" },
];

interface StatsData {
  days: number;
  daily: UsageDailyItem[];
  byModel: UsageModelBreakdownItem[];
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
}

// ── 数字格式化 ──
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatCost(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(3)}`;
  // 极小金额：保留约 2 位有效数字并去掉尾随 0，避免输出一长串零
  const digits = Math.min(6, Math.max(3, 2 - Math.floor(Math.log10(n))));
  const trimmed = parseFloat(n.toFixed(digits));
  return trimmed > 0 ? `$${trimmed}` : "<$0.000001";
}

// Y 轴费用刻度：根据最大值确定统一的小数位，保证 5 个刻度格式一致
function costAxisDecimals(maxV: number): number {
  if (maxV >= 10) return 0;
  if (maxV >= 1) return 1;
  if (maxV >= 0.1) return 2;
  if (maxV >= 0.01) return 3;
  if (maxV >= 0.001) return 4;
  return 5;
}

function formatDateLabel(dateStr: string): string {
  // dateStr 形如 "2026-10-04" -> "10-04"
  const parts = dateStr.split("-");
  if (parts.length >= 3) return `${parts[1]}-${parts[2]}`;
  return dateStr;
}

// ── 柱状图（手绘 SVG，framer-motion 动画）──
const CHART_W = 960;
const CHART_H = 300;
const PAD_L = 62;
const PAD_R = 16;
const PAD_T = 18;
const PAD_B = 36;
const PLOT_W = CHART_W - PAD_L - PAD_R;
const PLOT_H = CHART_H - PAD_T - PAD_B;

function BarChart({
  daily,
  metric,
  isDark,
}: {
  daily: UsageDailyItem[];
  metric: Metric;
  isDark: boolean;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { t } = useI18n();

  const values = useMemo(
    () =>
      daily.map((d) =>
        metric === "tokens" ? d.totalTokens : d.costUsd,
      ),
    [daily, metric],
  );

  // 原始最大值：为 0 说明该区间内没有任何用量/费用，单独渲染空态而不是伪造 $1 刻度
  const maxRaw = useMemo(() => Math.max(...values, 0), [values]);
  const maxV = maxRaw > 0 ? maxRaw : 1;

  const n = daily.length;
  const slot = n > 0 ? PLOT_W / n : PLOT_W;
  const barW = Math.min(slot * 0.7, 38);

  // Y 轴 4 档刻度：费用按 maxV 统一小数位；tokens 取整避免出现小数刻度
  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const costDecimals = costAxisDecimals(maxV);
  const yLabel = (f: number) =>
    metric === "tokens"
      ? formatTokens(Math.round(maxV * f))
      : `$${(maxV * f).toFixed(costDecimals)}`;

  // X 轴标签：均匀取 ~6 个
  const labelStep = Math.max(1, Math.floor(n / 6));

  const axisColor = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.45)";
  const gridColor = isDark
    ? "rgba(255,255,255,0.10)"
    : "rgba(0,0,0,0.08)";
  const labelColor = "var(--fg3)";

  if (n === 0 || maxRaw <= 0) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ height: CHART_H, color: labelColor, fontSize: "13px" }}
      >
        {n === 0
          ? t("usage.emptyChart")
          : metric === "cost"
            ? t("usage.zeroCostChart")
            : t("usage.emptyChart")}
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full"
      style={{ height: "auto", display: "block" }}
      role="img"
      aria-label={t("usage.ariaBarChart")}
    >
      {/* 网格线 + Y 轴标签 */}
      {gridFractions.map((f) => {
        const y = PAD_T + PLOT_H - f * PLOT_H;
        return (
          <g key={f}>
            <line
              x1={PAD_L}
              y1={y}
              x2={CHART_W - PAD_R}
              y2={y}
              stroke={gridColor}
              strokeWidth={1}
            />
            <text
              x={PAD_L - 8}
              y={y + 3}
              textAnchor="end"
              fontSize={10}
              fill={axisColor}
            >
              {yLabel(f)}
            </text>
          </g>
        );
      })}

      {/* 柱子 */}
      {daily.map((d, i) => {
        const v = values[i];
        const barH = v <= 0 ? 0 : (v / maxV) * PLOT_H;
        const x = PAD_L + i * slot + (slot - barW) / 2;
        const y = PAD_T + PLOT_H - barH;
        const isHovered = hovered === i;
        return (
          <g
            key={d.date}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: "pointer" }}
          >
            {/* 透明命中区域，便于悬停 */}
            <rect
              x={PAD_L + i * slot}
              y={PAD_T}
              width={slot}
              height={PLOT_H}
              fill="transparent"
            />
            {v > 0 && (
              <motion.rect
                x={x}
                width={barW}
                rx={2}
                initial={{ height: 0, y: PAD_T + PLOT_H }}
                animate={{ height: barH, y }}
                transition={{ duration: 0.5, delay: i * 0.012, ease: "easeOut" }}
                fill={isHovered ? "var(--accent)" : "var(--accent)"}
                opacity={isHovered ? 1 : 0.82}
              />
            )}

            {/* X 轴日期标签 */}
            {i % labelStep === 0 && (
              <text
                x={PAD_L + i * slot + slot / 2}
                y={CHART_H - PAD_B + 18}
                textAnchor="middle"
                fontSize={10}
                fill={axisColor}
              >
                {formatDateLabel(d.date)}
              </text>
            )}

            {/* 悬停 tooltip */}
            {isHovered && (
              <g pointerEvents="none">
                {(() => {
                  // 先生成文案再按长度估算气泡宽度，避免费用长文本溢出
                  const line2 =
                    metric === "tokens"
                      ? `${formatTokens(d.totalTokens)} · ${d.requestCount}`
                      : `${formatCost(d.costUsd)} · ${formatTokens(d.totalTokens)}`;
                  const tipW = Math.max(
                    104,
                    line2.length * 7 + 20,
                    d.date.length * 6 + 20,
                  );
                  const tx = Math.min(
                    Math.max(x + barW / 2, PAD_L + tipW / 2),
                    CHART_W - PAD_R - tipW / 2,
                  );
                  const ty = Math.max(y - 8, PAD_T + 30);
                  return (
                    <>
                      <rect
                        x={tx - tipW / 2}
                        y={ty - 26}
                        width={tipW}
                        height={36}
                        rx={6}
                        fill={isDark ? "#2c2c2e" : "#ffffff"}
                        stroke={gridColor}
                        strokeWidth={1}
                      />
                      <text
                        x={tx}
                        y={ty - 12}
                        textAnchor="middle"
                        fontSize={10}
                        fill={axisColor}
                      >
                        {d.date}
                      </text>
                      <text
                        x={tx}
                        y={ty + 3}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="var(--fg)"
                      >
                        {line2}
                      </text>
                    </>
                  );
                })()}
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ── 汇总卡片 ──
function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="rounded-xl px-3.5 py-3"
      style={{
        background: "var(--card)",
        border: "0.5px solid var(--divider-strong)",
        boxShadow: "var(--shadow-inset), var(--shadow-xs)",
      }}
    >
      <div
        className="font-text"
        style={{
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--fg3)",
        }}
      >
        {label}
      </div>
      <div
        className="font-display mt-1 leading-tight"
        style={{ fontSize: "20px", fontWeight: 600, color: "var(--fg)" }}
      >
        {value}
      </div>
      {sub && (
        <div
          className="font-text mt-0.5"
          style={{ fontSize: "11px", color: "var(--fg3)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

// ── 主弹窗 ──
interface UsageStatsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UsageStatsDialog({ isOpen, onOpenChange }: UsageStatsDialogProps) {
  const { theme } = useTheme();
  const { t } = useI18n();
  const { handleProps: dragHandleProps } = useDraggableDialog();
  const isDark = theme === "dark";

  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>("tokens");
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await usageGraphqlApi.getUsageStats(d);
      const s = res.usageStats;
      if (!s.success) {
        setError(s.message);
        setData(null);
      } else {
        setData({
          days: s.days,
          daily: s.daily,
          byModel: s.byModel,
          totalRequests: s.totalRequests,
          totalTokens: s.totalTokens,
          totalCostUsd: s.totalCostUsd,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("usage.errorLoadFailed"));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void load(days);
    }
  }, [isOpen, days, load]);

  // 模型明细占比条：优先按费用占比；全部模型费用为 0（如免费模型）时退化为按 token 占比
  const modelRatio = useMemo(() => {
    const models = data?.byModel ?? [];
    const maxCost = Math.max(...models.map((m) => m.costUsd), 0);
    if (maxCost > 0) {
      return (m: UsageModelBreakdownItem) => m.costUsd / maxCost;
    }
    const maxTokens = Math.max(...models.map((m) => m.totalTokens), 0);
    if (maxTokens > 0) {
      return (m: UsageModelBreakdownItem) => m.totalTokens / maxTokens;
    }
    return () => 0;
  }, [data]);

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container>
        <Modal.Dialog className="sm:max-w-[1040px]">
          <Modal.CloseTrigger />
          <Modal.Header {...dragHandleProps}>
            <Modal.Heading>{t("usage.modalTitle")}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>
            {/* 时间范围 + 指标切换 */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-1">
                {RANGE_OPTIONS.map((opt) => {
                  const selected = days === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setDays(opt.value)}
                      className={`chip-btn rounded-full px-3 py-1 text-xs font-medium${selected ? " chip-btn-active" : ""}`}
                    >
                      {t(opt.label)}
                    </button>
                  );
                })}
              </div>

              <div
                className="flex items-center gap-1 rounded-full p-0.5"
                style={{
                  border: "0.5px solid var(--divider)",
                  background: "var(--card)",
                  boxShadow: "var(--shadow-inset), var(--shadow-xs)",
                }}
              >
                {(["tokens", "cost"] as Metric[]).map((m) => {
                  const selected = metric === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMetric(m)}
                      className="rounded-full px-3 py-1 text-xs font-medium"
                      style={{
                        background: selected ? "var(--accent)" : "transparent",
                        color: selected ? "var(--accent-fg)" : "var(--fg3)",
                        boxShadow: selected ? "var(--shadow-sm)" : "none",
                        cursor: "pointer",
                        transition:
                          "background-color 180ms ease, color 180ms ease, box-shadow 180ms ease",
                      }}
                      onMouseEnter={(e) => {
                        if (!selected)
                          e.currentTarget.style.color = "var(--fg1)";
                      }}
                      onMouseLeave={(e) => {
                        if (!selected)
                          e.currentTarget.style.color = "var(--fg3)";
                      }}
                    >
                      {m === "tokens" ? t("usage.metricTokens") : t("usage.metricCost")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 汇总卡片 */}
            {loading && !data ? (
              <p className="text-sm py-8 text-center" style={{ color: "var(--fg3)" }}>
                {t("usage.loading")}
              </p>
            ) : error ? (
              <div
                className="text-sm rounded-lg px-3 py-2"
                style={{
                  background: "var(--error-bg)",
                  border: "0.5px solid var(--error-border)",
                  color: "var(--error)",
                }}
              >
                {error}
              </div>
            ) : data ? (
              <>
                <div className="grid grid-cols-3 gap-2.5">
                  <StatCard
                    label={t("usage.cardRequests")}
                    value={formatTokens(data.totalRequests)}
                    sub={t("usage.cardRequestsSub", { days: data.days })}
                  />
                  <StatCard
                    label={t("usage.cardTokenUsage")}
                    value={formatTokens(data.totalTokens)}
                    sub={
                      data.daily.length > 0
                        ? t("usage.cardTokenUsageSub", {
                            avg: formatTokens(
                              Math.round(data.totalTokens / data.days),
                            ),
                          })
                        : undefined
                    }
                  />
                  <StatCard
                    label={t("usage.cardCost")}
                    value={formatCost(data.totalCostUsd)}
                    sub={t("usage.cardCostSub")}
                  />
                </div>

                {/* 柱状图 */}
                <div
                  className="rounded-xl px-3 pt-3 pb-1"
                  style={{
                    background: "var(--card)",
                    border: "0.5px solid var(--divider-strong)",
                    boxShadow: "var(--shadow-inset), var(--shadow-xs)",
                  }}
                >
                  <div
                    className="font-text mb-1 px-1"
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--fg3)",
                    }}
                  >
                    {metric === "tokens" ? t("usage.chartTitleTokens") : t("usage.chartTitleCost")}
                  </div>
                  <BarChart daily={data.daily} metric={metric} isDark={isDark} />
                </div>

                {/* 按模型明细 */}
                <div>
                  <div
                    className="font-text mb-2 px-1"
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      color: "var(--fg3)",
                    }}
                  >
                    {t("usage.modelBreakdownSection")}
                  </div>
                  {data.byModel.length === 0 ? (
                    <p
                      className="text-xs py-4 text-center"
                      style={{ color: "var(--fg3)" }}
                    >
                      {t("usage.noModelUsage")}
                    </p>
                  ) : (
                    <div
                      className="rounded-xl overflow-hidden"
                      style={{
                        border: "0.5px solid var(--divider-strong)",
                        boxShadow: "var(--shadow-inset), var(--shadow-xs)",
                      }}
                    >
                      {data.byModel.map((m, i) => {
                        const ratio = modelRatio(m);
                        return (
                          <div
                            key={`${m.modelName}-${i}`}
                            className="flex items-center gap-3 px-3 py-2.5"
                            style={{
                              borderTop:
                                i === 0 ? "none" : "0.5px solid var(--divider)",
                              background: "var(--card)",
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div
                                className="font-text truncate"
                                style={{
                                  fontSize: "13px",
                                  fontWeight: 500,
                                  color: "var(--fg)",
                                }}
                              >
                                {m.modelName}
                              </div>
                              <div
                                className="mt-1 h-1 rounded-full overflow-hidden"
                                style={{ background: "var(--divider)" }}
                              >
                                <motion.div
                                  className="h-full rounded-full"
                                  style={{ background: "var(--accent)" }}
                                  initial={{ width: 0 }}
                                  animate={{ width: `${ratio * 100}%` }}
                                  transition={{
                                    duration: 0.5,
                                    ease: "easeOut",
                                  }}
                                />
                              </div>
                            </div>
                            <div
                              className="font-text text-right shrink-0"
                              style={{ fontSize: "12px", color: "var(--fg3)" }}
                            >
                              <div style={{ color: "var(--fg)" }}>
                                {formatTokens(m.totalTokens)} token
                              </div>
                              <div className="mt-0.5">
                                {m.requestCount} · {formatCost(m.costUsd)}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </Modal.Body>
          <Modal.Footer>
            <Button slot="close" variant="tertiary">
              {t("usage.close")}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
