import {
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { z } from "zod";
import { clientKeyFingerprint } from "./middleware/auth.js";

export { clientKeyFingerprint } from "./middleware/auth.js";

// ---- schema (PLAN §8) -------------------------------------------------------
//
// Shape differs from a flat OpenAI gateway: routing lives in a top-level
// `models[]` layer (alias -> provider chain), the endpoint block carries the
// token-saver toggles, and providers may be free passthroughs or service-account
// backed. The handler/keypool phases read these fields; defining the full
// shape up front avoids reshaping config across later phases.

const ProviderModelSchema = z.object({
  id: z.string().min(1),
  price_in: z.number().nonnegative().optional(),
  price_out: z.number().nonnegative().optional(),
});

export const ProviderSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    format: z.enum(["openai", "anthropic", "gemini"]),
    base_url: z.string().url(),
    api_key: z.string().min(1).optional(),
    api_keys: z.array(z.string().min(1)).optional(),
    // optional friendly label per key, keyed by the raw key string (like the
    // server's key_names). api_keys stays a plain string[] so auth/masking paths
    // are untouched.
    key_names: z.record(z.string()).optional(),
    // free passthrough (OpenCode Free): no upstream auth required.
    free: z.boolean().default(false),
    // fetch the provider's model catalog at runtime instead of from config.
    auto_models: z.boolean().default(false),
    // path to a GCP service-account JSON (Vertex AI): JWT-exchanged for tokens.
    service_account: z.string().optional(),
    models: z.array(ProviderModelSchema).default([]),
    headers: z.record(z.string()).optional(),
    // when true the provider is skipped in routing (kept in config, like a key's
    // disabled state but for the whole provider).
    disabled: z.boolean().optional(),
    disabled_keys: z.array(z.number().int().nonnegative()).optional(),
    strategy: z.enum(["fallback", "round-robin"]).optional(),
    sticky: z.number().int().positive().optional(),
  })
  .refine((p) => p.free || p.service_account || p.api_key || (p.api_keys?.length ?? 0) > 0, {
    message: "provider needs api_key/api_keys, or free: true, or service_account",
  });

/**
 * A combo — a client-facing `alias` resolved to an ordered chain
 * of providers, tried by `strategy`. `model[i]` pairs with `target[i]`; a single
 * string applies to all targets; omitted falls back to the alias name as the
 * upstream model id. Call the alias directly as the model name from a CLI tool.
 */
const ModelRouteSchema = z.object({
  alias: z.string().min(1),
  target: z.array(z.string().min(1)).min(1),
  model: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
  // fallback: try targets in order. round-robin: rotate the first target tried
  // per request to spread load across the chain.
  strategy: z.enum(["fallback", "round-robin"]).default("fallback"),
  // round-robin sticky: N consecutive requests to the same model before rotating.
  sticky: z.number().int().positive().default(1),
  price_in: z.number().nonnegative().optional(),
  price_out: z.number().nonnegative().optional(),
});

// Headroom = external context-compression proxy. Off by default; url points at a
// locally-run `headroom proxy`. compress_user_messages also squeezes user turns.
const HeadroomSchema = z
  .object({
    enabled: z.boolean().default(false),
    url: z.string().default("http://localhost:8787"),
    compress_user_messages: z.boolean().default(false),
  })
  .default({ enabled: false, url: "http://localhost:8787", compress_user_messages: false });

const EndpointSchema = z
  .object({
    rtk: z.boolean().default(false),
    caveman: z.enum(["off", "lite", "full", "ultra"]).default("off"),
    ponytail: z.enum(["off", "lite", "full", "ultra"]).default("off"),
    headroom: HeadroomSchema,
  })
  .default({});

const ServerSchema = z
  .object({
    host: z.string().default("0.0.0.0"),
    port: z.number().int().positive().default(18080),
    // gateway-level keys clients must present. Empty => auth disabled (localhost).
    api_keys: z.array(z.string().min(1)).default([]),
    // optional friendly label per key, keyed by the key itself. Kept separate so
    // api_keys stays a plain string[] (auth/masking paths untouched).
    key_names: z.record(z.string()).optional(),
    // per-key model allowlist (call-strings) + rate limit (req/min), keyed by the
    // raw key like key_names. Absent → unrestricted / unlimited.
    key_models: z.record(z.array(z.string().min(1))).optional(),
    key_rpm: z.record(z.number().int().positive()).optional(),
    // per-key access expiry, epoch ms, keyed by the RAW key. Absent → never expires.
    key_expires: z.record(z.number().int().positive()).optional(),
  })
  .default({ host: "0.0.0.0", port: 18080, api_keys: [] });

