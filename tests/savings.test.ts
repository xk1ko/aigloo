import { describe, it, expect } from "vitest";
import { UsageDB } from "../src/db.js";

function db(now = () => 1_000_000) {
  return new UsageDB(":memory:", now);
}

describe("UsageDB.record — saver fields", () => {
  it("defaults saver fields to zero/off when omitted", () => {
    const d = db();
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 10, tokens_out: 5, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0 });
    const row = d.recent(1)[0]!;
    expect(row.rtk_bytes_in).toBe(0);
    expect(row.rtk_bytes_out).toBe(0);
    expect(row.headroom_tokens_before).toBe(0);
    expect(row.headroom_tokens_after).toBe(0);
    expect(row.caveman_level).toBe("off");
    expect(row.ponytail_level).toBe("off");
  });

  it("persists saver fields when provided", () => {
    const d = db();
    d.record({
      alias: "a", provider: "p", model: "m", tokens_in: 10, tokens_out: 5, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0,
      rtk_bytes_in: 1000, rtk_bytes_out: 400, headroom_tokens_before: 500, headroom_tokens_after: 300,
      caveman_level: "full", ponytail_level: "lite", rtk_cost_saved: 0.001, headroom_cost_saved: 0.002,
    });
    const row = d.recent(1)[0]!;
    expect(row.rtk_bytes_in).toBe(1000);
    expect(row.rtk_bytes_out).toBe(400);
    expect(row.headroom_tokens_before).toBe(500);
    expect(row.headroom_tokens_after).toBe(300);
    expect(row.caveman_level).toBe("full");
    expect(row.ponytail_level).toBe("lite");
    expect(row.rtk_cost_saved).toBeCloseTo(0.001);
    expect(row.headroom_cost_saved).toBeCloseTo(0.002);
  });
});

describe("UsageDB.savingsSummary", () => {
  it("sums RTK byte savings and counts only rows RTK actually touched", () => {
    const d = db();
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, rtk_bytes_in: 1000, rtk_bytes_out: 400, rtk_cost_saved: 0.01 });
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, rtk_bytes_in: 2000, rtk_bytes_out: 1000, rtk_cost_saved: 0.02 });
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0 }); // no RTK hit
    const s = d.savingsSummary();
    expect(s.rtk.bytes_in).toBe(3000);
    expect(s.rtk.bytes_out).toBe(1400);
    expect(s.rtk.hits).toBe(2);
    expect(s.rtk.cost_saved).toBeCloseTo(0.03);
  });

  it("sums Headroom token savings the same way", () => {
    const d = db();
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, headroom_tokens_before: 500, headroom_tokens_after: 200, headroom_cost_saved: 0.05 });
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0 }); // headroom off
    const s = d.savingsSummary();
    expect(s.headroom.tokens_before).toBe(500);
    expect(s.headroom.tokens_after).toBe(200);
    expect(s.headroom.hits).toBe(1);
    expect(s.headroom.cost_saved).toBeCloseTo(0.05);
  });

  it("breaks down avg tokens_out by caveman/ponytail level", () => {
    const d = db();
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 100, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, caveman_level: "full" });
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 200, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, caveman_level: "full" });
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 500, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0 }); // off
    const s = d.savingsSummary();
    const full = s.by_caveman_level.find((r) => r.level === "full")!;
    expect(full.requests).toBe(2);
    expect(full.avg_tokens_out).toBeCloseTo(150);
    const off = s.by_caveman_level.find((r) => r.level === "off")!;
    expect(off.requests).toBe(1);
    expect(off.avg_tokens_out).toBeCloseTo(500);
  });

  it("filters by since timestamp like the other summary methods", () => {
    let t = 1000;
    const d = db(() => t);
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, rtk_bytes_in: 100, rtk_bytes_out: 50 });
    t = 5000;
    d.record({ alias: "a", provider: "p", model: "m", tokens_in: 1, tokens_out: 1, cached_tokens: 0, cost: 0, status: 200, latency_ms: 1, stream: 0, rtk_bytes_in: 200, rtk_bytes_out: 100 });
    expect(d.savingsSummary(0).rtk.hits).toBe(2);
    expect(d.savingsSummary(2000).rtk.hits).toBe(1);
  });
});
