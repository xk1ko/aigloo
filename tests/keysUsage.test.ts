import { describe, it, expect } from "vitest";
import { buildKeyUsageRow } from "../src/core/keysUsage.js";
import type { BudgetStatus } from "../src/core/budget.js";

const baseBudget: BudgetStatus = {
  scope: { type: "key", id: "abcd1234" },
  key: "key:abcd1234",
  label: "Huki",
  unit: "usd",
  limit: 600,
  spent: 24,
  pct: 0.04,
  alert: false,
  alert_at: 0.8,
  exhausted: false,
  est_converse: null,
  reset_in_ms: 888_000,
  window_start: 0,
  window: "30day",
  lifetime: false,
};

describe("buildKeyUsageRow", () => {
  it("capped key: carries the budget view + all-time spend/tokens", () => {
    const row = buildKeyUsageRow({
      fingerprint: "abcd1234",
      name: "Huki",
      masked: "sk-…1234",
      expires: 1_700_000_000_000,
      totals: { tokens_in: 100, tokens_out: 50, cost: 24 },
      budget: baseBudget,
    });
    expect(row.spent).toBe(24);
    expect(row.tokens).toBe(150);
    expect(row.expires).toBe(1_700_000_000_000);
    expect(row.budget).toEqual({
      unit: "usd", limit: 600, spent: 24, pct: 0.04,
      window: "30day", reset_in_ms: 888_000, exhausted: false, alert: false, lifetime: false,
    });
  });

  it("uncapped key: budget is null, spend still reported", () => {
    const row = buildKeyUsageRow({
      fingerprint: "ffff9999",
      name: "Me",
      masked: "sk-…9999",
      totals: { tokens_in: 1000, tokens_out: 2000, cost: 312.5 },
      budget: null,
    });
    expect(row.budget).toBeNull();
    expect(row.spent).toBe(312.5);
    expect(row.tokens).toBe(3000);
    expect(row.expires).toBeUndefined();
  });
});
