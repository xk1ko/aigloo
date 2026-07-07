/**
 * External model-data sync — fetches pricing + capabilities from models.dev
 * (primary) and pricing from LiteLLM (backup), both MIT-licensed community
 * databases. One models.dev fetch yields both pricing and capabilities.
 *
 * Pricing resolution (highest wins):
 *   1. runtimeOverrides (user dashboard/config — never touched by sync)
 *   2. synced models.dev pricing
 *   3. synced LiteLLM pricing
 *   4. PROVIDER_PRICING / MODEL_PRICING / PATTERN_PRICING (hardcoded)
 *
 * Capabilities resolution (synced sits LOWER than hardcoded, because hardcoded
 * carries richer thinkingFormat/search data models.dev lacks):
 *   1. PROVIDER_CAPABILITIES / MODEL_CAPABILITIES / PATTERN_CAPABILITIES
 *   2. synced models.dev capabilities (fills models no hardcoded layer covers)
 *   3. DEFAULT_CAPABILITIES
 */
import type { Pricing } from "./pricing.js";
import { setSyncedPricing } from "./pricing.js";
import type { Caps } from "./capabilities.js";
import { setSyncedCapabilities } from "./capabilities.js";

export type PricingSource = "modelsdev" | "litellm";

const MODELS_DEV_URL = "https://models.dev/api.json";
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

// ─── models.dev types ────────────────────────────────────

interface ModelsDevCost {
  input?: number;
  output?: number;
  reasoning?: number;
  cache_read?: number;
  cache_write?: number;
}
interface ModelsDevLimit {
  context?: number;
  input?: number;
  output?: number;
}
interface ModelsDevModalities {
  input?: string[];
  output?: string[];
}
interface ModelsDevModel {
  id: string;
  cost?: ModelsDevCost;
  reasoning?: boolean;
  tool_call?: boolean;
  attachment?: boolean;
  modalities?: ModelsDevModalities;
  limit?: ModelsDevLimit;
}
interface ModelsDevProvider {
  id: string;
  models: Record<string, ModelsDevModel>;
}
type ModelsDevData = Record<string, ModelsDevProvider>;

// ─── LiteLLM types ──────────────────────────────────────

interface LiteLLMModel {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  litellm_provider?: string;
  mode?: string;
}
type LiteLLMData = Record<string, LiteLLMModel>;

// ─── in-memory cache for models.dev raw fetch ───────────

let cachedModelsDev: ModelsDevData | null = null;
let cachedModelsDevAt = 0;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// ─── sync state ─────────────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null;
let lastSyncAt: number | null = null;
let lastSyncCount = 0;
let lastSyncError: string | null = null;
let activeIntervalMs = DEFAULT_INTERVAL_MS;

export interface SyncStatus {
  enabled: boolean;
  lastSyncAt: number | null;
  lastSyncCount: number;
  lastSyncError: string | null;
  nextSyncAt: number | null;
  intervalMs: number;
  sources: PricingSource[];
}

export interface SyncResult {
  success: boolean;
  source: PricingSource;
  modelCount: number;
  error?: string;
}

// ─── fetch ──────────────────────────────────────────────

async function fetchModelsDevRaw(): Promise<ModelsDevData> {
  if (cachedModelsDev && Date.now() - cachedModelsDevAt < CACHE_TTL_MS) return cachedModelsDev;
  const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`models.dev fetch failed [${res.status}]`);
  const text = await res.text();
  const data = JSON.parse(text) as ModelsDevData;
  cachedModelsDev = data;
  cachedModelsDevAt = Date.now();
  return data;
}

async function fetchLiteLLMRaw(): Promise<LiteLLMData> {
  const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`LiteLLM fetch failed [${res.status}]`);
  const text = await res.text();
  return JSON.parse(text) as LiteLLMData;
}

// ─── transform ──────────────────────────────────────────

/** models.dev costs are already $/1M tokens — carry through verbatim. */
export function transformModelsDev(raw: ModelsDevData): Map<string, Pricing> {
  const out = new Map<string, Pricing>();
  for (const provider of Object.values(raw)) {
    for (const model of Object.values(provider.models ?? {})) {
      if (!model.cost || model.cost.input == null) continue;
      const entry: Pricing = {
        input: model.cost.input,
        output: model.cost.output ?? 0,
      };
      if (model.cost.cache_read != null) entry.cached = model.cost.cache_read;
      if (model.cost.cache_write != null) entry.cache_creation = model.cost.cache_write;
      if (model.cost.reasoning != null) entry.reasoning = model.cost.reasoning;
      const key = model.id.toLowerCase();
      if (!out.has(key)) out.set(key, entry);
    }
  }
  return out;
}