/**
 * A spend budget scoped to the whole gateway, one provider, or one upstream
 * model. unit picks what `limit` means — USD cost or total tokens. Soft-alert at
 * alert_at (default 0.8), hard-stop at 100%. Each window is a rolling tumbling
 * bucket on the epoch grid (window.ts). Opt-in: omit / empty list to disable.
 */
const BudgetScopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("global") }),
  z.object({ type: z.literal("provider"), id: z.string().min(1) }),
  z.object({ type: z.literal("model"), id: z.string().min(1) }),
  z.object({ type: z.literal("key"), id: z.string().min(1) }),
]);

// rolling windows replaced the old calendar windows; coerce any legacy value so
// existing config.yaml budgets keep loading (daily→24h, weekly→7day, monthly→30day).
// "lifetime" / "total" = one-shot cap that never refills (all-time spend).
const LEGACY_WINDOW: Record<string, string> = {
  daily: "24h",
  weekly: "7day",
  monthly: "30day",
  total: "lifetime",
  once: "lifetime",
};
const WindowSchema = z.preprocess(
  (v) => (typeof v === "string" && v in LEGACY_WINDOW ? LEGACY_WINDOW[v] : v),
  z.string().refine(
    (s) => s === "lifetime" || /^\d+(h|day)$/.test(s),
    { message: "window must be like 5h, 24h, 7day, 30day, or lifetime" },
  ),
);

const BudgetSchema = z.object({
  scope: BudgetScopeSchema,
  unit: z.enum(["usd", "tokens"]),
  limit: z.number().positive(),
  window: WindowSchema,
  // epoch ms the recurring cycle is anchored to; stamped by setBudget on create.
  anchor: z.number().int().nonnegative().optional(),
  alert_at: z.number().gt(0).lte(1).optional(),
  // optional free-text label so an operator remembers what a budget is for.
  note: z.string().max(200).optional(),
});

const ConfigSchema = z.object({
  server: ServerSchema,
  endpoint: EndpointSchema,
  providers: z.array(ProviderSchema).default([]),
  // the routing layer. Each entry is a "combo": an alias + a provider chain.
  models: z.array(ModelRouteSchema).default([]),
  budgets: z.array(BudgetSchema).default([]),
});

export type ProviderModel = z.infer<typeof ProviderModelSchema>;
export type Provider = z.infer<typeof ProviderSchema>;
export type ModelRoute = z.infer<typeof ModelRouteSchema>;
export type EndpointSettings = z.infer<typeof EndpointSchema>;
export type BudgetScope = z.infer<typeof BudgetScopeSchema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface ResolvedRoute {
  /** client-facing alias that resolved to this route */
  alias: string;
  provider: Provider;
  /** upstream model id to send */
  model: string;
  price_in?: number;
  price_out?: number;
}

export class GatewayConfig {
  readonly server: Config["server"];
  readonly endpoint: Config["endpoint"];
  readonly raw: Config;
  private readonly providers: Map<string, Provider>;
  private readonly routes: Map<string, ModelRoute>;
  /** per-alias rotation state for the round-robin strategy (index + sticky count) */
  private readonly rrCursor: Map<string, { index: number; count: number }> = new Map();

  constructor(raw: Config) {
    this.raw = raw;
    this.server = raw.server;
    this.endpoint = raw.endpoint;
    this.providers = new Map(raw.providers.map((p) => [p.id, p]));
    this.routes = new Map(raw.models.map((m) => [m.alias, m]));

    // fail fast: a routing alias must only target known providers, else the
    // first request to that alias 404s at runtime with a confusing message.
    for (const m of raw.models) {
      for (const t of m.target) {
        if (!this.providers.has(t)) {
          throw new Error(`model alias "${m.alias}" targets unknown provider "${t}"`);
        }
      }
    }
  }

  /** Upstream model id for the i-th target of a route (see ModelRouteSchema). */
  private modelFor(route: ModelRoute, index: number): string {
    if (Array.isArray(route.model)) return route.model[index] ?? route.model[0] ?? route.alias;
    if (typeof route.model === "string") return route.model;
    return route.alias;
  }

