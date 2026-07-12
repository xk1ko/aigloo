import { describe, it, expect } from "vitest";
import { UsageDB, computeCost, computeCostOut } from "../src/db.js";

/** Fresh in-memory DB with a controllable clock. */
function db(now = () => 1_000_000) {
  return new UsageDB(":memory:", now);
}

describe("computeCost", () => {
  it("prices input and output per 1M tokens", () => {
    expect(computeCost({ tokensIn: 1_000_000, tokensOut: 1_000_000, cachedTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, priceIn: 3, priceOut: 15, priceCached: 0, priceCacheCreation: 0, priceReasoning: 0 })).toBeCloseTo(18);
  });
  it("is zero when no prices are set", () => {
    expect(computeCost({ tokensIn: 1000, tokensOut: 2000, cachedTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, priceIn: 0, priceOut: 0, priceCached: 0, priceCacheCreation: 0, priceReasoning: 0 })).toBe(0);
  });
  it("prices only the side that has a price", () => {
    expect(computeCost({ tokensIn: 2_000_000, tokensOut: 500_000, cachedTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, priceIn: 2, priceOut: 0, priceCached: 0, priceCacheCreation: 0, priceReasoning: 0 })).toBeCloseTo(4);
  });
});

describe("computeCostOut", () => {
  it("prices output + reasoning tokens only", () => {
    const b = { tokensIn: 1_000_000, tokensOut: 500_000, cachedTokens: 0, cacheCreationTokens: 0, reasoningTokens: 100_000, priceIn: 3, priceOut: 15, priceCached: 0, priceCacheCreation: 0, priceReasoning: 10 };
    expect(computeCostOut(b)).toBeCloseTo(500_000 * 15 / 1_000_000 + 100_000 * 10 / 1_000_000);
  });
  it("is zero when output and reasoning are zero", () => {
    expect(computeCostOut({ tokensIn: 1_000_000, tokensOut: 0, cachedTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, priceIn: 3, priceOut: 15, priceCached: 0, priceCacheCreation: 0, priceReasoning: 0 })).toBe(0);
  });
});

describe("UsageDB.record + summary", () => {
  it("aggregates totals, by-provider, by-model, and by-key", () => {
    const d = db();
    d.record({ alias: "smart", provider: "oa", model: "gpt-4o", tokens_in: 100, tokens_out: 50, cached_tokens: 0, cost: 0.5, cost_out: 0.3, status: 200, latency_ms: 120, stream: 0, client_key: "alice" });
    d.record({ alias: "smart", provider: "oa", model: "gpt-4o", tokens_in: 200, tokens_out: 80, cached_tokens: 0, cost: 1.0, cost_out: 0.6, status: 200, latency_ms: 90, stream: 1, client_key: "alice" });
    d.record({ alias: "claude", provider: "an", model: "claude-3", tokens_in: 50, tokens_out: 20, cached_tokens: 10, cost: 0.2, cost_out: 0.15, status: 200, latency_ms: 200, stream: 0, client_key: "bob" });

    const s = d.summary();
    expect(s.total.requests).toBe(3);
    expect(s.total.tokens_in).toBe(350);
    expect(s.total.tokens_out).toBe(150);
    expect(s.total.cost).toBeCloseTo(1.7);
    expect(s.total.cost_out).toBeCloseTo(1.05);

    const oa = s.by_provider.find((p) => p.provider === "oa")!;
    expect(oa.requests).toBe(2);
    expect(oa.tokens_in).toBe(300);
    expect(oa.cost_out).toBeCloseTo(0.9);

    const gpt = s.by_model.find((m) => m.model === "gpt-4o")!;
    expect(gpt.requests).toBe(2);

    const alice = s.by_key.find((k) => k.client_key === "alice")!;
    expect(alice.requests).toBe(2);
    expect(alice.cost).toBeCloseTo(1.5);
    const bob = s.by_key.find((k) => k.client_key === "bob")!;
    expect(bob.requests).toBe(1);
    expect(bob.cost).toBeCloseTo(0.2);
  });

  it("filters the summary by since timestamp", () => {
    let t = 1000;
    const d = db(() => t);
    t = 1000;
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0 });
    t = 5000;
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0 });
    expect(d.summary(0).total.requests).toBe(2);
    expect(d.summary(2000).total.requests).toBe(1); // only the ts=5000 row
  });
});

describe("UsageDB.recent", () => {
  it("returns rows newest-first", () => {
    let t = 1000;
    const d = db(() => t);
    d.record({ alias: "first", provider: "p", model: "m", tokens_in: 0, tokens_out: 0, cached_tokens: 0, cost: 0, status: 200, latency_ms: 0, stream: 0 });
    t = 2000;
    d.record({ alias: "second", provider: "p", model: "m", tokens_in: 0, tokens_out: 0, cached_tokens: 0, cost: 0, status: 200, latency_ms: 0, stream: 0 });
    const rows = d.recent(10);
    expect(rows[0]!.alias).toBe("second");
    expect(rows[1]!.alias).toBe("first");
  });

  it("clamps the limit to a sane range", () => {
    const d = db();
    expect(d.recent(99999)).toHaveLength(0); // no rows, but does not throw
  });
});

