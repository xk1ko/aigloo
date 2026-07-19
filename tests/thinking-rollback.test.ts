import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.fn();
vi.mock("undici", () => ({ request: (...args: unknown[]) => requestMock(...args) }));

import { validateConfig } from "../src/config.js";
import { handle } from "../src/core/handler.js";
import { KeyPool } from "../src/core/keypool.js";

function response() {
  return {
    statusCode: 200,
    body: {
      json: async () => ({
        id: "chatcmpl-thinking",
        model: "glm-5.2",
        created: 1,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    },
  };
}

function sentBody(): Record<string, unknown> {
  const call = requestMock.mock.calls[0];
  if (!call) throw new Error("expected an upstream request");
  const options = call[1];
  if (!options || typeof options !== "object" || !("body" in options) || typeof options.body !== "string") {
    throw new Error("expected a serialized request body");
  }
  return JSON.parse(options.body) as Record<string, unknown>;
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue(response());
});

describe("thinking picker rollback", () => {
  it("keeps client suffix intent in the model-native format", async () => {
    const config = validateConfig({
      providers: [{ id: "oa", format: "openai", base_url: "https://oa.test/v1", api_key: "sk-test" }],
    });

    await handle({ config, pool: new KeyPool() }, "openai", {
      model: "oa/glm-5.2(high)",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(sentBody()).toMatchObject({ model: "glm-5.2", thinking: { type: "enabled" } });
    expect(sentBody().reasoning_effort).toBeUndefined();
  });

  it("ignores a stale picker suffix stored in a route", async () => {
    const config = validateConfig({
      providers: [{ id: "oa", format: "openai", base_url: "https://oa.test/v1", api_key: "sk-test" }],
      models: [{ alias: "stale", target: ["oa"], model: "glm-5.2(high)" }],
    });

    await handle({ config, pool: new KeyPool() }, "openai", {
      model: "stale",
      messages: [{ role: "user", content: "ping" }],
    });

    expect(sentBody().model).toBe("glm-5.2");
    expect(sentBody().thinking).toBeUndefined();
    expect(sentBody().reasoning_effort).toBeUndefined();
  });
});
