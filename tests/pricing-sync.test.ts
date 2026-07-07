import { describe, it, expect } from "vitest";
import { transformModelsDev, transformModelsDevToCapabilities, transformLiteLLM } from "../src/providers/pricing-sync.js";
import { getPricingForModel, setSyncedPricing, setRuntimePricingOverrides, MODEL_PRICING } from "../src/providers/pricing.js";
import { getCapabilitiesForModel, setSyncedCapabilities, DEFAULT_CAPABILITIES, PATTERN_CAPABILITIES } from "../src/providers/capabilities.js";

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

describe("transformModelsDevToCapabilities", () => {
  it("maps modalities, reasoning, tool_call, and limits", () => {
    const raw = {
      anthropic: {
        id: "anthropic",
        models: {
          "claude-sonnet-4-5": {
            id: "claude-sonnet-4-5",
            reasoning: true,
            tool_call: true,
            attachment: true,
            modalities: { input: ["text", "image", "pdf"], output: ["text"] },
            limit: { context: 200000, output: 64000 },
          },
        },
      },
    };
    const map = transformModelsDevToCapabilities(raw);
    const caps = map.get("claude-sonnet-4-5");
    expect(caps).toEqual({
      vision: true, pdf: true, reasoning: true, tools: true,
      contextWindow: 200000, maxOutput: 64000,
    });
  });

  it("maps audio/video input and image/audio output", () => {
    const raw = {
      google: {
        id: "google",
        models: {
          "gemini-2.5-pro": {
            id: "gemini-2.5-pro",
            modalities: { input: ["text", "image", "audio", "video"], output: ["text", "image"] },
          },
        },
      },
    };
    const map = transformModelsDevToCapabilities(raw);
    const caps = map.get("gemini-2.5-pro");
    expect(caps).toEqual({
      vision: true, audioInput: true, videoInput: true, imageOutput: true,
    });
  });

  it("sets tools=false when tool_call is explicitly false", () => {
    const raw = {
      x: { id: "x", models: { "embed-only": { id: "embed-only", tool_call: false } } },
    };
    const map = transformModelsDevToCapabilities(raw);
    expect(map.get("embed-only")?.tools).toBe(false);
  });

  it("skips models with no capability-relevant fields", () => {
    const raw = {
      x: { id: "x", models: { "bare-model": { id: "bare-model" } } },
    };
    const map = transformModelsDevToCapabilities(raw);
    expect(map.has("bare-model")).toBe(false);
  });
});

describe("getCapabilitiesForModel resolution priority", () => {
  it("hardcoded pattern beats synced (pattern has thinkingFormat)", () => {
    setSyncedCapabilities(new Map([["claude-sonnet-4-5", { contextWindow: 999, vision: false }]]));
    const caps = getCapabilitiesForModel(null, "claude-sonnet-4-5");
    // PATTERN_CAPABILITIES has *claude*sonnet* → thinkingFormat: claude-budget
    expect(caps.thinkingFormat).toBe("claude-budget");
    // synced contextWindow should NOT override pattern
    expect(caps.contextWindow).not.toBe(999);
  });

  it("synced fills models not covered by hardcoded", () => {
    setSyncedCapabilities(new Map([["totally-unknown-model", { vision: true, contextWindow: 500000 }]]));
    const caps = getCapabilitiesForModel(null, "totally-unknown-model");
    expect(caps.vision).toBe(true);
    expect(caps.contextWindow).toBe(500000);
  });

  it("synced fills above DEFAULT when no hardcoded match", () => {
    setSyncedCapabilities(new Map([["mystery-model", { reasoning: true, contextWindow: 1000000 }]]));
    const caps = getCapabilitiesForModel(null, "mystery-model");
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1000000);
    // fields not in synced entry fall through to DEFAULT
    expect(caps.tools).toBe(DEFAULT_CAPABILITIES.tools);
  });

  it("case-insensitive synced lookup", () => {
    setSyncedCapabilities(new Map([["mixed-case-model", { vision: true }]]));
    const caps = getCapabilitiesForModel(null, "Mixed-Case-Model");
    expect(caps.vision).toBe(true);
  });

  it("clears synced caps when map is empty", () => {
    setSyncedCapabilities(new Map([["temp-model", { vision: true }]]));
    setSyncedCapabilities(new Map());
    const caps = getCapabilitiesForModel(null, "temp-model");
    expect(caps.vision).toBe(DEFAULT_CAPABILITIES.vision);
  });
});