  /**
   * Resolve a client model string to a prioritized chain of routes.
   *   - a combo alias => its target chain, ordered by the combo's strategy
   *     (fallback = config order; round-robin = rotate the first tried per call).
   *   - "provider/model" => single direct route to that provider.
   * Returns [] when nothing matches (handler turns that into a 404).
   */
  resolve(name: string): ResolvedRoute[] {
    const route = this.routes.get(name);
    if (route) {
      const built = route.target.flatMap((providerId, i) => {
        const provider = this.providers.get(providerId);
        if (!provider || provider.disabled) return [];
        return [
          {
            alias: name,
            provider,
            model: this.modelFor(route, i),
            price_in: route.price_in,
            price_out: route.price_out,
          },
        ];
      });
      if (route.strategy === "round-robin" && built.length > 1) {
        const state = this.rrCursor.get(name) ?? { index: 0, count: 0 };
        const sticky = route.sticky ?? 1;
        const start = state.index % built.length;
        const nextCount = state.count + 1;
        if (nextCount >= sticky) {
          this.rrCursor.set(name, { index: (state.index + 1) % built.length, count: 0 });
        } else {
          this.rrCursor.set(name, { index: state.index, count: nextCount });
        }
        return [...built.slice(start), ...built.slice(0, start)];
      }
      return built;
    }

    const slash = name.indexOf("/");
    if (slash > 0) {
      const providerId = name.slice(0, slash);
      const model = name.slice(slash + 1);
      const provider = this.providers.get(providerId);
      if (provider && !provider.disabled && model) {
        const entry = provider.models.find((m) => m.id === model);
        return [
          {
            alias: name,
            provider,
            model,
            price_in: entry?.price_in,
            price_out: entry?.price_out,
          },
        ];
      }
    }

    // No bare model auto-detect — require combo alias or provider/model prefix.
    return [];
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  listProviders(): Provider[] {
    return [...this.providers.values()];
  }

  listRoutes(): ModelRoute[] {
    return [...this.routes.values()];
  }
}

/** Validate an already-parsed config object. Throws with readable issues. */
export function validateConfig(parsed: unknown): GatewayConfig {
  // migrate the legacy single `budget` (pre-scoped) into a global-scoped entry
  // before zod runs — zod would otherwise strip the unknown `budget` key.
  if (parsed && typeof parsed === "object") {
    const raw = parsed as Record<string, unknown>;
    if (raw.budget && !raw.budgets) {
      const legacy = raw.budget as Record<string, unknown>;
      raw.budgets = [{ scope: { type: "global" }, ...legacy }];
    }
    delete raw.budget;
  }
  const result = ConfigSchema.safeParse(parsed ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`invalid config:\n${issues}`);
  }
  return new GatewayConfig(result.data);
}

export function loadConfig(path: string): GatewayConfig {
  const text = readFileSync(path, "utf8");
  try {
    return validateConfig(parseYaml(text));
  } catch (e) {
    throw new Error(`config at ${path}: ${(e as Error).message}`);
  }
}

/** Parse YAML or JSON text into a validated config (yaml parser accepts JSON). */
export function parseConfigText(text: string): GatewayConfig {
  return validateConfig(parseYaml(text));
}

export function serializeConfig(config: Config): string {
  return stringifyYaml(config);
}

/**
 * Mask a secret for display: keep a short suffix, hide the rest.
 * "" -> "(none)". "sk-abcdEFGHijklMNOP" -> "sk-…MNOP".
 */
export function maskKey(key: string): string {
  if (!key) return "(none)";
  if (key.length <= 12) return "…" + key.slice(-4);
  return key.slice(0, 7) + "…" + key.slice(-4);
}

function looksMasked(v: string): boolean {
  return v.includes("…");
}

/**
 * Resolve masked secrets in an edited config back to real values.
 *
 * The dashboard shows keys masked. On save, unchanged keys return still masked;
 * writing those verbatim would corrupt config. Map each masked value back to the
 * real key from the CURRENT config. A freshly-typed (unmasked) value is kept. An
 * unresolvable or ambiguous mask throws — better to refuse than write a wrong
 * secret. Mutates and returns `next`.
 */
