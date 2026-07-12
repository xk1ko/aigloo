import { describe, it, expect } from "vitest";
import { BudgetTracker } from "../src/core/budget.js";
import type { Budget } from "../src/config.js";

// fake totals reader: returns fixed numbers, records the last filter it saw.
function fakeDb(map: (filter?: { provider?: string; model?: string }) => { tokens_in: number; tokens_out: number; cost: number }) {
  return { totals: (_since: number, filter?: { provider?: string; model?: string }) => map(filter) };
}

const DAY = 24 * 3600_000;

const B = (over: Partial<Budget> & { scope: Budget["scope"] }): Budget =>
  ({ unit: "usd", limit: 10, window: "30day", ...over });

describe("BudgetTracker (scoped)", () => {
  it("returns [] when no budgets are configured", () => {
    const t = new BudgetTracker(() => [], fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })));
    expect(t.statuses()).toEqual([]);
    expect(t.globalStatus()).toBeNull();
  });

  it("computes one status per budget with scope/key/label", () => {
    const budgets = [
      B({ scope: { type: "global" }, limit: 100, unit: "usd" }),
      B({ scope: { type: "provider", id: "openai" }, limit: 20, unit: "usd" }),
    ];
    const t = new BudgetTracker(() => budgets, fakeDb(() => ({ tokens_in: 600, tokens_out: 400, cost: 10 })), () => 0);
    const s = t.statuses();
    expect(s.map((x) => x.key)).toEqual(["global", "provider:openai"]);
    expect(s[0]!.label).toBe("Global");
    expect(s[1]!.label).toBe("openai");
    expect(s[1]!.pct).toBeCloseTo(0.5); // $10 / $20
  });

  it("globalStatus returns the global budget independent of scoped ones", () => {
    const budgets = [B({ scope: { type: "provider", id: "openai" }, limit: 5, unit: "usd" }), B({ scope: { type: "global" }, limit: 100, unit: "usd" })];
    const t = new BudgetTracker(() => budgets, fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 3 })), () => 0);
    expect(t.globalStatus()!.scope).toEqual({ type: "global" });
  });

  it("blocks() reports an exhausted provider budget and ignores a healthy one", () => {
    const budgets = [B({ scope: { type: "provider", id: "openai" }, limit: 5, unit: "usd" })];
    // openai spent $6 (exhausted); anything else $0
    const t = new BudgetTracker(
      () => budgets,
      fakeDb((f) => (f?.provider === "openai" ? { tokens_in: 0, tokens_out: 0, cost: 6 } : { tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => 0,
    );
    expect(t.blocks("openai", "gpt-4o")).not.toBeNull();
    expect(t.blocks("openai", "gpt-4o")!.exhausted).toBe(true);
    expect(t.blocks("anthropic", "claude-opus-4-6")).toBeNull();
  });

  it("blocks() matches an exhausted model budget", () => {
    const budgets = [B({ scope: { type: "model", id: "claude-opus-4-6" }, limit: 5, unit: "usd" })];
    const t = new BudgetTracker(
      () => budgets,
      fakeDb((f) => (f?.model === "claude-opus-4-6" ? { tokens_in: 0, tokens_out: 0, cost: 9 } : { tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => 0,
    );
    expect(t.blocks("anthropic", "claude-opus-4-6")!.exhausted).toBe(true);
    expect(t.blocks("anthropic", "claude-sonnet-4-6")).toBeNull();
  });

  it("token-unit budget: est_converse is the usd estimate; null when no tokens", () => {
    const withTokens = new BudgetTracker(() => [B({ scope: { type: "global" }, unit: "tokens", limit: 1000 })], fakeDb(() => ({ tokens_in: 500, tokens_out: 300, cost: 4 })), () => 0);
    expect(withTokens.statuses()[0]!.est_converse).toBeCloseTo(1); // rate 0.005 * 200 remaining tokens
    const noTokens = new BudgetTracker(() => [B({ scope: { type: "global" }, unit: "usd", limit: 10 })], fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })), () => 0);
    expect(noTokens.statuses()[0]!.est_converse).toBeNull();
  });

  it("alert_at resolves to the spec value or defaults to 0.8", () => {
    const custom = new BudgetTracker(
      () => [B({ scope: { type: "global" }, limit: 100, unit: "usd", alert_at: 0.95 })],
      fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => 0,
    );
    expect(custom.statuses()[0]!.alert_at).toBe(0.95);

    const defaulted = new BudgetTracker(
      () => [B({ scope: { type: "global" }, limit: 100, unit: "usd" })],
      fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => 0,
    );
    expect(defaulted.statuses()[0]!.alert_at).toBe(0.8);
  });

  it("caches the status list within cacheMs", () => {
    let calls = 0;
    const db = { totals: () => { calls++; return { tokens_in: 0, tokens_out: 0, cost: 1 }; } };
    let now = 0;
    const t = new BudgetTracker(() => [B({ scope: { type: "global" }, unit: "usd", limit: 10 })], db, () => now, 5000);
    t.statuses(); t.statuses();
    expect(calls).toBe(1);
    now = 6000; t.statuses();
    expect(calls).toBe(2);
  });

  it("key scope: filters by client_key, labels via the resolver, blocksKey matches", () => {
    const fp = "abcd1234";
    const tracker = new BudgetTracker(
      () => [B({ scope: { type: "key", id: fp }, unit: "usd", limit: 5 })],
      // exhausted only for this key's filter
      { totals: (_s: number, f?: { provider?: string; model?: string; client_key?: string }) =>
          f?.client_key === fp ? { tokens_in: 0, tokens_out: 0, cost: 6 } : { tokens_in: 0, tokens_out: 0, cost: 0 } },
      () => 0,
      5000,
      (x) => (x === fp ? "device A" : `key …${x}`),
    );
    const s = tracker.statuses()[0]!;
    expect(s.scope).toEqual({ type: "key", id: fp });
    expect(s.label).toBe("device A");
    expect(s.exhausted).toBe(true);
    expect(tracker.blocksKey(fp)!.exhausted).toBe(true);
    expect(tracker.blocksKey("ffff9999")).toBeNull();
  });

  it("reset_in_ms counts down within the anchored cycle", () => {
    const anchor = 0;
    const now = 3 * DAY; // 3 days into a 30day cycle anchored at 0
    const t = new BudgetTracker(
      () => [B({ scope: { type: "global" }, window: "30day", anchor })],
      fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => now,
    );
    expect(t.statuses()[0]!.reset_in_ms).toBe(30 * DAY - 3 * DAY);
  });

  it("legacy budget without an anchor uses the epoch grid", () => {
    const dur = 30 * DAY;
    const now = 5 * dur + 2 * DAY; // 2 days into an epoch-grid 30day bucket
    const t = new BudgetTracker(
      () => [B({ scope: { type: "global" }, window: "30day" })], // no anchor
      fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => now,
    );
    expect(t.statuses()[0]!.reset_in_ms).toBe(dur - 2 * DAY);
  });

  it("surfaces the optional note in the status", () => {
    const withNote = new BudgetTracker(
      () => [B({ scope: { type: "global" }, unit: "usd", limit: 10, note: "team A cap" })],
      fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })),
      () => 0,
    );
    expect(withNote.statuses()[0]!.note).toBe("team A cap");
    const noNote = new BudgetTracker(() => [B({ scope: { type: "global" }, unit: "usd", limit: 10 })], fakeDb(() => ({ tokens_in: 0, tokens_out: 0, cost: 0 })), () => 0);
    expect(noNote.statuses()[0]!.note).toBeUndefined();
  });

  it("lifetime window is all-time and never resets", () => {
    let lastSince: number | undefined;
    const t = new BudgetTracker(
      () => [B({ scope: { type: "global" }, unit: "usd", limit: 50, window: "lifetime" })],
      {
        totals(since: number) {
          lastSince = since;
          return { tokens_in: 0, tokens_out: 0, cost: 12 };
        },
      },
      () => 1_000_000,
    );
    const s = t.statuses()[0]!;
    expect(lastSince).toBe(0);
    expect(s.lifetime).toBe(true);
    expect(s.window).toBe("lifetime");
    expect(s.reset_in_ms).toBe(0);
    expect(s.spent).toBe(12);
    expect(s.exhausted).toBe(false);
  });
});
