import { describe, it, expect } from "vitest";
import {
  stripModelSuffix,
  levelsForModel,
  selectedModelVariant,
  thinkingLevelOf,
  withThinkingLevel,
  BASE_THINKING_LEVELS,
  DEFAULT_CAPABILITIES,
  type CapsTables,
} from "./capabilities";

const REASONING_CAPS = { reasoning: true, thinkingFormat: "openai" };
const NON_REASONING_CAPS = { reasoning: false };

function tablesWith(patterns: Array<{ pattern: string; caps: Record<string, unknown> }>): CapsTables {
  return {
    default: DEFAULT_CAPABILITIES,
    model: {},
    provider: {},
    pattern: patterns,
  };
}

const TABLES = tablesWith([
  { pattern: "*gpt-5.6-sol*", caps: REASONING_CAPS },
  { pattern: "*gpt-5*", caps: REASONING_CAPS },
  { pattern: "*gpt-4*", caps: NON_REASONING_CAPS },
  { pattern: "*claude-opus-4*", caps: REASONING_CAPS },
]);

describe("stripModelSuffix", () => {
  it("strips a terminal (level) suffix", () => {
    expect(stripModelSuffix("openai/gpt-5(high)")).toBe("openai/gpt-5");
    expect(stripModelSuffix("gpt-5.6-sol(max)")).toBe("gpt-5.6-sol");
  });

  it("strips a terminal (none) suffix", () => {
    expect(stripModelSuffix("openai/gpt-5(none)")).toBe("openai/gpt-5");
  });

  it("strips a numeric budget suffix", () => {
    expect(stripModelSuffix("openai/gpt-5(8192)")).toBe("openai/gpt-5");
  });

  it("leaves a bare model unchanged", () => {
    expect(stripModelSuffix("openai/gpt-5")).toBe("openai/gpt-5");
    expect(stripModelSuffix("gpt-5")).toBe("gpt-5");
  });

  it("does not strip non-terminal parentheses", () => {
    expect(stripModelSuffix("claude-3.5-sonnet")).toBe("claude-3.5-sonnet");
  });
});

describe("levelsForModel", () => {
  it("returns base levels for a reasoning model", () => {
    const levels = levelsForModel("openai/gpt-5", TABLES);
    expect(levels).toEqual(BASE_THINKING_LEVELS);
    expect(levels).not.toContain("max");
  });

  it("appends max only for *gpt-5.6-sol* base model", () => {
    const levels = levelsForModel("openai/gpt-5.6-sol", TABLES);
    expect(levels).toEqual([...BASE_THINKING_LEVELS, "max"]);
  });

  it("appends max for gpt-5.6-sol even when a suffix is present", () => {
    const levels = levelsForModel("openai/gpt-5.6-sol(high)", TABLES);
    expect(levels).toEqual([...BASE_THINKING_LEVELS, "max"]);
  });

  it("does not append max for non-matching reasoning models", () => {
    const levels = levelsForModel("anthropic/claude-opus-4.7", TABLES);
    expect(levels).toEqual(BASE_THINKING_LEVELS);
    expect(levels).not.toContain("max");
  });

  it("returns empty for a non-reasoning model", () => {
    const levels = levelsForModel("openai/gpt-4", TABLES);
    expect(levels).toEqual([]);
  });

  it("returns empty for a non-reasoning model even with a suffix", () => {
    const levels = levelsForModel("openai/gpt-4(high)", TABLES);
    expect(levels).toEqual([]);
  });

  it("strips suffix before capability lookup so suffixed reasoning models still resolve", () => {
    const levels = levelsForModel("openai/gpt-5(none)", TABLES);
    expect(levels.length).toBeGreaterThan(0);
    expect(levels).toContain("none");
  });

  it("hides none when the model cannot disable thinking", () => {
    const tables = tablesWith([{ pattern: "*always-thinking*", caps: { reasoning: true, thinkingCanDisable: false } }]);
    expect(levelsForModel("provider/always-thinking", tables)).toEqual(["minimal", "low", "medium", "high", "xhigh"]);
  });
});

describe("thinking model values", () => {
  it("finds a selected suffixed variant from its base model", () => {
    expect(selectedModelVariant("openai/gpt-5.6-sol", ["openai/gpt-5.6-sol(max)"])).toBe("openai/gpt-5.6-sol(max)");
  });

  it("extracts the selected level", () => {
    expect(thinkingLevelOf("openai/gpt-5.6-sol(max)")).toBe("max");
    expect(thinkingLevelOf("openai/gpt-5.6-sol")).toBe("");
  });

  it("replaces a level without stacking suffixes", () => {
    expect(withThinkingLevel("openai/gpt-5.6-sol(high)", "max")).toBe("openai/gpt-5.6-sol(max)");
    expect(withThinkingLevel("openai/gpt-5.6-sol(max)", "")).toBe("openai/gpt-5.6-sol");
  });
});