export function unmaskSecrets(next: Config, current: Config): Config {
  const byMask = new Map<string, string | null>(); // mask -> real, or null if ambiguous
  const note = (real: string) => {
    if (!real) return;
    const m = maskKey(real);
    if (byMask.has(m) && byMask.get(m) !== real) byMask.set(m, null);
    else byMask.set(m, real);
  };
  for (const p of current.providers) {
    if (p.api_key) note(p.api_key);
    p.api_keys?.forEach(note);
  }
  current.server.api_keys.forEach(note);

  const resolve = (v: string): string => {
    if (!looksMasked(v)) return v;
    const real = byMask.get(v);
    if (real === undefined) throw new Error(`cannot resolve masked key "${v}" — type the real key`);
    if (real === null) throw new Error(`masked key "${v}" is ambiguous — type the real key`);
    return real;
  };

  for (const p of next.providers) {
    if (p.api_key) p.api_key = resolve(p.api_key);
    if (p.api_keys) p.api_keys = p.api_keys.map(resolve);
  }
  next.server.api_keys = next.server.api_keys.map(resolve);
  return next;
}

/**
 * Write config to disk atomically with a one-level backup. Backs up the existing
 * file to <path>.bak, writes a temp file, then renames over the target so a crash
 * mid-write can't leave a corrupt config.
 */
export function writeConfigFile(path: string, config: Config): void {
  const yaml = serializeConfig(config);
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) copyFileSync(path, path + ".bak");
  const tmp = path + ".tmp";
  writeFileSync(tmp, yaml, "utf8");
  renameSync(tmp, path);
}

// ---- granular config mutations (admin write surface) -----------------------
//
// Each returns a NEW Config (clone + mutate); the caller serializes it and feeds
// it through state.reload(), which re-validates (zod) and persists atomically.
// So url/length checks and schema defaults are enforced there — these helpers
// own only the structural change and the guards zod can't express.

function cloneConfig(config: Config): Config {
  return JSON.parse(JSON.stringify(config)) as Config;
}

/** Real keys a provider routes through, in the order the keypool sees them. */
function realKeysOf(p: Provider): string[] {
  if (p.api_keys && p.api_keys.length > 0) return p.api_keys;
  if (p.api_key) return [p.api_key];
  return [];
}

export function addProvider(
  config: Config,
  input: {
    id: string;
    name?: string;
    format: Provider["format"];
    base_url: string;
    api_key?: string;
    free?: boolean;
    auto_models?: boolean;
    service_account?: string;
  },
): Config {
  const next = cloneConfig(config);
  if (next.providers.some((p) => p.id === input.id)) {
    throw new Error(`provider "${input.id}" already exists`);
  }
  next.providers.push({
    id: input.id,
    ...(input.name ? { name: input.name } : {}),
    format: input.format,
    base_url: input.base_url,
    free: input.free ?? false,
    auto_models: input.auto_models ?? false,
    models: [],
    ...(input.api_key ? { api_keys: [input.api_key] } : {}),
    ...(input.service_account ? { service_account: input.service_account } : {}),
  });
  return next;
}

/** Edit a provider's base_url and/or format (id is immutable). */
export function editProvider(
  config: Config,
  id: string,
  patch: { base_url?: string; format?: Provider["format"]; name?: string },
): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (patch.base_url !== undefined) {
    if (!patch.base_url.trim()) throw new Error("base_url must not be empty");
    p.base_url = patch.base_url.trim();
  }
  if (patch.format !== undefined) p.format = patch.format;
  if (patch.name !== undefined) p.name = patch.name.trim() || undefined;
  return next;
}

/**
 * Rename a provider's id (the call prefix). Cascades to every combo that targets
 * it so routing stays intact — the id is the routing key, not just a label.
 */
export function renameProvider(config: Config, oldId: string, newId: string): Config {
  const next = cloneConfig(config);
  const trimmed = newId.trim();
  if (!trimmed) throw new Error("new provider id must not be empty");
  if (/\s|\//.test(trimmed)) throw new Error("provider id can't contain spaces or '/'");
  const p = next.providers.find((x) => x.id === oldId);
  if (!p) throw new Error(`provider "${oldId}" not found`);
  if (trimmed === oldId) return next;
  if (next.providers.some((x) => x.id === trimmed)) throw new Error(`provider "${trimmed}" already exists`);
  p.id = trimmed;
  // repoint any combo chains that referenced the old id.
  for (const m of next.models) {
    m.target = m.target.map((t) => (t === oldId ? trimmed : t));
  }
  return next;
}

/** Remove a provider; refuses if any routing alias still targets it. */
export function removeProvider(config: Config, id: string): Config {
  const next = cloneConfig(config);
  const idx = next.providers.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`provider "${id}" not found`);
  const usedBy = next.models.filter((m) => m.target.includes(id)).map((m) => m.alias);
  if (usedBy.length > 0) {
    throw new Error(`Cannot delete "${id}" — it is used in combos/routing: ${usedBy.join(", ")}. Remove it from those combos first.`);
  }
  next.providers.splice(idx, 1);
  return next;
}