/** models.dev → Partial<Caps>. Only fields models.dev can provide (no thinkingFormat/search). */
export function transformModelsDevToCapabilities(raw: ModelsDevData): Map<string, Partial<Caps>> {
  const out = new Map<string, Partial<Caps>>();
  for (const provider of Object.values(raw)) {
    for (const model of Object.values(provider.models ?? {})) {
      const caps: Partial<Caps> = {};
      const inMods = model.modalities?.input ?? [];
      const outMods = model.modalities?.output ?? [];
      if (inMods.includes("image")) caps.vision = true;
      if (inMods.includes("pdf")) caps.pdf = true;
      if (inMods.includes("audio")) caps.audioInput = true;
      if (inMods.includes("video")) caps.videoInput = true;
      if (outMods.includes("image")) caps.imageOutput = true;
      if (outMods.includes("audio")) caps.audioOutput = true;
      if (model.reasoning === true) caps.reasoning = true;
      if (model.tool_call === true) caps.tools = true;
      if (model.tool_call === false) caps.tools = false;
      if (model.limit?.context != null) caps.contextWindow = model.limit.context;
      if (model.limit?.output != null) caps.maxOutput = model.limit.output;
      if (Object.keys(caps).length === 0) continue;
      const key = model.id.toLowerCase();
      if (!out.has(key)) out.set(key, caps);
    }
  }
  return out;
}

/** LiteLLM costs are per-token — scale ×1e6 to $/1M. Strips provider prefix from key. */
export function transformLiteLLM(raw: LiteLLMData): Map<string, Pricing> {
  const out = new Map<string, Pricing>();
  for (const [modelKey, info] of Object.entries(raw)) {
    if (info.input_cost_per_token == null && info.output_cost_per_token == null) continue;
    const slashIdx = modelKey.indexOf("/");
    const modelName = (slashIdx >= 0 ? modelKey.slice(slashIdx + 1) : modelKey).toLowerCase();
    if (!modelName) continue;
    const entry: Pricing = {
      input: round3((info.input_cost_per_token ?? 0) * 1_000_000),
      output: round3((info.output_cost_per_token ?? 0) * 1_000_000),
    };
    if (info.cache_read_input_token_cost != null)
      entry.cached = round3(info.cache_read_input_token_cost * 1_000_000);
    if (info.cache_creation_input_token_cost != null)
      entry.cache_creation = round3(info.cache_creation_input_token_cost * 1_000_000);
    if (info.output_cost_per_token != null)
      entry.reasoning = round3(info.output_cost_per_token * 1_000_000);
    if (!out.has(modelName)) out.set(modelName, entry);
  }
  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ─── DB interface ───────────────────────────────────────

interface SyncDB {
  saveSyncedPricing(source: string, rows: Array<{ model: string; pricing: Pricing }>): void;
  clearSyncedPricing(source?: string): void;
  listSyncedPricing(source?: string): Array<{ source: string; model: string; input: number; output: number; cached: number | null; cache_creation: number | null; reasoning: number | null; fetched_at: number }>;
  saveSyncedCapabilities(rows: Array<{ model: string; caps: Record<string, unknown> }>): void;
  listSyncedCapabilities(): Array<{ model: string; caps: Record<string, unknown>; fetched_at: number }>;
}

// ─── sync ──────────────────────────────────────────────

export async function syncModelsDev(db: SyncDB): Promise<SyncResult> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await fetchModelsDevRaw();
      const priceMap = transformModelsDev(raw);
      const priceRows = [...priceMap.entries()].map(([model, pricing]) => ({ model, pricing }));
      db.saveSyncedPricing("modelsdev", priceRows);
      setSyncedPricing("modelsdev", priceMap);

      const capsMap = transformModelsDevToCapabilities(raw);
      const capsRows = [...capsMap.entries()].map(([model, caps]) => ({ model, caps: caps as Record<string, unknown> }));
      db.saveSyncedCapabilities(capsRows);
      setSyncedCapabilities(capsMap);

      return { success: true, source: "modelsdev", modelCount: priceMap.size };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) await sleep(2 ** attempt * 1000);
    }
  }
  return { success: false, source: "modelsdev", modelCount: 0, error: lastErr?.message ?? "unknown" };
}

