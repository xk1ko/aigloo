/**
 * Framework-agnostic admin API dispatcher — extracted from the old Fastify
 * `src/routes/admin.ts` so the same logic can run inside Next.js API routes
 * (single-port migration). Caller is responsible for auth (checkAdminAuth
 * runs in the route handler against Web API Headers before reaching here).
 *
 * Route matching is method + segments (path after /admin/ split on "/").
 * First match wins. Path params (:id, :index, :alias, :key, :model) are
 * extracted positionally from the segments array.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { GatewayState } from "./state.js";
import type { UsageDB } from "../db.js";
import { clientKeyFingerprint, type AdminVerifier } from "../middleware/auth.js";
import { buildKeyUsageRow } from "./keysUsage.js";
import {
  maskKey,
  serializeConfig,
  ProviderSchema,
  addProvider,
  editProvider,
  renameProvider,
  removeProvider,
  addProviderKey,
  removeProviderKey,
  editProviderKey,
  reorderProvider,
  reorderProviderKey,
  toggleProviderKey,
  setProviderStrategy,
  setProviderDisabled,
  addProviderModel,
  removeProviderModel,
  addProviderModels,
  clearProviderModels,
  setProviderModelPrice,
  setRoute,
  removeRoute,
  setRtk,
  setCaveman,
  setPonytail,
  setHeadroom,
  addServerKey,
  editServerKey,
  removeServerKey,
  setServerKeyScope,
  setBudget,
  clearBudget,
  importProviders,
  type Config,
  type Provider,
  type EndpointSettings,
  type Budget,
} from "../config.js";
import { pingProvider } from "../upstream/client.js";
import { handle, GatewayError } from "./handler.js";
import { fetchModels } from "../providers/free.js";
import { consoleBuffer } from "./console-buffer.js";
import { getPricingForModel, setRuntimePricingOverrides, type Pricing } from "../providers/pricing.js";
import { loadSyncedFromDb, startPeriodicSync, syncAll, syncModelsDev, syncLitellm, getSyncStatus, clearSynced, type PricingSource } from "../providers/pricing-sync.js";
import { MODEL_CAPABILITIES, PROVIDER_CAPABILITIES, PATTERN_CAPABILITIES, DEFAULT_CAPABILITIES } from "../providers/capabilities.js";
import { getHeadroomStatus, isLoopbackHeadroomUrl, DEFAULT_HEADROOM_URL } from "../headroom/detect.js";
import { startHeadroomProxy, stopHeadroomProxy, getManagedPid, getHeadroomLogTail } from "../headroom/process.js";

export interface AdminDeps {
  state: GatewayState;
  db?: UsageDB;
  auth: AdminVerifier & { change(current: string, next: string): { ok: boolean; error?: string } };
  notifier?: import("./notifier.js").Notifier;
  log: (msg: string) => void;
}

export interface AdminResult {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  stream?: ReadableStream<Uint8Array>;
}

let pricingInitialized = false;

export function initAdmin(deps: AdminDeps): void {
  reloadPricingOverrides(deps);
  if (deps.db) {
    loadSyncedFromDb(deps.db);
    startPeriodicSync(deps.db, deps.log);
  }
  pricingInitialized = true;
}

function reloadPricingOverrides(deps: AdminDeps): void {
  if (!deps.db) return;
  const rows = deps.db.listPricingOverrides();
  const map: Record<string, Pricing> = {};
  for (const r of rows) {
    const base = getPricingForModel(null, r.model);
    map[r.model] = {
      input: r.input ?? base?.input ?? 0,
      output: r.output ?? base?.output ?? 0,
      cached: r.cached ?? base?.cached,
      cache_creation: r.cache_creation ?? base?.cache_creation,
      reasoning: r.reasoning ?? base?.reasoning,
    };
  }
  setRuntimePricingOverrides(map);
}

/** Deep-clone the raw config and mask every secret for display. */
function maskedConfig(config: Config): Config {
  const clone: Config = JSON.parse(JSON.stringify(config));
  for (const p of clone.providers) {
    if (p.api_key) p.api_key = maskKey(p.api_key);
    if (p.api_keys) p.api_keys = p.api_keys.map(maskKey);
    if (p.key_names) {
      p.key_names = Object.fromEntries(
        Object.entries(p.key_names).map(([k, name]) => [maskKey(k), name]),
      );
    }
  }
  clone.server.api_keys = clone.server.api_keys.map(maskKey);
  if (clone.server.key_names) {
    clone.server.key_names = Object.fromEntries(
      Object.entries(clone.server.key_names).map(([k, name]) => [maskKey(k), name]),
    );
  }
  if (clone.server.key_models) {
    clone.server.key_models = Object.fromEntries(
      Object.entries(clone.server.key_models).map(([k, v]) => [maskKey(k), v]),
    );
  }
  if (clone.server.key_rpm) {
    clone.server.key_rpm = Object.fromEntries(
      Object.entries(clone.server.key_rpm).map(([k, v]) => [maskKey(k), v]),
    );
  }
  if (clone.server.key_expires) {
    clone.server.key_expires = Object.fromEntries(
      Object.entries(clone.server.key_expires).map(([k, v]) => [maskKey(k), v]),
    );
  }
  return clone;
}

