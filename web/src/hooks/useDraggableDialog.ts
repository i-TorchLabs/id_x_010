/**
 * 弹窗拖拽 hook
 *
 * 让 HeroUI 的 Modal / AlertDialog 支持鼠标(及触摸)拖拽移动:
 *  - 将返回的 handleProps 展开到 Modal.Header / AlertDialog.Header 上,
 *    标题栏即成为拖拽把手;
 *  - 通过 data-slot 向上找到弹窗根元素,用 CSS `translate` 属性做位移,
 *    与 HeroUI 入场动画使用的 `transform` 互不干扰;
 *  - 位移范围做了钳制,保证弹窗不会被完全拖出视口;
 *  - 弹窗关闭时内容 DOM 卸载,重新打开自动回到默认居中位置。
 *
 * 用法:
 *   const { handleProps } = useDraggableDialog();
 *   <Modal.Header {...handleProps}>...</Modal.Header>
 */

"use client";

import { useCallback, useRef } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

// Modal 与 AlertDialog 的弹窗根元素(HeroUI 渲染时标注的 data-slot)
const DIALOG_SELECTOR =
  '[data-slot="modal-dialog"], [data-slot="alert-dialog-dialog"]';

// 标题栏内的可交互元素不触发拖拽,避免吞掉点击
const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"]';

// 钳制时保证弹窗至少留在视口内的可见尺寸
const MIN_VISIBLE_X = 88;
const MIN_VISIBLE_TOP = 8;
const MIN_VISIBLE_BOTTOM = 48;

interface DragState {
  el: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  baseX: number;
  baseY: number;
  minDx: number;
  maxDx: number;
  minDy: number;
  maxDy: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export interface DraggableDialogHandleProps {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  style: CSSProperties;
}

export function useDraggableDialog(): {
  handleProps: DraggableDialogHandleProps;
} {
  const dragRef = useRef<DragState | null>(null);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // 仅主键(左键/单指触摸),且不处于拖拽中
      if (e.button !== 0 || dragRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;

      const handle = e.currentTarget as HTMLElement;
      const el = handle.closest<HTMLElement>(DIALOG_SELECTOR);
      if (!el) return;

      // 当前累计位移存在 dataset 上,随弹窗 DOM 卸载自然复位
      const baseX = parseFloat(el.dataset.dragX ?? "0") || 0;
      const baseY = parseFloat(el.dataset.dragY ?? "0") || 0;
      const rect = el.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      dragRef.current = {
        el,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        baseX,
        baseY,
        // rect 已含当前位移,约束的是本次拖拽的增量
        minDx: MIN_VISIBLE_X - rect.right,
        maxDx: vw - MIN_VISIBLE_X - rect.left,
        minDy: MIN_VISIBLE_TOP - rect.top,
        maxDy: vh - MIN_VISIBLE_BOTTOM - rect.top,
      };
      handle.setPointerCapture(e.pointerId);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const s = dragRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      const dx = clamp(e.clientX - s.startX, s.minDx, s.maxDx);
      const dy = clamp(e.clientY - s.startY, s.minDy, s.maxDy);
      const x = s.baseX + dx;
      const y = s.baseY + dy;
      s.el.dataset.dragX = String(x);
      s.el.dataset.dragY = String(y);
      // 直接写 DOM,避免高频 setState;translate 与 transform 独立叠加
      s.el.style.translate = `${x}px ${y}px`;
    },
    [],
  );

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const s = dragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    dragRef.current = null;
    const handle = e.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(e.pointerId)) {
      handle.releasePointerCapture(e.pointerId);
    }
  }, []);

  return {
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      style: {
        cursor: "move",
        touchAction: "none",
        userSelect: "none",
      },
    },
  };
}
