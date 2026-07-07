import { describe, it, expect } from "vitest";
import { transformModelsDev, transformLiteLLM } from "../src/providers/pricing-sync.js";
import { getPricingForModel, setSyncedPricing, setRuntimePricingOverrides, MODEL_PRICING } from "../src/providers/pricing.js";

describe("transformModelsDev", () => {
  it("maps cost fields verbatim ($/1M already) and skips models without input cost", () => {
    const raw = {
      "anthropic": {
        id: "anthropic",
        models: {
          "claude-sonnet-4-5": {
            id: "claude-sonnet-4-5",
            cost: { input: 3.0, output: 15.0, cache_read: 0.3, cache_write: 3.75, reasoning: 15.0 },
          },
          "claude-free-tier": {
            id: "claude-free-tier",
            cost: { output: 0 },
          },
        },
      },
    };
    const map = transformModelsDev(raw);
    expect(map.get("claude-sonnet-4-5")).toEqual({
      input: 3.0, output: 15.0, cached: 0.3, cache_creation: 3.75, reasoning: 15.0,
    });
    expect(map.has("claude-free-tier")).toBe(false);
  });

  it("lowercases model keys and keeps first-seen on duplicate", () => {
    const raw = {
      a: { id: "a", models: { "GPT-4o": { id: "GPT-4o", cost: { input: 2.5, output: 10 } } } },
      b: { id: "b", models: { "gpt-4o": { id: "gpt-4o", cost: { input: 99, output: 99 } } } },
    };
    const map = transformModelsDev(raw);
    expect(map.get("gpt-4o")?.input).toBe(2.5);
  });
});

describe("transformLiteLLM", () => {
  it("scales per-token costs ×1e6 to $/1M and strips provider prefix", () => {
    const raw = {
      "openai/gpt-4o": {
        input_cost_per_token: 0.0000025,
        output_cost_per_token: 0.00001,
        cache_read_input_token_cost: 0.00000125,
        cache_creation_input_token_cost: 0.0000025,
        litellm_provider: "openai",
      },
      "anthropic/claude-3-haiku": {
        input_cost_per_token: 0.00000025,
        output_cost_per_token: 0.00000125,
        litellm_provider: "anthropic",
      },
      "no-prefix-model": {
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
      },
    };
    const map = transformLiteLLM(raw);
    expect(map.get("gpt-4o")).toEqual({
      input: 2.5, output: 10, cached: 1.25, cache_creation: 2.5, reasoning: 10,
    });
    expect(map.get("claude-3-haiku")?.input).toBe(0.25);
    expect(map.get("no-prefix-model")?.input).toBe(1);
  });

  it("skips entries without token costs", () => {
    const raw = {
      "weird/image-only": { input_cost_per_image: 0.01 },
    };
    const map = transformLiteLLM(raw);
    expect(map.size).toBe(0);
  });
});

describe("getPricingForModel resolution priority", () => {
  it("user runtimeOverrides beats synced models.dev", () => {
    setSyncedPricing("modelsdev", new Map([["test-model-x", { input: 5, output: 25 }]]));
    setSyncedPricing("litellm", new Map());
    setRuntimePricingOverrides({ "test-model-x": { input: 0, output: 0 } });
    const p = getPricingForModel(null, "test-model-x");
    expect(p?.input).toBe(0);
    setRuntimePricingOverrides({});
  });

  it("synced models.dev beats litellm", () => {
    setSyncedPricing("modelsdev", new Map([["md-wins", { input: 1, output: 2 }]]));
    setSyncedPricing("litellm", new Map([["md-wins", { input: 99, output: 99 }]]));
    setRuntimePricingOverrides({});
    const p = getPricingForModel(null, "md-wins");
    expect(p?.input).toBe(1);
  });

  it("synced beats hardcoded MODEL_PRICING", () => {
    const knownModel = Object.keys(MODEL_PRICING)[0]!;
    setSyncedPricing("modelsdev", new Map([[knownModel.toLowerCase(), { input: 0.01, output: 0.02 }]]));
    setSyncedPricing("litellm", new Map());
    setRuntimePricingOverrides({});
    const p = getPricingForModel(null, knownModel);
    expect(p?.input).toBe(0.01);
  });

  it("falls back to hardcoded when synced has no entry", () => {
    setSyncedPricing("modelsdev", new Map());
    setSyncedPricing("litellm", new Map());
    setRuntimePricingOverrides({});
    const knownModel = Object.keys(MODEL_PRICING)[0]!;
    const p = getPricingForModel(null, knownModel);
    expect(p?.input).toBe(MODEL_PRICING[knownModel]!.input);
  });

  it("case-insensitive model lookup for synced", () => {
    setSyncedPricing("modelsdev", new Map([["mixed-case-model", { input: 7, output: 8 }]]));
    setSyncedPricing("litellm", new Map());
    setRuntimePricingOverrides({});
    const p = getPricingForModel(null, "Mixed-Case-Model");
    expect(p?.input).toBe(7);
  });

  it("strips provider/ prefix before synced lookup", () => {
    setSyncedPricing("modelsdev", new Map([["prefixed-model", { input: 9, output: 10 }]]));
    setSyncedPricing("litellm", new Map());
    setRuntimePricingOverrides({});
    const p = getPricingForModel("openai", "openai/prefixed-model");
    expect(p?.input).toBe(9);
  });
});