function applyMutation(deps: AdminDeps, mutate: (config: Config) => Config): AdminResult {
  try {
    const next = mutate(deps.state.config.raw);
    deps.state.reload(serializeConfig(next));
    return { status: 200, body: { ok: true, config: maskedConfig(deps.state.config.raw) } };
  } catch (e) {
    return { status: 400, body: { error: (e as Error).message } };
  }
}

function isLevel(v: unknown): v is EndpointSettings["caveman"] {
  return v === "off" || v === "lite" || v === "full" || v === "ultra";
}

/** Current package version, read from the repo's package.json (cwd). */
function readVersion(): string {
  if (process.env.AIGLOO_VERSION) return process.env.AIGLOO_VERSION;
  for (const dir of [process.cwd(), resolve(process.cwd(), "..")]) {
    try {
      const pkg = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "aigloo" && pkg.version) return pkg.version;
    } catch { /* try next */ }
  }
  return "0.0.0";
}

/** True if semver `a` is strictly newer than `b` (numeric compare, ignores pre-release). */
function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** Endpoint settings: toggles + masked gateway keys + port. */
function endpointPayload(config: Config) {
  return {
    port: config.server.port,
    rtk: config.endpoint.rtk,
    caveman: config.endpoint.caveman,
    ponytail: config.endpoint.ponytail,
    headroom: config.endpoint.headroom,
    keys: config.server.api_keys.map((k) => ({
      key: maskKey(k),
      fingerprint: clientKeyFingerprint(k),
      name: config.server.key_names?.[k],
      models: config.server.key_models?.[k],
      rpm: config.server.key_rpm?.[k],
      expires: config.server.key_expires?.[k],
    })),
  };
}

/** Build the SSE console stream. */
function consoleStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let keepalive: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream<Uint8Array>({
    start(controller) {
      const recent = consoleBuffer.recent();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "init", logs: recent })}\n\n`));

      unsub = consoleBuffer.subscribe((entry) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "line", ...entry })}\n\n`));
      });

      keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15000);
    },
    cancel() {
      if (keepalive) clearInterval(keepalive);
      if (unsub) unsub();
    },
  });
}

