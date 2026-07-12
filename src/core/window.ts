const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

export type WindowName = string;

export type WindowSpec = {
  window: WindowName;
  anchor?: number;
};

const WINDOW_RE = /^(\d+)(h|day)$/;

/** One-shot / never-refills spend cap (all-time from epoch, or from key creation via totals). */
export function isLifetimeWindow(window: string): boolean {
  return window === "lifetime" || window === "total";
}

function parseDuration(window: string): number {
  if (isLifetimeWindow(window)) return Number.POSITIVE_INFINITY;
  const m = WINDOW_RE.exec(window);
  if (!m) throw new Error(`invalid window: ${window}`);
  const n = Number(m[1]);
  if (n <= 0) throw new Error(`invalid window: ${window}`);
  return m[2] === "h" ? n * HOUR_MS : n * DAY_MS;
}

export function windowDuration(spec: WindowSpec): number {
  return parseDuration(spec.window);
}

export function currentWindowStart(spec: WindowSpec, now: number): number {
  if (isLifetimeWindow(spec.window)) {
    // All-time: include every usage row (since 0). Anchor is ignored.
    return 0;
  }
  const dur = parseDuration(spec.window);
  if (spec.anchor === undefined) return Math.floor(now / dur) * dur;
  if (now <= spec.anchor) return spec.anchor;
  return spec.anchor + Math.floor((now - spec.anchor) / dur) * dur;
}

export function nextResetAt(spec: WindowSpec, windowStart: number): number {
  if (isLifetimeWindow(spec.window)) {
    // No reset — callers treat reset_in_ms === 0 + lifetime window as "never".
    return windowStart;
  }
  return windowStart + parseDuration(spec.window);
}

export { DAY_MS };