export interface ImportResult {
  added: string[];
  merged: { id: string; newKeys: number }[];
  skipped: { id: string; reason: string }[];
}

export function importProviders(config: Config, incoming: Provider[]): { config: Config; result: ImportResult } {
  const next = cloneConfig(config);
  const result: ImportResult = { added: [], merged: [], skipped: [] };

  for (const imp of incoming) {
    const existing = next.providers.find((p) => p.id === imp.id);
    if (!existing) {
      next.providers.push(imp);
      result.added.push(imp.id);
      continue;
    }

    const existingKeys = new Set(realKeysOf(existing));
    const impKeys = realKeysOf(imp);
    const newKeys = impKeys.filter((k) => !existingKeys.has(k));

    if (newKeys.length === 0) {
      result.skipped.push({ id: imp.id, reason: "all keys already exist" });
      continue;
    }

    existing.api_keys = [...realKeysOf(existing), ...newKeys];
    delete existing.api_key;
    result.merged.push({ id: imp.id, newKeys: newKeys.length });
  }

  return { config: next, result };
}

export function addProviderKey(config: Config, id: string, key: string, name?: string): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (!key.trim()) throw new Error("key must not be empty");
  p.api_keys = [...realKeysOf(p), key];
  delete p.api_key;
  const label = name?.trim();
  if (label) p.key_names = { ...(p.key_names ?? {}), [key]: label };
  return next;
}

export function removeProviderKey(config: Config, id: string, index: number): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const keys = realKeysOf(p);
  if (index < 0 || index >= keys.length) throw new Error(`no key at index ${index} for provider "${id}"`);
  // free/service-account providers may legitimately hold zero keys; a keyed
  // provider keeps at least one (remove the provider instead to fully drop it).
  if (keys.length <= 1 && !p.free && !p.service_account) {
    throw new Error(`cannot remove the last key of "${id}" — delete the provider instead`);
  }
  const [removed] = keys.splice(index, 1);
  p.api_keys = keys;
  delete p.api_key;
  if (removed && p.key_names && removed in p.key_names) delete p.key_names[removed];
  return next;
}

// Edit one provider key in place: swap its value and/or rename it. Keeps the
// key's position in the list (so cooldown/health ordering stays meaningful).
export function editProviderKey(
  config: Config,
  id: string,
  index: number,
  patch: { key?: string; name?: string },
): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const keys = realKeysOf(p);
  if (index < 0 || index >= keys.length) throw new Error(`no key at index ${index} for provider "${id}"`);
  const old = keys[index];
  if (old === undefined) throw new Error(`no key at index ${index} for provider "${id}"`);
  const newKey = patch.key?.trim() ? patch.key.trim() : old;
  keys[index] = newKey;
  p.api_keys = keys;
  delete p.api_key;
  const names = { ...(p.key_names ?? {}) };
  const oldName = names[old];
  if (old !== newKey && old in names) delete names[old];
  // explicit name wins; otherwise carry the old label onto the new key value.
  const label = patch.name !== undefined ? patch.name.trim() : oldName;
  if (label) names[newKey] = label;
  else delete names[newKey];
  p.key_names = Object.keys(names).length > 0 ? names : undefined;
  return next;
}

/** Move a provider from one position to another in the providers array. */
export function reorderProvider(config: Config, from: number, to: number): Config {
  const next = cloneConfig(config);
  const n = next.providers.length;
  if (from < 0 || from >= n) throw new Error(`from index ${from} out of range`);
  if (to < 0 || to >= n) throw new Error(`to index ${to} out of range`);
  if (from === to) return next;
  const [moved] = next.providers.splice(from, 1);
  next.providers.splice(to, 0, moved!);
  return next;
}

