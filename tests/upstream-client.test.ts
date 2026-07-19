import { describe, it, expect } from "vitest";
import { buildBody, buildUrl } from "../src/upstream/client.js";
import type { Provider } from "../src/config.js";
import type { CanonicalRequest } from "../src/core/canonical.js";

const openaiProvider: Provider = {
  id: "openai",
  format: "openai",
  base_url: "https://api.openai.com/v1",
  api_keys: ["sk-test"],
};

const geminiProvider: Provider = {
  id: "gemini",
  format: "gemini",
  base_url: "https://generativelanguage.googleapis.com/v1beta",
  api_keys: ["test-key"],
};

const baseReq: CanonicalRequest = {
  model: "gpt-5.6-sol",
  messages: [{ role: "user", content: "hi" }],
  max_tokens: 100,
  stream: false,
};

describe("buildBody — suffix stripping", () => {
  it("body model is clean (no suffix) for a suffixed route model", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5.6-sol(max)", false, null) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5.6-sol");
  });

  it("body model is clean for a (high) suffix", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5(high)", false, null) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5");
  });

  it("body model is clean for a (none) suffix", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5(none)", false, null) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5");
  });

  it("body model unchanged when no suffix is present", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5", false, null) as Record<string, unknown>;
    expect(body.model).toBe("gpt-5");
  });

  it("max suffix maps to xhigh reasoning_effort (preserves existing commit behavior)", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5.6-sol(max)", false, null) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("xhigh");
    expect(body.model).toBe("gpt-5.6-sol");
  });

  it("high suffix maps to high reasoning_effort", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5(high)", false, null) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("high");
  });

  it("none suffix maps to reasoning_effort none", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-5(none)", false, null) as Record<string, unknown>;
    expect(body.reasoning_effort).toBe("none");
  });

  it("non-reasoning model strips suffix from body and strips thinking fields", () => {
    const body = buildBody(openaiProvider, baseReq, "gpt-4o(high)", false, null) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o");
    expect(body.reasoning_effort).toBeUndefined();
  });
});

describe("buildUrl — clean model path", () => {
  it("Gemini URL encodes the clean model", () => {
    const url = buildUrl(geminiProvider, "gemini-2.5-flash", false);
    expect(url).toContain("models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain("(");
  });

  it("Gemini streaming URL uses streamGenerateContent", () => {
    const url = buildUrl(geminiProvider, "gemini-2.5-flash", true);
    expect(url).toContain("streamGenerateContent");
  });
});