export async function handleAdmin(
  method: string,
  segments: string[],
  search: URLSearchParams,
  body: unknown,
  deps: AdminDeps,
): Promise<AdminResult> {
  if (!pricingInitialized) {
    initAdmin(deps);
  }

  const s = segments;
  const m = method.toUpperCase();
  const b = (body ?? {}) as Record<string, unknown>;

  // ---- password ----
  if (m === "PUT" && s.length === 1 && s[0] === "password") {
    if (typeof b.current !== "string" || typeof b.next !== "string") {
      return { status: 400, body: { error: "current and next are required" } };
    }
    const r = deps.auth.change(b.current, b.next);
    if (!r.ok) return { status: 400, body: { error: r.error } };
    return { status: 200, body: { ok: true } };
  }

  // ---- usage ----
  if (m === "GET" && s.length === 1 && s[0] === "usage") {
    if (!deps.db) return { status: 503, body: { error: "usage tracking disabled" } };
    const since = search.has("since") ? Number(search.get("since")) : 0;
    return { status: 200, body: deps.db.summary(Number.isFinite(since) ? since : 0) };
  }

  if (m === "GET" && s.length === 2 && s[0] === "usage" && s[1] === "series") {
    if (!deps.db) return { status: 503, body: { error: "usage tracking disabled" } };
    const since = Number(search.get("since"));
    const bucket = Number(search.get("bucket"));
    const sinceMs = Number.isFinite(since) && since > 0 ? since : Date.now() - 24 * 3600 * 1000;
    const bucketMs = Number.isFinite(bucket) && bucket > 0 ? bucket : 3600 * 1000;
    return { status: 200, body: { series: deps.db.series(sinceMs, bucketMs) } };
  }

  if (m === "GET" && s.length === 2 && s[0] === "savings" && s[1] === "summary") {
    if (!deps.db) return { status: 503, body: { error: "usage tracking disabled" } };
    const since = search.has("since") ? Number(search.get("since")) : 0;
    return { status: 200, body: deps.db.savingsSummary(Number.isFinite(since) ? since : 0) };
  }

  if (m === "GET" && s.length === 1 && s[0] === "logs") {
    if (!deps.db) return { status: 503, body: { error: "usage tracking disabled" } };
    const limit = search.has("limit") ? Number(search.get("limit")) : 100;
    return { status: 200, body: { logs: deps.db.recent(Number.isFinite(limit) ? limit : 100) } };
  }

  // ---- providers (read) ----
  if (m === "GET" && s.length === 1 && s[0] === "providers") {
    return { status: 200, body: { providers: deps.state.pool.snapshot(deps.state.config.listProviders()) } };
  }

  if (m === "GET" && s.length === 2 && s[0] === "providers" && s[1] === "export") {
    const providers = deps.state.config.raw.providers;
    return {
      status: 200,
      body: JSON.stringify({ providers }, null, 2),
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="aigloo-providers.json"',
      },
    };
  }

  if (m === "POST" && s.length === 2 && s[0] === "providers" && s[1] === "import") {
    if (!Array.isArray(b.providers)) {
      return { status: 400, body: { error: "body must include a providers[] array" } };
    }
    let parsed: Provider[];
    try {
      parsed = (b.providers as unknown[]).map((p) => ProviderSchema.parse(p));
    } catch (e) {
      return { status: 400, body: { error: `invalid provider: ${(e as Error).message}` } };
    }
    const { config: next, result } = importProviders(deps.state.config.raw, parsed);
    deps.state.reload(serializeConfig(next));
    deps.log(`[admin] imported providers — added: ${result.added.length}, merged: ${result.merged.length}, skipped: ${result.skipped.length}`);
    return { status: 200, body: { ok: true, result } };
  }

  if (m === "POST" && s.length === 2 && s[0] === "providers" && s[1] === "validate") {
    if (!b.format || !b.base_url) {
      return { status: 400, body: { error: "format and base_url required" } };
    }
    const probe = {
      id: "_probe",
      format: b.format,
      base_url: b.base_url,
      api_key: b.api_key,
      free: !b.api_key,
      auto_models: false,
      models: [],
    } as unknown as Provider;
    return { status: 200, body: await pingProvider(probe, b.api_key as string | undefined) };
  }

  if (m === "POST" && s.length === 2 && s[0] === "providers" && s[1] === "test-all") {
    const providers = deps.state.config.raw.providers.filter((p) => !p.disabled);
    const results = await Promise.all(
      providers.map(async (p) => {
        const key = p.api_keys?.[0] ?? p.api_key;
        const result = await pingProvider(p, key, p.models[0]?.id);
        return { id: p.id, name: p.name ?? p.id, ...result };
      }),
    );
    const passed = results.filter((r) => r.ok).length;
    return {
      status: 200,
      body: {
        results,
        summary: { total: results.length, passed, failed: results.length - passed },
      },
    };
  }

  if (m === "POST" && s.length === 1 && s[0] === "providers") {
    if (!b.id || !b.format || !b.base_url) {
      return { status: 400, body: { error: "id, format, base_url required" } };
    }
    return applyMutation(deps, (c) =>
      addProvider(c, {
        id: b.id as string,
        name: b.name as string | undefined,
        format: b.format as Provider["format"],
        base_url: b.base_url as string,
        api_key: b.api_key as string | undefined,
        free: b.free as boolean | undefined,
        auto_models: b.auto_models as boolean | undefined,
        service_account: b.service_account as string | undefined,
      }),
    );
  }

  if (m === "PUT" && s.length === 2 && s[0] === "providers" && s[1] === "reorder") {
    if (!Number.isInteger(b.from) || !Number.isInteger(b.to)) {
      return { status: 400, body: { error: "from and to must be integers" } };
    }
    return applyMutation(deps, (c) => reorderProvider(c, b.from as number, b.to as number));
  }

  // providers/:id (non-keyed sub-routes first)
  if (s.length >= 2 && s[0] === "providers") {
    const id = s[1]!;

    if (m === "PUT" && s.length === 2) {
      return applyMutation(deps, (c) =>
        editProvider(c, id, {
          base_url: b.base_url as string | undefined,
          format: b.format as Provider["format"] | undefined,
          name: b.name as string | undefined,
        }),
      );
    }

    if (m === "PUT" && s.length === 3 && s[2] === "rename") {
      if (!b.id) return { status: 400, body: { error: "new id required" } };
      return applyMutation(deps, (c) => renameProvider(c, id, b.id as string));
    }

    if (m === "DELETE" && s.length === 2) {
      return applyMutation(deps, (c) => removeProvider(c, id));
    }

    if (m === "PUT" && s.length === 3 && s[2] === "strategy") {
      return applyMutation(deps, (c) =>
        setProviderStrategy(c, id, (b.strategy as "fallback" | "round-robin" | null) ?? null, b.sticky as number | undefined),
      );
    }

    if (m === "PUT" && s.length === 3 && s[2] === "disabled") {
      return applyMutation(deps, (c) => setProviderDisabled(c, id, b.disabled === true));
    }

    if (m === "POST" && s.length === 3 && s[2] === "test") {
      const provider = deps.state.config.raw.providers.find((p) => p.id === id);
      if (!provider) return { status: 404, body: { error: `provider "${id}" not found` } };
      const key = provider.api_keys?.[0] ?? provider.api_key;
      return { status: 200, body: await pingProvider(provider, key, provider.models[0]?.id) };
    }

    if (m === "POST" && s.length === 3 && s[2] === "connect") {
      const provider = deps.state.config.getProvider(id);
      if (!provider) return { status: 404, body: { error: `provider "${id}" not found` } };
      const result = await fetchModels(provider);
      if (!result.ok) return { status: 502, body: { error: result.error ?? "model fetch failed" } };
      const have = new Set(provider.models.map((mm) => mm.id));
      const models = result.models.map((mm) => ({ id: mm.id, added: have.has(mm.id) }));
      return { status: 200, body: { ok: true, models } };
    }

    // providers/:id/keys
    if (s.length >= 3 && s[2] === "keys") {
      if (m === "POST" && s.length === 3) {
        if (!b.key) return { status: 400, body: { error: "key required" } };
        return applyMutation(deps, (c) => addProviderKey(c, id, b.key as string, b.name as string | undefined));
      }

      if (m === "PUT" && s.length === 4 && s[3] === "reorder") {
        if (!Number.isInteger(b.from) || !Number.isInteger(b.to)) {
          return { status: 400, body: { error: "from and to must be integers" } };
        }
        return applyMutation(deps, (c) => reorderProviderKey(c, id, b.from as number, b.to as number));
      }

      if (m === "POST" && s.length === 4 && s[3] === "check") {
        const provider = deps.state.config.raw.providers.find((p) => p.id === id);
        if (!provider) return { status: 404, body: { error: `provider "${id}" not found` } };
        const key = (b as { key?: string }).key;
        if (!key?.trim()) return { status: 400, body: { error: "key is required" } };
        return { status: 200, body: await pingProvider(provider, key.trim(), provider.models[0]?.id) };
      }

      // providers/:id/keys/:index
      if (s.length >= 4) {
        const index = s[3];
        const i = Number(index);

        if (m === "PUT" && s.length === 4) {
          if (!Number.isInteger(i)) return { status: 400, body: { error: "index must be an integer" } };
          return applyMutation(deps, (c) =>
            editProviderKey(c, id, i, { key: b.key as string | undefined, name: b.name as string | undefined }),
          );
        }

        if (m === "DELETE" && s.length === 4) {
          if (!Number.isInteger(i)) return { status: 400, body: { error: "index must be an integer" } };
          return applyMutation(deps, (c) => removeProviderKey(c, id, i));
        }

        if (m === "PUT" && s.length === 5 && s[4] === "toggle") {
          if (!Number.isInteger(i)) return { status: 400, body: { error: "index must be an integer" } };
          if (typeof b.enabled !== "boolean") return { status: 400, body: { error: "enabled (boolean) required" } };
          return applyMutation(deps, (c) => toggleProviderKey(c, id, i, b.enabled as boolean));
        }

        if (m === "GET" && s.length === 5 && s[4] === "reveal") {
          const provider = deps.state.config.raw.providers.find((p) => p.id === id);
          if (!provider) return { status: 404, body: { error: `provider "${id}" not found` } };
          const keys = provider.api_keys ?? (provider.api_key ? [provider.api_key] : []);
          if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
            return { status: 404, body: { error: "key index out of range" } };
          }
          return { status: 200, body: { key: keys[i] } };
        }

        if (m === "POST" && s.length === 5 && s[4] === "test") {
          const provider = deps.state.config.raw.providers.find((p) => p.id === id);
          if (!provider) return { status: 404, body: { error: `provider "${id}" not found` } };
          const keys = provider.api_keys ?? (provider.api_key ? [provider.api_key] : []);
          if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
            return { status: 404, body: { error: "key index out of range" } };
          }
          const key = keys[i]!;
          const result = await pingProvider(provider, key, provider.models[0]?.id);
          if (result.ok) {
            deps.state.pool.success(provider, key);
          } else if (result.reachable && result.status) {
            deps.state.pool.penalize(provider, key, {
              message: result.error ?? `upstream returned ${result.status}`,
              status: result.status,
            });
          }
          return { status: 200, body: result };
        }
      }
    }

    // providers/:id/models
    if (s.length >= 3 && s[2] === "models") {
      if (m === "POST" && s.length === 3) {
        if (Array.isArray(b.models)) {
          if ((b.models as unknown[]).length === 0) return { status: 400, body: { error: "models[] empty" } };
          return applyMutation(deps, (c) => addProviderModels(c, id, b.models as string[]));
        }
        if (!b.model) return { status: 400, body: { error: "model or models[] required" } };
        return applyMutation(deps, (c) =>
          addProviderModel(c, id, b.model as string, {
            price_in: b.price_in as number | undefined,
            price_out: b.price_out as number | undefined,
          }),
        );
      }

      if (m === "DELETE" && s.length === 3) {
        const model = search.get("model");
        if (model) return applyMutation(deps, (c) => removeProviderModel(c, id, model));
        return applyMutation(deps, (c) => clearProviderModels(c, id));
      }

      if (m === "POST" && s.length === 4 && s[3] === "test") {
        const modelId = search.get("model");
        if (!modelId) return { status: 400, body: { error: "model query param required" } };
        const provider = deps.state.config.raw.providers.find((p) => p.id === id);
        if (!provider) return { status: 404, body: { error: `provider "${id}" not found` } };
        try {
          await handle(
            { config: deps.state.config, pool: deps.state.pool, db: deps.db },
            "openai",
            { model: `${id}/${modelId}`, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false },
          );
          return { status: 200, body: { ok: true } };
        } catch (e) {
          if (e instanceof GatewayError) {
            const payloadError = (e.payload as { error?: unknown })?.error;
            const msg = typeof e.payload === "string" ? e.payload
              : typeof payloadError === "string" ? payloadError
              : typeof (payloadError as { message?: string })?.message === "string" ? (payloadError as { message: string }).message
              : JSON.stringify(e.payload);
            return { status: 200, body: { ok: false, status: e.status, error: msg } };
          }
          return { status: 200, body: { ok: false, error: (e as Error).message } };
        }
      }

      if (m === "PUT" && s.length === 4 && s[3] === "price") {
        if (!b.model) return { status: 400, body: { error: "model required" } };
        return applyMutation(deps, (c) =>
          setProviderModelPrice(c, id, b.model as string, {
            price_in: b.price_in as number | null | undefined,
            price_out: b.price_out as number | null | undefined,
          }),
        );
      }
    }
  }

  // ---- budgets ----
  if (m === "GET" && s.length === 1 && s[0] === "budgets") {
    return { status: 200, body: { budgets: deps.state.budget.statuses() } };
  }

  if (m === "PUT" && s.length === 1 && s[0] === "budgets") {
    return applyMutation(deps, (c) => setBudget(c, b as unknown as Budget));
  }

  if (m === "DELETE" && s.length === 2 && s[0] === "budgets") {
    const key = decodeURIComponent(s[1]!);
    return applyMutation(deps, (c) => clearBudget(c, key));
  }

  // ---- config ----
  if (m === "GET" && s.length === 1 && s[0] === "config") {
    return { status: 200, body: maskedConfig(deps.state.config.raw) };
  }

  if (m === "GET" && s.length === 2 && s[0] === "config" && s[1] === "export") {
    return {
      status: 200,
      body: serializeConfig(deps.state.config.raw),
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="aigloo-config.yaml"',
      },
    };
  }

  if (m === "PUT" && s.length === 1 && s[0] === "config") {
    const text = typeof body === "string" ? body : (b as { text?: string })?.text;
    if (typeof text !== "string" || !text.trim()) {
      return { status: 400, body: { error: "body must include config text" } };
    }
    try {
      deps.state.reload(text);
    } catch (e) {
      return { status: 400, body: { error: (e as Error).message } };
    }
    deps.log("[admin] config hot-reloaded");
    return { status: 200, body: { ok: true, config: maskedConfig(deps.state.config.raw) } };
  }

  // ---- models ----
  if (m === "GET" && s.length === 1 && s[0] === "models") {
    const providers = deps.state.config
      .listProviders()
      .filter((p) => !p.disabled)
      .map((p) => ({
        id: p.id,
        format: p.format,
        models: p.models.map((mm) => ({ id: mm.id, ref: `${p.id}/${mm.id}`, price_in: mm.price_in, price_out: mm.price_out })),
      }));
    const routes = deps.state.config.listRoutes();
    return { status: 200, body: { providers, routes } };
  }

  // ---- pricing ----
  if (m === "GET" && s.length === 1 && s[0] === "pricing") {
    const dbOverrides = deps.db?.listPricingOverrides() ?? [];
    const overrides: Record<string, { input?: number; output?: number; cached?: number; cache_creation?: number; reasoning?: number }> = {};
    for (const o of dbOverrides) {
      overrides[o.model] = {
        ...(o.input !== null ? { input: o.input } : {}),
        ...(o.output !== null ? { output: o.output } : {}),
        ...(o.cached !== null ? { cached: o.cached } : {}),
        ...(o.cache_creation !== null ? { cache_creation: o.cache_creation } : {}),
        ...(o.reasoning !== null ? { reasoning: o.reasoning } : {}),
      };
    }
    const providers = deps.state.config.listProviders().map((p) => ({
      id: p.id,
      models: p.models.map((mm) => {
        const def = getPricingForModel(p.id, mm.id);
        const o = overrides[mm.id];
        return {
          id: mm.id,
          price_in: mm.price_in ?? null,
          price_out: mm.price_out ?? null,
          default_in: def?.input ?? null,
          default_out: def?.output ?? null,
          override: o ?? null,
        };
      }),
    }));
    return { status: 200, body: { providers, overrides } };
  }

  // ---- pricing sync ----
  if (s[0] === "pricing" && s[1] === "sync") {
    if (m === "GET") {
      return { status: 200, body: getSyncStatus() };
    }
    if (m === "POST") {
      if (!deps.db) return { status: 500, body: { error: "db not available" } };
      const source = typeof b.source === "string" ? (b.source as PricingSource) : undefined;
      const result = source === "modelsdev" || source === "litellm"
        ? (source === "modelsdev" ? syncModelsDev : syncLitellm)(deps.db)
        : syncAll(deps.db).then((r) => ({ success: r.modelsdev.success && r.litellm.success, source: "all" as const, modelCount: r.modelsdev.modelCount + r.litellm.modelCount }));
      return { status: 200, body: await result };
    }
    if (m === "DELETE") {
      if (!deps.db) return { status: 500, body: { error: "db not available" } };
      const source = typeof b.source === "string" ? (b.source as PricingSource) : undefined;
      clearSynced(deps.db, source);
      return { status: 200, body: { ok: true } };
    }
  }

  if (m === "PUT" && s.length === 2 && s[0] === "pricing") {
    const model = decodeURIComponent(s[1]!);
    if (!deps.db) return { status: 500, body: { error: "db not available" } };
    deps.db.setPricingOverride(model, b as {
      input?: number | null;
      output?: number | null;
      cached?: number | null;
      cache_creation?: number | null;
      reasoning?: number | null;
    });
    reloadPricingOverrides(deps);
    return { status: 200, body: { ok: true } };
  }

  if (m === "DELETE" && s.length === 2 && s[0] === "pricing") {
    const model = decodeURIComponent(s[1]!);
    if (!deps.db) return { status: 500, body: { error: "db not available" } };
    deps.db.deletePricingOverride(model);
    reloadPricingOverrides(deps);
    return { status: 200, body: { ok: true } };
  }

  // ---- capabilities ----
  if (m === "GET" && s.length === 1 && s[0] === "capabilities") {
    return {
      status: 200,
      body: {
        default: DEFAULT_CAPABILITIES,
        model: MODEL_CAPABILITIES,
        provider: PROVIDER_CAPABILITIES,
        pattern: PATTERN_CAPABILITIES,
      },
    };
  }

  // ---- routes (combos) ----
  if (m === "PUT" && s.length === 2 && s[0] === "routes") {
    const alias = decodeURIComponent(s[1]!);
    if (!Array.isArray(b.target) || (b.target as unknown[]).length === 0) {
      return { status: 400, body: { error: "target[] required" } };
    }
    return applyMutation(deps, (c) =>
      setRoute(c, {
        alias,
        target: b.target as string[],
        model: b.model as string | string[] | undefined,
        strategy: b.strategy as "fallback" | "round-robin" | undefined,
        sticky: b.sticky as number | undefined,
        price_in: b.price_in as number | undefined,
        price_out: b.price_out as number | undefined,
      }),
    );
  }

  if (m === "DELETE" && s.length === 2 && s[0] === "routes") {
    const alias = decodeURIComponent(s[1]!);
    return applyMutation(deps, (c) => removeRoute(c, alias));
  }

  // ---- endpoint ----
  if (m === "GET" && s.length === 1 && s[0] === "endpoint") {
    return { status: 200, body: endpointPayload(deps.state.config.raw) };
  }

  if (m === "PUT" && s.length === 2 && s[0] === "endpoint" && s[1] === "rtk") {
    return applyMutation(deps, (c) => setRtk(c, !!b.enabled));
  }

  if (m === "PUT" && s.length === 2 && s[0] === "endpoint" && s[1] === "caveman") {
    if (!isLevel(b.level)) return { status: 400, body: { error: "level must be off|lite|full|ultra" } };
    return applyMutation(deps, (c) => setCaveman(c, b.level as EndpointSettings["caveman"]));
  }

  if (m === "PUT" && s.length === 2 && s[0] === "endpoint" && s[1] === "ponytail") {
    if (!isLevel(b.level)) return { status: 400, body: { error: "level must be off|lite|full|ultra" } };
    return applyMutation(deps, (c) => setPonytail(c, b.level as EndpointSettings["ponytail"]));
  }

  if (m === "PUT" && s.length === 2 && s[0] === "endpoint" && s[1] === "headroom") {
    return applyMutation(deps, (c) =>
      setHeadroom(c, {
        enabled: b.enabled as boolean | undefined,
        url: b.url as string | undefined,
        compress_user_messages: b.compress_user_messages as boolean | undefined,
      }),
    );
  }

  if (m === "POST" && s.length === 2 && s[0] === "endpoint" && s[1] === "keys") {
    if (!b.key) return { status: 400, body: { error: "key required" } };
    return applyMutation(deps, (c) => addServerKey(c, b.key as string, b.name as string | undefined));
  }

  if (m === "PUT" && s.length === 3 && s[0] === "endpoint" && s[1] === "keys") {
    const i = Number(s[2]);
    if (!Number.isInteger(i)) return { status: 400, body: { error: "index must be an integer" } };
    return applyMutation(deps, (c) => editServerKey(c, i, { name: b.name as string | undefined }));
  }

  if (m === "PUT" && s.length === 4 && s[0] === "endpoint" && s[1] === "keys" && s[3] === "scope") {
    const i = Number(s[2]);
    if (!Number.isInteger(i)) return { status: 400, body: { error: "index must be an integer" } };
    return applyMutation(deps, (c) =>
      setServerKeyScope(c, i, {
        models: b.models as string[] | undefined,
        rpm: b.rpm as number | null | undefined,
        expires: b.expires as number | null | undefined,
      }),
    );
  }

  if (m === "DELETE" && s.length === 3 && s[0] === "endpoint" && s[1] === "keys") {
    const i = Number(s[2]);
    if (!Number.isInteger(i)) return { status: 400, body: { error: "index must be an integer" } };
    return applyMutation(deps, (c) => removeServerKey(c, i));
  }

  if (m === "GET" && s.length === 4 && s[0] === "endpoint" && s[1] === "keys" && s[3] === "reveal") {
    const i = Number(s[2]);
    const keys = deps.state.config.raw.server.api_keys;
    if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
      return { status: 404, body: { error: "key index out of range" } };
    }
    return { status: 200, body: { key: keys[i] } };
  }

  // ---- keys ----
  if (m === "GET" && s.length === 1 && s[0] === "keys") {
    const cfg = deps.state.config.raw.server;
    return {
      status: 200,
      body: cfg.api_keys.map((k) => ({
        fingerprint: clientKeyFingerprint(k),
        name: cfg.key_names?.[k] ?? maskKey(k),
        masked: maskKey(k),
      })),
    };
  }

  if (m === "GET" && s.length === 2 && s[0] === "keys" && s[1] === "usage") {
    if (!deps.db) return { status: 503, body: { error: "usage tracking disabled" } };
    const cfg = deps.state.config.raw;
    const statuses = deps.state.budget.statuses();
    const keys = cfg.server.api_keys.map((k) => {
      const fp = clientKeyFingerprint(k);
      return buildKeyUsageRow({
        fingerprint: fp,
        name: cfg.server.key_names?.[k] ?? maskKey(k),
        masked: maskKey(k),
        expires: cfg.server.key_expires?.[k],
        totals: deps.db!.totals(0, { client_key: fp }),
        budget: statuses.find((ss) => ss.scope.type === "key" && ss.scope.id === fp) ?? null,
      });
    });
    return { status: 200, body: { keys } };
  }

  // ---- headroom ----
  if (m === "GET" && s.length === 2 && s[0] === "headroom" && s[1] === "status") {
    const hr = deps.state.config.raw.endpoint.headroom;
    const url = hr.url || DEFAULT_HEADROOM_URL;
    const status = await getHeadroomStatus(url);
    return {
      status: 200,
      body: {
        ...status,
        url,
        managedPid: getManagedPid(),
        enabled: hr.enabled,
        compress_user_messages: hr.compress_user_messages,
      },
    };
  }

  if (m === "POST" && s.length === 2 && s[0] === "headroom" && s[1] === "start") {
    const url = deps.state.config.raw.endpoint.headroom.url || DEFAULT_HEADROOM_URL;
    if (!isLoopbackHeadroomUrl(url)) {
      return { status: 400, body: { error: "external headroom proxies must be started outside aigloo", code: "EXTERNAL_PROXY" } };
    }
    let port = 8787;
    try {
      const p = parseInt(new URL(url).port, 10);
      if (p > 0 && p < 65536) port = p;
    } catch {
      /* default */
    }
    try {
      const result = await startHeadroomProxy({ port });
      return { status: 200, body: { success: true, ...result } };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { status: err.code === "NOT_INSTALLED" ? 400 : 500, body: { error: err.message, code: err.code ?? null } };
    }
  }

  if (m === "POST" && s.length === 2 && s[0] === "headroom" && s[1] === "stop") {
    try {
      const result = stopHeadroomProxy();
      return { status: result.stopped ? 200 : 409, body: result };
    } catch (e) {
      const err = e as Error & { code?: string };
      return { status: 500, body: { error: err.message, code: err.code ?? null } };
    }
  }

  if (m === "GET" && s.length === 2 && s[0] === "headroom" && s[1] === "log") {
    return { status: 200, body: { log: getHeadroomLogTail() } };
  }

  // ---- console ----
  if (m === "GET" && s.length === 2 && s[0] === "console" && s[1] === "stream") {
    return {
      status: 200,
      stream: consoleStream(),
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    };
  }

  if (m === "DELETE" && s.length === 1 && s[0] === "console") {
    consoleBuffer.clear();
    return { status: 200, body: { ok: true } };
  }

  // ---- version ----
  if (m === "GET" && s.length === 1 && s[0] === "version") {
    const current = readVersion();
    let latest: string | null = null;
    try {
      const res = await fetch("https://registry.npmjs.org/aigloo/latest", {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const j = (await res.json()) as { version?: string };
        latest = j.version ?? null;
      }
    } catch {
      /* offline or unpublished — leave latest null (no update info) */
    }
    return { status: 200, body: { current, latest, updateAvailable: !!(latest && isNewerVersion(latest, current)) } };
  }

  // ---- autostart ----
  if (m === "GET" && s.length === 1 && s[0] === "autostart") {
    try {
      const { isAutoStartEnabled } = await import("../cli/tray/autostart.js");
      return { status: 200, body: { enabled: isAutoStartEnabled() } };
    } catch {
      return { status: 200, body: { enabled: false } };
    }
  }

  if (m === "POST" && s.length === 1 && s[0] === "autostart") {
    const { enabled } = b as { enabled?: boolean };
    try {
      if (enabled) {
        const { enableAutoStart } = await import("../cli/tray/autostart.js");
        const ok = enableAutoStart();
        return { status: 200, body: { enabled: ok } };
      } else {
        const { disableAutoStart } = await import("../cli/tray/autostart.js");
        disableAutoStart();
        return { status: 200, body: { enabled: false } };
      }
    } catch (e) {
      return { status: 500, body: { error: String(e) } };
    }
  }

  // ---- tunnel ----
  const tunnelSecurity = () => ({
    hasAuth: (deps.state.config.raw.server?.api_keys ?? []).length > 0,
    isDefaultPassword: deps.auth.verify("123456"),
  });

  if (m === "GET" && s.length === 1 && s[0] === "tunnel") {
    const { isTunnelRunning, getTunnelUrl } = await import("../tunnel/cloudflared.js");
    return { status: 200, body: { enabled: isTunnelRunning(), url: getTunnelUrl(), ...tunnelSecurity() } };
  }

  if (m === "POST" && s.length === 1 && s[0] === "tunnel") {
    const { startQuickTunnel, isTunnelRunning, getTunnelUrl } = await import("../tunnel/cloudflared.js");
    if (isTunnelRunning()) return { status: 200, body: { enabled: true, url: getTunnelUrl(), ...tunnelSecurity() } };
    const port = deps.state.config.raw.server?.port ?? 18080;
    try {
      const url = await startQuickTunnel(port);
      return { status: 200, body: { enabled: true, url, ...tunnelSecurity() } };
    } catch (e) {
      return { status: 500, body: { error: String((e as Error).message) } };
    }
  }

  if (m === "DELETE" && s.length === 1 && s[0] === "tunnel") {
    const { stopTunnel } = await import("../tunnel/cloudflared.js");
    stopTunnel();
    return { status: 200, body: { enabled: false, url: null, ...tunnelSecurity() } };
  }

  // ---- shutdown ----
  if (m === "POST" && s.length === 1 && s[0] === "shutdown") {
    deps.log("[admin] shutdown requested via dashboard");
    setTimeout(() => {
      deps.db?.close();
      process.exit(0);
    }, 300);
    return { status: 200, body: { ok: true, message: "shutting down" } };
  }

  // ---- notifications ----
  if (m === "GET" && s.length === 1 && s[0] === "notifications") {
    const configs = deps.db?.listNotificationConfigs() ?? [];
    const alerts = deps.db?.recentAlerts(50) ?? [];
    return { status: 200, body: { configs, alerts } };
  }

  if (m === "PUT" && s.length === 2 && s[0] === "notifications") {
    const id = s[1]!;
    if (!deps.db) return { status: 500, body: { error: "db not available" } };
    deps.db.setNotificationConfig({
      id,
      enabled: (b.enabled as boolean | undefined) ?? false,
      url: b.url as string | undefined,
      token: b.token as string | undefined,
      chat_id: b.chat_id as string | undefined,
      events: b.events as string[] | undefined,
    });
    return { status: 200, body: { ok: true } };
  }

  if (m === "POST" && s.length === 3 && s[0] === "notifications" && s[2] === "test") {
    const id = s[1]!;
    if (!deps.notifier) return { status: 500, body: { error: "notifier not available" } };
    const result = await deps.notifier.test(id);
    return { status: 200, body: result };
  }

  // ---- fallback ----
  return { status: 404, body: { error: "not found" } };
}