/** Swap a provider key from one index to another, preserving names. */
export function reorderProviderKey(config: Config, id: string, from: number, to: number): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const keys = realKeysOf(p);
  if (from < 0 || from >= keys.length) throw new Error(`from index ${from} out of range`);
  if (to < 0 || to >= keys.length) throw new Error(`to index ${to} out of range`);
  if (from === to) return next;
  const [moved] = keys.splice(from, 1);
  keys.splice(to, 0, moved!);
  p.api_keys = keys;
  delete p.api_key;
  return next;
}

/** Toggle a key's disabled state. disabled_keys stores indexes of disabled keys. */
export function toggleProviderKey(config: Config, id: string, index: number, enabled: boolean): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const keys = realKeysOf(p);
  if (index < 0 || index >= keys.length) throw new Error(`key index ${index} out of range`);
  const disabled = new Set(p.disabled_keys ?? []);
  if (enabled) disabled.delete(index);
  else disabled.add(index);
  p.disabled_keys = disabled.size > 0 ? [...disabled].sort((a, b) => a - b) : undefined;
  return next;
}

/** Enable/disable a whole provider — disabled providers are skipped in routing. */
export function setProviderDisabled(config: Config, id: string, disabled: boolean): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (disabled) p.disabled = true;
  else delete p.disabled;
  return next;
}

/** Set per-provider strategy override (round-robin + sticky). */
export function setProviderStrategy(
  config: Config,
  id: string,
  strategy: "fallback" | "round-robin" | null,
  sticky?: number,
): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (strategy === null || strategy === "fallback") {
    delete p.strategy;
    delete p.sticky;
  } else {
    p.strategy = strategy;
    p.sticky = sticky && sticky > 0 ? sticky : 1;
  }
  return next;
}

export function addProviderModel(
  config: Config,
  id: string,
  model: string,
  price?: { price_in?: number; price_out?: number },
): Config {
  const trimmed = model.trim();
  if (!trimmed) throw new Error("model id must not be empty");
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  if (p.models.some((m) => m.id === trimmed)) {
    throw new Error(`provider "${id}" already serves model "${trimmed}"`);
  }
  p.models.push({
    id: trimmed,
    ...(price?.price_in !== undefined ? { price_in: price.price_in } : {}),
    ...(price?.price_out !== undefined ? { price_out: price.price_out } : {}),
  });
  return next;
}

export function removeProviderModel(config: Config, id: string, model: string): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const idx = p.models.findIndex((m) => m.id === model);
  if (idx === -1) throw new Error(`provider "${id}" does not serve model "${model}"`);
  p.models.splice(idx, 1);
  return next;
}

/**
 * Override a model's price (per 1M tokens). null clears the override so cost falls
 * back to the auto pricing table; undefined leaves that side untouched.
 */
export function setProviderModelPrice(
  config: Config,
  id: string,
  model: string,
  price: { price_in?: number | null; price_out?: number | null },
): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const m = p.models.find((x) => x.id === model);
  if (!m) throw new Error(`provider "${id}" does not serve model "${model}"`);
  if (price.price_in === null) delete m.price_in;
  else if (price.price_in !== undefined) {
    if (price.price_in < 0) throw new Error("price_in must be >= 0");
    m.price_in = price.price_in;
  }
  if (price.price_out === null) delete m.price_out;
  else if (price.price_out !== undefined) {
    if (price.price_out < 0) throw new Error("price_out must be >= 0");
    m.price_out = price.price_out;
  }
  return next;
}

/** Add several model ids at once, skipping any the provider already serves. */
export function addProviderModels(config: Config, id: string, ids: string[]): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  const have = new Set(p.models.map((m) => m.id));
  for (const raw of ids) {
    const mid = raw.trim();
    if (mid && !have.has(mid)) {
      p.models.push({ id: mid });
      have.add(mid);
    }
  }
  return next;
}

/** Drop every model from a provider's catalog. */
export function clearProviderModels(config: Config, id: string): Config {
  const next = cloneConfig(config);
  const p = next.providers.find((x) => x.id === id);
  if (!p) throw new Error(`provider "${id}" not found`);
  p.models = [];
  return next;
}

// ---- routing layer: client alias -> prioritized provider chain -------------

// ---- combos: a client alias -> ordered provider chain + strategy -----------

