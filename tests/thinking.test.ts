import { describe, it, expect } from "vitest";
import {
  parseSuffix,
  extractThinking,
  applyThinking,
  type ThinkingConfig,
} from "../src/translator/thinkingUnified.js";

// Mirror of aigloo's tests/translator/thinking-unified.test.js, adapted to the
// models in our ported capabilities table. Guards that thinking normalizes into
// the right provider-native shape per format.
function apply(
  fmt: string,
  model: string,
  body: Record<string, any>,
  provider: string | null = null,
  intent?: ThinkingConfig | null,
): Record<string, any> {
  applyThinking(fmt, model, body, provider, intent);
  return body;
}

describe("parseSuffix", () => {
  it("level suffix", () => {
    expect(parseSuffix("gpt-5(high)")).toEqual({ cleanModel: "gpt-5", override: { mode: "level", level: "high" } });
  });
  it("numeric budget suffix", () => {
    expect(parseSuffix("model(8192)")).toEqual({ cleanModel: "model", override: { mode: "budget", budget: 8192 } });
  });
  it("auto / none suffix", () => {
    expect(parseSuffix("m(auto)").override).toEqual({ mode: "auto" });
    expect(parseSuffix("m(none)").override).toEqual({ mode: "none" });
  });
  it("no suffix → null override", () => {
    expect(parseSuffix("claude-opus-4.7")).toEqual({ cleanModel: "claude-opus-4.7", override: null });
  });
});

describe("extractThinking", () => {
  it("claude enabled budget", () => {
    expect(extractThinking({ thinking: { type: "enabled", budget_tokens: 4096 } })).toEqual({ mode: "budget", budget: 4096 });
  });
  it("claude disabled", () => {
    expect(extractThinking({ thinking: { type: "disabled" } })).toEqual({ mode: "none" });
  });
  it("openai reasoning_effort", () => {
    expect(extractThinking({ reasoning_effort: "high" })).toEqual({ mode: "level", level: "high" });
  });
  it("openai reasoning.effort none", () => {
    expect(extractThinking({ reasoning: { effort: "none" } })).toEqual({ mode: "none" });
  });
  it("gemini thinkingBudget 0 → none", () => {
    expect(extractThinking({ thinkingConfig: { thinkingBudget: 0 } })).toEqual({ mode: "none" });
  });
  it("qwen enable_thinking false", () => {
    expect(extractThinking({ enable_thinking: false })).toEqual({ mode: "none" });
  });
  it("no thinking intent → null", () => {
    expect(extractThinking({ messages: [] })).toBeNull();
  });
});

describe("applyThinking format matrix", () => {
  it("claude 4.6+ → adaptive output_config (no budget_tokens)", () => {
    const out = apply("claude", "claude-opus-4.7", { reasoning_effort: "high" }, "claude");
    expect(out.output_config).toEqual({ effort: "high" });
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("claude haiku → budget thinking", () => {
    const out = apply("claude", "claude-haiku-4.5", { reasoning_effort: "high" }, "claude");
    expect(out.thinking).toEqual({ type: "enabled", budget_tokens: 24576 });
  });

  it("gemini-3-pro → thinkingLevel", () => {
    const out = apply("gemini", "gemini-3-pro", { reasoning_effort: "medium" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBe("medium");
  });

  it("gemini-2.5 → clamped thinkingBudget", () => {
    const out = apply("gemini", "gemini-2.5-flash", { reasoning_effort: "high" }, "gemini");
    expect(out.generationConfig.thinkingConfig.thinkingBudget).toBe(24576);
    expect(out.generationConfig.thinkingConfig.thinkingLevel).toBeUndefined();
  });

  it("GLM off → enable_thinking:false (not thinking.disabled)", () => {
    const out = apply("openai", "glm-4.6", { reasoning_effort: "none" }, "glm");
    expect(out.enable_thinking).toBe(false);
    expect(out.thinking).toBeUndefined();
  });

  it("openai gpt-5 level → reasoning_effort", () => {
    const out = apply("openai", "gpt-5", { reasoning_effort: "medium" }, "openai");
    expect(out.reasoning_effort).toBe("medium");
  });

  it("openai gpt-5.6-sol max suffix → xhigh reasoning_effort", () => {
    const out = apply("openai", "gpt-5.6-sol(max)", {}, "openai");
    expect(out.reasoning_effort).toBe("xhigh");
  });

  it("openai 'none' disable → reasoning_effort none", () => {
    const out = apply("openai", "gpt-5", { reasoning_effort: "none" }, "openai");
    expect(out.reasoning_effort).toBe("none");
  });

  it("non-reasoning model strips stray thinking fields", () => {
    const out = apply("openai", "gpt-4", { reasoning_effort: "high" }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });

  it("model that cannot disable clamps 'none' to thinking on (minimax M2.x)", () => {
    const out = apply("openai", "minimax-m2.7", { reasoning_effort: "none" }, "minimax");
    expect(out.thinking).toEqual({ type: "adaptive" });
  });

  it("suffix on model drives intent end-to-end", () => {
    const out = apply("claude", "claude-opus-4.7(none)", {}, "claude");
    expect(out.thinking).toEqual({ type: "disabled" });
  });

  it("no reasoning intent → body untouched", () => {
    const out = apply("openai", "gpt-5", { messages: [] }, "openai");
    expect(out.reasoning_effort).toBeUndefined();
  });
});
