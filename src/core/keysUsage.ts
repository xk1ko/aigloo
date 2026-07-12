/**
 * Shapes one row for the Budgets page "Keys" section: a gateway key joined with
 * its all-time spend/tokens, optional expiry, and its key-scoped budget status
 * (null when the key is uncapped). Pure — the admin route feeds it real data.
 */
import type { BudgetStatus } from "./budget.js";

export interface KeyBudgetView {
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  pct: number;
  window: BudgetStatus["window"];
  reset_in_ms: number;
  exhausted: boolean;
  alert: boolean;
  lifetime?: boolean;
}

export interface KeyUsageRow {
  fingerprint: string;
  name: string;
  masked: string;
  expires?: number;
  spent: number;
  tokens: number;
  budget: KeyBudgetView | null;
}

export function buildKeyUsageRow(input: {
  fingerprint: string;
  name: string;
  masked: string;
  expires?: number;
  totals: { tokens_in: number; tokens_out: number; cost: number };
  budget: BudgetStatus | null;
}): KeyUsageRow {
  const b = input.budget;
  return {
    fingerprint: input.fingerprint,
    name: input.name,
    masked: input.masked,
    expires: input.expires,
    spent: input.totals.cost,
    tokens: input.totals.tokens_in + input.totals.tokens_out,
    budget: b
      ? {
          unit: b.unit,
          limit: b.limit,
          spent: b.spent,
          pct: b.pct,
          window: b.window,
          reset_in_ms: b.reset_in_ms,
          exhausted: b.exhausted,
          alert: b.alert,
          lifetime: b.lifetime,
        }
      : null,
  };
}