/** Create or replace a combo (alias + target chain + strategy). */
export function setRoute(
  config: Config,
  route: {
    alias: string;
    target: string[];
    model?: string | string[];
    strategy?: ModelRoute["strategy"];
    sticky?: number;
    price_in?: number;
    price_out?: number;
  },
): Config {
  const alias = route.alias.trim();
  if (!alias) throw new Error("alias must not be empty");
  if (!route.target.length) throw new Error("a combo needs at least one target provider");
  const next = cloneConfig(config);
  for (const t of route.target) {
    if (!next.providers.some((p) => p.id === t)) throw new Error(`unknown provider "${t}" in combo`);
  }
  const entry: ModelRoute = {
    alias,
    target: route.target,
    strategy: route.strategy ?? "fallback",
    sticky: route.sticky && route.sticky > 0 ? route.sticky : 1,
    ...(route.model !== undefined ? { model: route.model } : {}),
    ...(route.price_in !== undefined ? { price_in: route.price_in } : {}),
    ...(route.price_out !== undefined ? { price_out: route.price_out } : {}),
  };
  const idx = next.models.findIndex((m) => m.alias === alias);
  if (idx === -1) next.models.push(entry);
  else next.models[idx] = entry;
  return next;
}

export function removeRoute(config: Config, alias: string): Config {
  const next = cloneConfig(config);
  const idx = next.models.findIndex((m) => m.alias === alias);
  if (idx === -1) throw new Error(`combo "${alias}" not found`);
  next.models.splice(idx, 1);
  return next;
}

// ---- endpoint settings: token-saver toggles + gateway keys -----------------

export function setRtk(config: Config, enabled: boolean): Config {
  const next = cloneConfig(config);
  next.endpoint.rtk = enabled;
  return next;
}

export function setCaveman(config: Config, level: EndpointSettings["caveman"]): Config {
  const next = cloneConfig(config);
  next.endpoint.caveman = level;
  return next;
}

export function setPonytail(config: Config, level: EndpointSettings["ponytail"]): Config {
  const next = cloneConfig(config);
  next.endpoint.ponytail = level;
  return next;
}

/** Update the headroom (external context-compression proxy) settings. */
export function setHeadroom(
  config: Config,
  patch: { enabled?: boolean; url?: string; compress_user_messages?: boolean },
): Config {
  const next = cloneConfig(config);
  if (patch.enabled !== undefined) next.endpoint.headroom.enabled = patch.enabled;
  if (patch.url !== undefined) next.endpoint.headroom.url = patch.url.trim() || "http://localhost:8787";
  if (patch.compress_user_messages !== undefined) {
    next.endpoint.headroom.compress_user_messages = patch.compress_user_messages;
  }
  return next;
}

// ---- scoped budgets --------------------------------------------------------

/** Stable identity key for a budget's scope. */
export function budgetKey(scope: BudgetScope): string {
  return scope.type === "global" ? "global" : `${scope.type}:${scope.id}`;
}

/** Add a budget, or replace the existing one with the same scope key. */
export function setBudget(config: Config, budget: Budget, now: number = Date.now()): Config {
  if (budget.scope.type === "provider") {
    const { id } = budget.scope;
    if (!config.providers.some((p) => p.id === id)) {
      throw new Error(`unknown provider "${id}" for budget scope`);
    }
  }
  if (budget.scope.type === "key") {
    const { id } = budget.scope;
    if (!config.server.api_keys.some((k) => clientKeyFingerprint(k) === id)) {
      throw new Error(`unknown API key fingerprint "${id}" for budget scope`);
    }
  }
  const next = cloneConfig(config);
  const key = budgetKey(budget.scope);
  const idx = next.budgets.findIndex((b) => budgetKey(b.scope) === key);
  if (idx === -1) {
    next.budgets.push({ ...budget, anchor: budget.anchor ?? now });
  } else {
    const prev = next.budgets[idx]!;
    // keep the running cycle on edit (preserve prev anchor as-is, including a
    // legacy undefined = epoch grid, so editing a limit never resets spend);
    // start a fresh cycle only when the window length actually changed.
    const anchor = budget.anchor ?? (prev.window === budget.window ? prev.anchor : now);
    next.budgets[idx] = { ...budget, anchor };
  }
  return next;
}