export async function syncLitellm(db: SyncDB): Promise<SyncResult> {
  try {
    const raw = await fetchLiteLLMRaw();
    const map = transformLiteLLM(raw);
    const rows = [...map.entries()].map(([model, pricing]) => ({ model, pricing }));
    db.saveSyncedPricing("litellm", rows);
    setSyncedPricing("litellm", map);
    return { success: true, source: "litellm", modelCount: map.size };
  } catch (err) {
    return { success: false, source: "litellm", modelCount: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function syncAll(db: SyncDB): Promise<{ modelsdev: SyncResult; litellm: SyncResult }> {
  const modelsdev = await syncModelsDev(db);
  const litellm = await syncLitellm(db);
  lastSyncAt = Date.now();
  lastSyncCount = modelsdev.modelCount + litellm.modelCount;
  lastSyncError = modelsdev.success && litellm.success ? null : [modelsdev.error, litellm.error].filter(Boolean).join("; ") || null;
  return { modelsdev, litellm };
}

// ─── boot: load persisted synced pricing into memory ────

export function loadSyncedFromDb(db: SyncDB): void {
  for (const source of ["modelsdev", "litellm"] as const) {
    const rows = db.listSyncedPricing(source);
    const map = new Map<string, Pricing>();
    for (const r of rows) {
      const entry: Pricing = { input: r.input, output: r.output };
      if (r.cached != null) entry.cached = r.cached;
      if (r.cache_creation != null) entry.cache_creation = r.cache_creation;
      if (r.reasoning != null) entry.reasoning = r.reasoning;
      map.set(r.model.toLowerCase(), entry);
    }
    setSyncedPricing(source, map);
  }

  const capsRows = db.listSyncedCapabilities();
  const capsMap = new Map<string, Partial<Caps>>();
  for (const r of capsRows) {
    capsMap.set(r.model.toLowerCase(), r.caps as Partial<Caps>);
  }
  setSyncedCapabilities(capsMap);
}

// ─── periodic sync ─────────────────────────────────────

export function startPeriodicSync(db: SyncDB, log?: (msg: string) => void): void {
  if (syncTimer) return;
  const enabled = process.env.AIGLOO_PRICING_SYNC_ENABLED !== "false";
  if (!enabled) {
    log?.("[pricing-sync] disabled (AIGLOO_PRICING_SYNC_ENABLED=false)");
    return;
  }
  const parsed = parseInt(process.env.AIGLOO_PRICING_SYNC_INTERVAL || "", 10);
  activeIntervalMs = Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : DEFAULT_INTERVAL_MS;
  log?.(`[pricing-sync] starting periodic sync every ${activeIntervalMs / 1000}s`);

  syncAll(db)
    .then((r) => log?.(`[pricing-sync] initial sync: ${r.modelsdev.modelCount} models.dev + ${r.litellm.modelCount} litellm`))
    .catch((e) => log?.(`[pricing-sync] initial sync error: ${e instanceof Error ? e.message : e}`));

  syncTimer = setInterval(() => {
    syncAll(db)
      .then((r) => log?.(`[pricing-sync] periodic sync: ${r.modelsdev.modelCount} + ${r.litellm.modelCount} models`))
      .catch((e) => log?.(`[pricing-sync] periodic sync error: ${e instanceof Error ? e.message : e}`));
  }, activeIntervalMs);

  if (syncTimer && typeof syncTimer === "object" && "unref" in syncTimer) {
    (syncTimer as { unref?: () => void }).unref?.();
  }
}

export function stopPeriodicSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

export function getSyncStatus(): SyncStatus {
  const enabled = process.env.AIGLOO_PRICING_SYNC_ENABLED !== "false";
  return {
    enabled,
    lastSyncAt,
    lastSyncCount,
    lastSyncError,
    nextSyncAt: syncTimer && lastSyncAt ? lastSyncAt + activeIntervalMs : null,
    intervalMs: activeIntervalMs,
    sources: ["modelsdev", "litellm"],
  };
}

export function clearSynced(db: SyncDB, source?: PricingSource): void {
  db.clearSyncedPricing(source);
  if (source) setSyncedPricing(source, new Map());
  else {
    setSyncedPricing("modelsdev", new Map());
    setSyncedPricing("litellm", new Map());
  }
  if (!source || source === "modelsdev") {
    db.saveSyncedCapabilities([]);
    setSyncedCapabilities(new Map());
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
