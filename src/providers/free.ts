/**
 * Free passthrough providers (e.g. OpenCode Free). These speak OpenAI format,
 * need no upstream auth, and expose their catalog at `{base_url}/models`. The
 * gateway already routes them through the normal pipeline (the key pool hands
 * out an empty key, the client omits the auth header); this module only adds the
 * one extra capability they need — fetching the model list at runtime so it
 * doesn't have to be hand-maintained in config.
 */
import { request } from "undici";
import type { Provider } from "../config.js";

export interface FetchedModel {
  id: string;
}

export interface ModelFetchResult {
  ok: boolean;
  models: FetchedModel[];
  error?: string;
}

/**
 * Fetch a provider's model catalog from `{base_url}/models` (OpenAI shape:
 * `{ data: [{ id }] }`). Never throws — returns a structured result so the
 * dashboard's "Connect OpenCode Free" button can surface failures inline.
 */
export async function fetchModels(provider: Provider): Promise<ModelFetchResult> {
  const base = provider.base_url.replace(/\/$/, "");
  const headers: Record<string, string> = { ...(provider.headers ?? {}) };
  const key = provider.api_keys?.[0] ?? provider.api_key;
  if (key) headers["authorization"] = `Bearer ${key}`;

  try {
    const res = await request(`${base}/models`, {
      method: "GET",
      headers,
      headersTimeout: 15_000,
      bodyTimeout: 15_000,
    });
    if (res.statusCode >= 400) {
      await res.body.dump();
      return { ok: false, models: [], error: `models endpoint returned ${res.statusCode}` };
    }
    const body = (await res.body.json()) as { data?: Array<{ id?: unknown }> };
    const models = (body.data ?? [])
      .map((m) => (typeof m.id === "string" ? { id: m.id } : null))
      .filter((m): m is FetchedModel => m !== null);
    return { ok: true, models };
  } catch (e) {
    return { ok: false, models: [], error: (e as Error).message };
  }
}