describe("UsageDB.series", () => {
  it("buckets rows and zero-fills gaps", () => {
    let t = 0;
    const d = db(() => t);
    // two rows in the first hour bucket
    t = 1000;
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 10, tokens_out: 5, cached_tokens: 0, cost: 0.1, status: 200, latency_ms: 0, stream: 0 });
    t = 2000;
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 20, tokens_out: 5, cached_tokens: 0, cost: 0.2, status: 200, latency_ms: 0, stream: 0 });
    // jump the clock two hours ahead so the series spans empty buckets
    t = 2 * 3600 * 1000 + 500;

    const hour = 3600 * 1000;
    const points = d.series(0, hour);
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points[0]!.requests).toBe(2); // first bucket has both rows
    expect(points[0]!.tokens_in).toBe(30);
    expect(points[1]!.requests).toBe(0); // zero-filled gap
  });
});

describe("UsageDB.totals scoped sums", () => {
  function seed(): UsageDB {
    const db = new UsageDB(":memory:");
    db.record({ alias: "a", provider: "openai", model: "gpt-4o", tokens_in: 100, tokens_out: 50, cached_tokens: 0, cost: 1, status: 200, latency_ms: 10, stream: 0, ts: 1000 });
    db.record({ alias: "b", provider: "anthropic", model: "claude-opus-4-6", tokens_in: 200, tokens_out: 100, cached_tokens: 0, cost: 4, status: 200, latency_ms: 10, stream: 0, ts: 2000 });
    db.record({ alias: "c", provider: "openai", model: "gpt-4o", tokens_in: 10, tokens_out: 5, cached_tokens: 0, cost: 0.2, status: 200, latency_ms: 10, stream: 0, ts: 3000 });
    return db;
  }

  it("global: sums everything since the window start", () => {
    const t = seed().totals(0);
    expect(t.tokens_in).toBe(310);
    expect(t.tokens_out).toBe(155);
    expect(t.cost).toBeCloseTo(5.2);
  });

  it("provider filter", () => {
    const t = seed().totals(0, { provider: "openai" });
    expect(t.tokens_in).toBe(110);
    expect(t.cost).toBeCloseTo(1.2);
  });

  it("model filter", () => {
    const t = seed().totals(0, { model: "claude-opus-4-6" });
    expect(t.tokens_out).toBe(100);
    expect(t.cost).toBeCloseTo(4);
  });

  it("respects sinceMs", () => {
    const t = seed().totals(2500, { provider: "openai" });
    expect(t.tokens_in).toBe(10); // only the ts=3000 row
  });
});

describe("UsageDB client_key", () => {
  function seed(): UsageDB {
    const db = new UsageDB(":memory:");
    db.record({ alias: "a", provider: "openai", model: "gpt-4o", tokens_in: 100, tokens_out: 50, cached_tokens: 0, cost: 1, status: 200, latency_ms: 1, stream: 0, client_key: "aaaa1111", ts: 1000 });
    db.record({ alias: "a", provider: "openai", model: "gpt-4o", tokens_in: 10, tokens_out: 5, cached_tokens: 0, cost: 0.2, status: 200, latency_ms: 1, stream: 0, client_key: "bbbb2222", ts: 2000 });
    return db;
  }
  it("totals filters by client_key", () => {
    expect(seed().totals(0, { client_key: "aaaa1111" }).cost).toBeCloseTo(1);
    expect(seed().totals(0, { client_key: "bbbb2222" }).cost).toBeCloseTo(0.2);
  });

  it("summary.by_key groups fingerprints", () => {
    const s = seed().summary();
    expect(s.by_key).toHaveLength(2);
    expect(s.by_key[0]!.cost).toBeGreaterThanOrEqual(s.by_key[1]!.cost);
    expect(s.by_key.map((k) => k.client_key).sort()).toEqual(["aaaa1111", "bbbb2222"]);
  });

  it("summary filters by client_key for member views", () => {
    const s = seed().summary(0, { client_key: "aaaa1111" });
    expect(s.total.cost).toBeCloseTo(1);
    expect(s.by_key).toHaveLength(1);
    expect(s.by_key[0]!.client_key).toBe("aaaa1111");
    expect(s.by_provider.every((p) => p.provider === "openai")).toBe(true);
  });
  it("record defaults client_key to '' when omitted, excluded from a keyed sum", () => {
    const db = new UsageDB(":memory:");
    db.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 9, status: 200, latency_ms: 1, stream: 0, ts: 1 });
    expect(db.totals(0).cost).toBeCloseTo(9);              // global still counts it
    expect(db.totals(0, { client_key: "aaaa1111" }).cost).toBe(0); // not attributed to any key
  });
});

describe("UsageDB.log", () => {
  it("records a debug log row without throwing", () => {
    const d = db();
    expect(() =>
      d.log({ direction: "error", provider: "oa", status: 502, request_summary: "smart", response_summary: "ECONNRESET" }),
    ).not.toThrow();
  });
});
