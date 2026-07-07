import "server-only";
import { handleAdmin, type AdminDeps } from "@/gw/core/admin-handler.js";
import { gw } from "./gw";
import type { CapsTables } from "./capabilities";

export interface GatewayResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

function deps(): AdminDeps {
  const g = gw();
  return { state: g.state, db: g.db, auth: g.auth, notifier: g.notifier, log: g.log };
}

function parsePath(path: string): { segments: string[]; search: URLSearchParams } {
  const [pathOnly, queryString] = path.split("?");
  const segments = pathOnly.replace(/^\/admin\//, "").split("/").filter(Boolean);
  return { segments, search: new URLSearchParams(queryString) };
}

async function call<T>(method: string, path: string, body?: unknown): Promise<GatewayResult<T>> {
  const { segments, search } = parsePath(path);
  const result = await handleAdmin(method, segments, search, body, deps());
  const data = result.body as T;
  if (result.status >= 400) {
    const err = (result.body as { error?: string } | null)?.error ?? `request failed (${result.status})`;
    return { ok: false, status: result.status, data, error: err };
  }
  return { ok: true, status: result.status, data };
}

export const gateway = {
  providers: () => call<{ providers: ProviderSnapshot[] }>("GET", "/admin/providers"),
  budgets: () => call<{ budgets: BudgetStatus[] }>("GET", "/admin/budgets"),
  models: () => call<ModelsPayload>("GET", "/admin/models"),
  capabilities: () => call<CapsTables>("GET", "/admin/capabilities"),
  logs: (limit = 100) => call<{ logs: UsageLog[] }>("GET", `/admin/logs?limit=${limit}`),
  usage: (since = 0) => call<UsageSummary>("GET", `/admin/usage?since=${since}`),
  usageSeries: (since: number, bucket: number) =>
    call<{ series: UsageSeriesPoint[] }>("GET", `/admin/usage/series?since=${since}&bucket=${bucket}`),
  savingsSummary: (since = 0) => call<SavingsSummary>("GET", `/admin/savings/summary?since=${since}`),
  config: () => call<MaskedConfig>("GET", "/admin/config"),
  putConfig: (text: string) => call<{ ok: boolean; config: MaskedConfig }>("PUT", "/admin/config", { text }),
  changePassword: (current: string, next: string) =>
    call<{ ok: boolean }>("PUT", "/admin/password", { current, next }),

  // ---- provider mutations (reply carries the fresh masked config) ----
  addProvider: (p: {
    id: string;
    name?: string;
    format: WireFormat;
    base_url: string;
    api_key?: string;
    free?: boolean;
    auto_models?: boolean;
    service_account?: string;
  }) => call<ConfigReply>("POST", "/admin/providers", p),
  editProvider: (id: string, patch: { base_url?: string; format?: WireFormat; name?: string }) =>
    call<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}`, patch),
  removeProvider: (id: string) => call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}`),
  addKey: (id: string, key: string) =>
    call<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/keys`, { key }),
  removeKey: (id: string, index: number) =>
    call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/keys/${index}`),
  addProviderModel: (id: string, model: string, price?: { price_in?: number; price_out?: number }) =>
    call<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { model, ...price }),
  addProviderModels: (id: string, models: string[]) =>
    call<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { models }),
  removeProviderModel: (id: string, model: string) =>
    call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models/${encodeURIComponent(model)}`),
  clearProviderModels: (id: string) =>
    call<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models`),
  testProvider: (id: string) => call<PingResult>("POST", `/admin/providers/${encodeURIComponent(id)}/test`),
  discoverModels: (id: string) =>
    call<{ ok: boolean; models: Array<{ id: string; added: boolean }> }>(
      "POST",
      `/admin/providers/${encodeURIComponent(id)}/connect`,
    ),

  // ---- combos: alias + ordered provider chain + strategy ----
  setRoute: (
    alias: string,
    body: { target: string[]; model?: string | string[]; strategy?: "fallback" | "round-robin"; sticky?: number; price_in?: number; price_out?: number },
  ) => call<ConfigReply>("PUT", `/admin/routes/${encodeURIComponent(alias)}`, body),
  removeRoute: (alias: string) => call<ConfigReply>("DELETE", `/admin/routes/${encodeURIComponent(alias)}`),

  // ---- endpoint: toggles + gateway keys ----
  endpoint: () => call<EndpointPayload>("GET", "/admin/endpoint"),
  setRtk: (enabled: boolean) => call<ConfigReply>("PUT", "/admin/endpoint/rtk", { enabled }),
  setCaveman: (level: InjectLevel) => call<ConfigReply>("PUT", "/admin/endpoint/caveman", { level }),
  setPonytail: (level: InjectLevel) => call<ConfigReply>("PUT", "/admin/endpoint/ponytail", { level }),
  addServerKey: (key: string) => call<ConfigReply>("POST", "/admin/endpoint/keys", { key }),
  removeServerKey: (index: number) => call<ConfigReply>("DELETE", `/admin/endpoint/keys/${index}`),

  notifications: () => call<NotificationPayload>("GET", "/admin/notifications"),
  setNotification: (id: string, cfg: { enabled?: boolean; url?: string; token?: string; chat_id?: string; events?: string[] }) =>
    call<{ ok: boolean }>("PUT", `/admin/notifications/${encodeURIComponent(id)}`, cfg),
  testNotification: (id: string) => call<{ ok: boolean; error?: string }>("POST", `/admin/notifications/${encodeURIComponent(id)}/test`),
};

// ---- shapes mirrored from the gateway admin API ----

export type WireFormat = "openai" | "anthropic" | "gemini";
export type InjectLevel = "off" | "lite" | "full" | "ultra";