/** Remove a budget by its scope key (global | provider:<id> | model:<id> | key:<fp>). */
export function clearBudget(config: Config, key: string): Config {
  const next = cloneConfig(config);
  const idx = next.budgets.findIndex((b) => budgetKey(b.scope) === key);
  if (idx === -1) throw new Error(`no budget with scope "${key}"`);
  next.budgets.splice(idx, 1);
  return next;
}

/** Append a gateway-level api key clients must present on /v1/*, with a label. */
export function addServerKey(config: Config, key: string, name?: string): Config {
  const trimmed = key.trim();
  if (!trimmed) throw new Error("key must not be empty");
  const next = cloneConfig(config);
  if (next.server.api_keys.includes(trimmed)) throw new Error("key already present");
  next.server.api_keys = [...next.server.api_keys, trimmed];
  const label = name?.trim();
  if (label) next.server.key_names = { ...(next.server.key_names ?? {}), [trimmed]: label };
  return next;
}

/** Rename a gateway key's label (by index, since keys are masked in the API). */
export function editServerKey(config: Config, index: number, patch: { name?: string }): Config {
  const next = cloneConfig(config);
  const keys = next.server.api_keys;
  if (index < 0 || index >= keys.length) throw new Error(`no gateway key at index ${index}`);
  const key = keys[index]!;
  const names = { ...(next.server.key_names ?? {}) };
  const label = patch.name?.trim();
  if (label) names[key] = label;
  else delete names[key];
  next.server.key_names = Object.keys(names).length > 0 ? names : undefined;
  return next;
}

/** Remove a gateway key by index (keys are masked in the API, so by-index). */
export function removeServerKey(config: Config, index: number): Config {
  const next = cloneConfig(config);
  if (index < 0 || index >= next.server.api_keys.length) throw new Error(`no gateway key at index ${index}`);
  const [removed] = next.server.api_keys.splice(index, 1);
  if (removed && next.server.key_names && removed in next.server.key_names) {
    delete next.server.key_names[removed];
  }
  if (removed && next.server.key_models && removed in next.server.key_models) {
    delete next.server.key_models[removed];
    if (Object.keys(next.server.key_models).length === 0) next.server.key_models = undefined;
  }
  if (removed && next.server.key_rpm && removed in next.server.key_rpm) {
    delete next.server.key_rpm[removed];
    if (Object.keys(next.server.key_rpm).length === 0) next.server.key_rpm = undefined;
  }
  if (removed && next.server.key_expires && removed in next.server.key_expires) {
    delete next.server.key_expires[removed];
    if (Object.keys(next.server.key_expires).length === 0) next.server.key_expires = undefined;
  }
  return next;
}

/**
 * Set or clear a gateway key's scopes (by index, since keys are masked in the
 * API). `models`/`rpm` are each applied only when present in the patch; an empty
 * list or null/0 clears that scope. Empty maps are pruned to undefined.
 */
export function setServerKeyScope(
  config: Config,
  index: number,
  patch: { models?: string[] | null; rpm?: number | null; expires?: number | null },
): Config {
  const next = cloneConfig(config);
  const keys = next.server.api_keys;
  if (index < 0 || index >= keys.length) throw new Error(`no gateway key at index ${index}`);
  const key = keys[index]!;

  if (patch.models !== undefined) {
    const models = { ...(next.server.key_models ?? {}) };
    const list = (patch.models ?? []).map((m) => m.trim()).filter(Boolean);
    if (list.length > 0) models[key] = list;
    else delete models[key];
    next.server.key_models = Object.keys(models).length > 0 ? models : undefined;
  }

  if (patch.rpm !== undefined) {
    const rpm = { ...(next.server.key_rpm ?? {}) };
    if (patch.rpm && patch.rpm > 0) rpm[key] = Math.floor(patch.rpm);
    else delete rpm[key];
    next.server.key_rpm = Object.keys(rpm).length > 0 ? rpm : undefined;
  }

  if (patch.expires !== undefined) {
    const exp = { ...(next.server.key_expires ?? {}) };
    if (patch.expires && patch.expires > 0) exp[key] = Math.floor(patch.expires);
    else delete exp[key];
    next.server.key_expires = Object.keys(exp).length > 0 ? exp : undefined;
  }

  return next;
}

/** True when `rawKey` has an expiry set and `now` is strictly past it. */
export function isKeyExpired(server: Config["server"], rawKey: string, now: number): boolean {
  const at = server.key_expires?.[rawKey];
  return at !== undefined && now > at;
}
