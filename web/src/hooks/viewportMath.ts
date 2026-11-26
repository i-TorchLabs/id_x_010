/** 视口比例缩放共用数学（认证页 / 工作台同源节奏） */

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/** easeOutCubic：接近设计态时变化放缓 */
export function easeOutCubic(t: number) {
  const x = clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}

/**
 * 由原始适配比推导字号轨 / 间距轨。
 * 矮/窄窗优先压缩留白，字形变化更克制。
 */
export function splitTypeSpaceScale(
  raw: number,
  opts?: { typeMin?: number; spaceMin?: number; max?: number },
) {
  const typeMin = opts?.typeMin ?? 0.88;
  const spaceMin = opts?.spaceMin ?? 0.72;
  const max = opts?.max ?? 1;
  const t = clamp((raw - spaceMin) / (max - spaceMin || 1), 0, 1);
  const eased = easeOutCubic(t);
  return {
    raw: clamp(raw, spaceMin, max),
    eased,
    typeScale: lerp(typeMin, 1, eased),
    spaceScale: lerp(spaceMin, 1, eased),
  };
}