export interface ConfigReply {
  ok: boolean;
  config: MaskedConfig;
}

export interface ImportResult {
  added: string[];
  merged: { id: string; newKeys: number }[];
  skipped: { id: string; reason: string }[];
}

export interface MaskedRoute {
  alias: string;
  target: string[];
  model?: string | string[];
  strategy: "fallback" | "round-robin";
  sticky?: number;
  price_in?: number;
  price_out?: number;
}
export interface MaskedProvider {
  id: string;
  name?: string;
  format: WireFormat;
  base_url: string;
  api_key?: string;
  api_keys?: string[];
  /** optional friendly label per key, keyed by the MASKED key string. */
  key_names?: Record<string, string>;
  free: boolean;
  auto_models: boolean;
  service_account?: string;
  models: Array<{ id: string; price_in?: number; price_out?: number }>;
  cooldown_base_ms: number;
  max_retries: number;
  disabled_keys?: number[];
  disabled?: boolean;
  strategy?: "fallback" | "round-robin";
  sticky?: number;
}
export interface MaskedConfig {
  server: { host: string; port: number; api_keys: string[] };
  endpoint: { rtk: boolean; caveman: InjectLevel; ponytail: InjectLevel };
  providers: MaskedProvider[];
  models: MaskedRoute[];
}

export interface EndpointPayload {
  port: number;
  rtk: boolean;
  caveman: InjectLevel;
  ponytail: InjectLevel;
  headroom: { enabled: boolean; url: string; compress_user_messages: boolean };
  keys: Array<{ key: string; fingerprint: string; name?: string; models?: string[]; rpm?: number; expires?: number }>;
}

export interface KeyUsageRow {
  fingerprint: string;
  name: string;
  masked: string;
  expires?: number;
  spent: number;
  tokens: number;
  budget: {
    unit: "usd" | "tokens";
    limit: number;
    spent: number;
    pct: number;
    window: string;
    reset_in_ms: number;
    exhausted: boolean;
    alert: boolean;
  } | null;
}

export interface HeadroomStatusReply {
  installed: boolean;
  path: string | null;
  running: boolean;
  python: string | null;
  localUrl: boolean;
  canStart: boolean;
  url: string;
  managedPid: number | null;
  enabled: boolean;
  compress_user_messages: boolean;
}

export type PingErrorType = "auth" | "rate_limit" | "server_error" | "network" | "unknown";

export interface PingResult {
  reachable: boolean;
  status?: number;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  errorType?: PingErrorType;
}

export interface BatchTestResult {
  id: string;
  name: string;
  reachable: boolean;
  status?: number;
  ok: boolean;
  error?: string;
  latencyMs?: number;
  errorType?: PingErrorType;
}

export interface BatchTestResponse {
  results: BatchTestResult[];
  summary: { total: number; passed: number; failed: number };
}

export interface PricingModel {
  id: string;
  price_in: number | null;
  price_out: number | null;
  default_in: number | null;
  default_out: number | null;
  override: { input?: number; output?: number; cached?: number; cache_creation?: number; reasoning?: number } | null;
}
export interface PricingPayload {
  providers: Array<{ id: string; models: PricingModel[] }>;
  overrides: Record<string, { input?: number; output?: number; cached?: number; cache_creation?: number; reasoning?: number }>;
}

export interface ModelsPayload {
  providers: Array<{
    id: string;
    format: WireFormat;
    models: Array<{ id: string; ref: string; price_in?: number; price_out?: number }>;
  }>;
  routes: MaskedRoute[];
}

export interface KeySnapshot {
  key: string;
  healthy: boolean;
  cooldown_ms: number;
  fail_count: number;
  last_error: { message: string; status?: number; at: number } | null;
}
export interface ProviderSnapshot {
  id: string;
  format: WireFormat;
  keys: KeySnapshot[];
}
export type BudgetScope =
  | { type: "global" }
  | { type: "provider"; id: string }
  | { type: "model"; id: string }
  | { type: "key"; id: string };

export interface BudgetStatus {
  scope: BudgetScope;
  key: string;
  label: string;
  note?: string;
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  pct: number;
  alert: boolean;
  alert_at: number;
  exhausted: boolean;
  est_converse: number | null;
  reset_in_ms: number;
  window: "5h" | "24h" | "7day" | "30day";
}
export interface UsageLog {
  ts: number;
  alias: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cost: number;
  status: number;
  latency_ms: number;
  stream: number;
  client_key: string;
}
export interface UsageSummary {
  total: { requests: number; tokens_in: number; tokens_out: number; cost: number; cost_out: number };
  by_provider: Array<{ provider: string; requests: number; tokens_in: number; tokens_out: number; cost: number; cost_out: number }>;
  by_model: Array<{ alias: string; model: string; requests: number; tokens_in: number; tokens_out: number; cost: number; cost_out: number }>;
}
export interface UsageSeriesPoint {
  ts: number;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}
export interface SavingsSummary {
  rtk: { bytes_in: number; bytes_out: number; hits: number; cost_saved: number };
  headroom: { tokens_before: number; tokens_after: number; hits: number; cost_saved: number };
  by_caveman_level: Array<{ level: string; requests: number; avg_tokens_out: number }>;
  by_ponytail_level: Array<{ level: string; requests: number; avg_tokens_out: number }>;
}

export interface NotificationConfig {
  id: string;
  enabled: boolean;
  url: string;
  token: string;
  chat_id: string;
  events: string[];
  updated_at: number;
}
export interface AlertLogEntry {
  id: number;
  ts: number;
  type: string;
  scope: string;
  channel: string;
  message: string;
  delivered: boolean;
  error: string;
}
export interface NotificationPayload {
  configs: NotificationConfig[];
  alerts: AlertLogEntry[];
}
