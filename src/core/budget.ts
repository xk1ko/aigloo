/**
 * Scoped spend budgets, derived from the usage table (the single source of
 * truth) rather than a parallel counter. Each budget targets the whole gateway,
 * one provider, or one upstream model. statuses() computes every budget's spend
 * over its window; the result list is cached a few seconds so the per-request
 * hard-stop check stays cheap. blocks() answers "is a route to this
 * provider/model barred by an exhausted budget?".
 */
import type { Budget, BudgetScope } from "../config.js";
import { budgetKey } from "../config.js";
import { currentWindowStart, nextResetAt, isLifetimeWindow } from "./window.js";

export interface BudgetStatus {
  scope: BudgetScope;
  key: string;
  label: string;
  note?: string;
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  pct: number;
  alert: boolean;
  alert_at: number;
  exhausted: boolean;
  est_converse: number | null;
  /** 0 when window is lifetime (never refills). */
  reset_in_ms: number;
  window_start: number;
  window: Budget["window"];
  /** True when this budget never resets (all-time spend). */
  lifetime: boolean;
}

interface TotalsReader {
  totals(sinceMs: number, filter?: { provider?: string; model?: string; client_key?: string }): {
    tokens_in: number;
    tokens_out: number;
    cost: number;
  };
}

function scopeLabel(scope: BudgetScope, keyName: (fp: string) => string): string {
  if (scope.type === "global") return "Global";
  if (scope.type === "key") return keyName(scope.id);
  return scope.id;
}

function scopeFilter(scope: BudgetScope): { provider?: string; model?: string; client_key?: string } | undefined {
  if (scope.type === "provider") return { provider: scope.id };
  if (scope.type === "model") return { model: scope.id };
  if (scope.type === "key") return { client_key: scope.id };
  return undefined;
}

export class BudgetTracker {
  private cached?: { at: number; list: BudgetStatus[] };

  constructor(
    private readonly getBudgets: () => Budget[],
    private readonly db: TotalsReader,
    private readonly now: () => number = Date.now,
    private readonly cacheMs = 5000,
    private readonly keyName: (fp: string) => string = (fp) => `key …${fp}`,
  ) {}

  clearCache(): void {
    this.cached = undefined;
  }

  statuses(): BudgetStatus[] {
    const t = this.now();
    if (this.cached && t - this.cached.at < this.cacheMs) return this.cached.list;
    const list = this.getBudgets().map((b) => this.compute(b, t));
    this.cached = { at: t, list };
    return list;
  }

  globalStatus(): BudgetStatus | null {
    return this.statuses().find((s) => s.scope.type === "global") ?? null;
  }

  /** First exhausted provider/model budget matching a route, or null. */
  blocks(providerId: string, model: string): { exhausted: true; reset_in_ms: number } | null {
    for (const s of this.statuses()) {
      if (!s.exhausted) continue;
      if (s.scope.type === "provider" && s.scope.id === providerId)
        return { exhausted: true, reset_in_ms: s.reset_in_ms };
      if (s.scope.type === "model" && s.scope.id === model)
        return { exhausted: true, reset_in_ms: s.reset_in_ms };
    }
    return null;
  }

  /** The exhausted key-scoped budget for this fingerprint, or null. */
  blocksKey(fp: string): { exhausted: true; reset_in_ms: number } | null {
    for (const s of this.statuses()) {
      if (s.exhausted && s.scope.type === "key" && s.scope.id === fp) {
        return { exhausted: true, reset_in_ms: s.reset_in_ms };
      }
    }
    return null;
  }

  private compute(spec: Budget, t: number): BudgetStatus {
    const lifetime = isLifetimeWindow(spec.window);
    const windowStart = currentWindowStart(spec, t);
    const total = this.db.totals(windowStart, scopeFilter(spec.scope));
    const tokens = total.tokens_in + total.tokens_out;
    const cost = total.cost;
    const rate = tokens > 0 ? cost / tokens : undefined;
    const spent = spec.unit === "usd" ? cost : tokens;
    const limit = spec.limit;
    const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
    const alertAt = spec.alert_at ?? 0.8;
    const remaining = Math.max(0, limit - spent);
    const est_converse = rate === undefined ? null : spec.unit === "usd" ? remaining / rate : remaining * rate;
    return {
      scope: spec.scope,
      key: budgetKey(spec.scope),
      label: scopeLabel(spec.scope, this.keyName),
      note: spec.note,
      unit: spec.unit,
      limit,
      spent,
      pct,
      alert: pct >= alertAt,
      alert_at: alertAt,
      exhausted: spent >= limit,
      est_converse,
      reset_in_ms: lifetime ? 0 : Math.max(0, nextResetAt(spec, windowStart) - t),
      window_start: windowStart,
      window: lifetime ? "lifetime" : spec.window,
      lifetime,
    };
  }

  /**
   * Fire alerts for budgets that crossed their alert or exhausted threshold.
   * Dedup: one notification per scope per window — tracked in alert_state.
   * Fire-and-forget: the caller wraps this in setImmediate so it never blocks.
   */
  async checkAlerts(
    send: (payload: {
      type: "budget_alert" | "budget_exceeded";
      scope: string;
      label: string;
      message: string;
      spent: number;
      limit: number;
      unit: "usd" | "tokens";
      pct: number;
      note?: string;
    }) => Promise<void>,
    getAlertState: (scope: string) => { alerted_at: number; window_start: number } | null,
    setAlertState: (scope: string, alertedAt: number, windowStart: number) => void,
  ): Promise<void> {
    for (const s of this.statuses()) {
      if (!s.alert && !s.exhausted) continue;
      const existing = getAlertState(s.key);
      if (existing && existing.window_start === s.window_start) continue;

      const type = s.exhausted ? "budget_exceeded" : "budget_alert";
      const pctStr = Math.round(s.pct * 100);
      const spentStr = s.unit === "usd" ? `$${s.spent.toFixed(2)}` : `${s.spent.toLocaleString()} tokens`;
      const limitStr = s.unit === "usd" ? `$${s.limit.toFixed(2)}` : `${s.limit.toLocaleString()} tokens`;
      const message = `${s.label}: ${pctStr}% spent (${spentStr} / ${limitStr})${s.note ? ` — ${s.note}` : ""}`;

      await send({
        type,
        scope: s.key,
        label: s.label,
        message,
        spent: s.spent,
        limit: s.limit,
        unit: s.unit,
        pct: s.pct,
        note: s.note,
      });
      setAlertState(s.key, Date.now(), s.window_start);
    }
  }
}
