"use client";

/**
 * 后台管理表格的统一分页 + 滚动容器。
 *
 * - PAGE_SIZE = 16：每页固定 16 条记录（4 个页签共用）；
 * - usePagedList(items)：切片当前页数据 + 翻页控制（数据变更时自动收敛页码）；
 * - <PagedTableShell>：表格外壳，tbody 区域限制 maxHeight 并支持鼠标滚轮
 *   上下滚动（sticky 表头），底部带 上一页/下一页 + 页码信息条。
 *
 * 纯前端分页——各页签的 GraphQL 查询仍一次拉全量（管理端数据量级
 * 通常是几十到几百条，无翻页开销），前端按 16 条/页切片展示。
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/react";
import { useI18n } from "@/context/I18nContext";

export const PAGE_SIZE = 16;

/**
 * 列表分页 hook。
 *
 * @param items 当前页签的全量数据（state 变化即重新切片）
 * @returns { page, setPage, pageCount, paged, total }
 *   - paged：当前页的切片（page 越界时自动收敛到最后一个有效页）
 *   - pageCount：总页数，至少为 1（空数据时 0 条 / 1 页，渲染空态）
 */
export function usePagedList<T>(items: T[]) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));

  // 数据刷新 / 删除后当前页可能越界（如最后一页唯一一条被删），
  // 自动收敛到最后一个有效页，避免展示空页
  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const paged = useMemo(
    () => items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [items, page],
  );

  return { page, setPage, pageCount, paged, total: items.length };
}

/**
 * 分页表格外壳。
 *
 * props:
 * - pagedRows    ：当前页的行（仅用于空态判断与行数展示）
 * - page/setPage/pageCount/total：usePagedList 的返回值
 * - colCount     ：列数（空态 colSpan 用）
 * - emptyText    ：空态文案
 * - maxHeight    ：滚动区最大高度（默认 560px ≈ 16 行 × 35px）
 * - children     ：thead + tbody（调用方照常写 table 内容）
 */
export function PagedTableShell<T>({
  pagedRows,
  page,
  setPage,
  pageCount,
  total,
  colCount,
  emptyText,
  maxHeight,
  children,
}: {
  pagedRows: T[];
  page: number;
  setPage: (p: number) => void;
  pageCount: number;
  total: number;
  colCount: number;
  emptyText: string;
  maxHeight?: number | string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  // 默认随视口 --wb-table-max-h；调用方可显式覆盖
  const resolvedMaxH = maxHeight ?? "var(--wb-table-max-h, 560px)";

  return (
    <div style={{ background: "var(--surface-1)", border: "0.5px solid var(--divider)", borderRadius: 12, overflow: "hidden" }}>
      {/* 滚动容器：tbody 超出 maxHeight 时鼠标滚轮上下滚动；表头 sticky 固定 */}
      <div
        style={{
          maxHeight: resolvedMaxH,
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarGutter: "stable",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          {children}
          {pagedRows.length === 0 && (
            <tbody>
              <tr>
                <td colSpan={colCount} style={{ padding: 24, textAlign: "center", color: "var(--fg3)" }}>
                  {emptyText}
                </td>
              </tr>
            </tbody>
          )}
        </table>
      </div>

      {/* 分页条：多于一页时展示（单页全部可见时隐藏，减少视觉噪音） */}
      {pageCount > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8,
          padding: "8px 12px", borderTop: "0.5px solid var(--divider)",
          background: "var(--surface-2)", fontSize: 12, color: "var(--fg3)",
        }}>
          <span>
            {t("admin.pageInfo", { page, total: pageCount, count: total })}
          </span>
          <Button
            size="sm" variant="ghost" isDisabled={page <= 1}
            onPress={() => setPage(Math.max(1, page - 1))}
          >
            {t("admin.pagePrev")}
          </Button>
          <Button
            size="sm" variant="ghost" isDisabled={page >= pageCount}
            onPress={() => setPage(Math.min(pageCount, page + 1))}
          >
            {t("admin.pageNext")}
          </Button>
        </div>
      )}
    </div>
  );
}
