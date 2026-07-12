"use client";

/**
 * Browser-side admin client. Talks to the gateway THROUGH the same-origin proxy
 * (`/api/gw/admin/...`), which injects the admin Bearer server-side — so the
 * password never reaches the browser. Server components read initial data via
 * lib/gateway.ts directly; client components mutate through here.
 */
import type {
  BudgetStatus,
  ConfigReply,
  EndpointPayload,
  HeadroomStatusReply,
  ImportResult,
  InjectLevel,
  KeyUsageRow,
  ModelsPayload,
  NotificationPayload,
  PingResult,
  BatchTestResponse,
  PricingPayload,
  ProviderSnapshot,
  SavingsSummary,
  WireFormat,
} from "./gateway";
import type { CapsTables } from "./capabilities";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/gw${path}`, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
  const text = await res.text();
  let data: T | null = null;
  try {
    data = text ? (JSON.parse(text) as T) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error ?? `request failed (${res.status})`;
    return { ok: false, status: res.status, data, error: err };
  }
  return { ok: true, status: res.status, data };
}

export const adminApi = {
  providers: () => api<{ providers: ProviderSnapshot[] }>("GET", "/admin/providers"),
  budgets: () => api<{ budgets: BudgetStatus[] }>("GET", "/admin/budgets"),
  models: () => api<ModelsPayload>("GET", "/admin/models"),
  capabilities: () => api<CapsTables>("GET", "/admin/capabilities"),
  keys: () => api<Array<{ fingerprint: string; name: string; masked: string }>>("GET", "/admin/keys"),
  keysUsage: (since = 0) =>
    api<{ keys: KeyUsageRow[]; since: number }>("GET", `/admin/keys/usage?since=${since}`),
  savingsSummary: (since = 0) => api<SavingsSummary>("GET", `/admin/savings/summary?since=${since}`),

  setBudget: (body: {
    scope: { type: "global" } | { type: "provider"; id: string } | { type: "model"; id: string } | { type: "key"; id: string };
    unit: "usd" | "tokens";
    limit: number;
    window: string;
    alert_at?: number;
    note?: string;
  }) => api<ConfigReply>("PUT", "/admin/budgets", body),
  clearBudget: (key: string) => api<ConfigReply>("DELETE", `/admin/budgets/${encodeURIComponent(key)}`),

  notifications: () => api<NotificationPayload>("GET", "/admin/notifications"),
  setNotification: (id: string, cfg: { enabled?: boolean; url?: string; token?: string; chat_id?: string; events?: string[] }) =>
    api<{ ok: boolean }>("PUT", `/admin/notifications/${encodeURIComponent(id)}`, cfg),
  testNotification: (id: string) =>
    api<{ ok: boolean; error?: string }>("POST", `/admin/notifications/${encodeURIComponent(id)}/test`),

  addProvider: (p: {
    id: string;
    name?: string;
    format: WireFormat;
    base_url: string;
    api_key?: string;
    free?: boolean;
    auto_models?: boolean;
    service_account?: string;
  }) => api<ConfigReply>("POST", "/admin/providers", p),
  editProvider: (id: string, patch: { base_url?: string; format?: WireFormat; name?: string }) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}`, patch),
  renameProvider: (id: string, newId: string) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/rename`, { id: newId }),
  removeProvider: (id: string) => api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}`),
  addKey: (id: string, key: string, name?: string) =>
    api<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/keys`, { key, name }),
  editKey: (id: string, index: number, patch: { key?: string; name?: string }) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/keys/${index}`, patch),
  removeKey: (id: string, index: number) =>
    api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/keys/${index}`),
  revealKey: (id: string, index: number) =>
    api<{ key: string }>("GET", `/admin/providers/${encodeURIComponent(id)}/keys/${index}/reveal`),
  addModel: (id: string, model: string, price?: { price_in?: number; price_out?: number }) =>
    api<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { model, ...price }),
  addModels: (id: string, models: string[]) =>
    api<ConfigReply>("POST", `/admin/providers/${encodeURIComponent(id)}/models`, { models }),
  // model id can hold a slash (provider/model); send it as a query param so the
  // proxy's path split doesn't mangle it.
  removeModel: (id: string, model: string) =>
    api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models?model=${encodeURIComponent(model)}`),
  clearModels: (id: string) => api<ConfigReply>("DELETE", `/admin/providers/${encodeURIComponent(id)}/models`),
  pricing: () => api<PricingPayload>("GET", "/admin/pricing"),
  setModelPrice: (id: string, model: string, price: { price_in?: number | null; price_out?: number | null }) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/models/price`, { model, ...price }),
  setRuntimePrice: (model: string, price: { input?: number | null; output?: number | null; cached?: number | null; cache_creation?: number | null; reasoning?: number | null }) =>
    api<{ ok: boolean }>("PUT", `/admin/pricing/${encodeURIComponent(model)}`, price),
  deleteRuntimePrice: (model: string) =>
    api<{ ok: boolean }>("DELETE", `/admin/pricing/${encodeURIComponent(model)}`),
  testProvider: (id: string) => api<PingResult>("POST", `/admin/providers/${encodeURIComponent(id)}/test`),
  testAllProviders: () => api<BatchTestResponse>("POST", "/admin/providers/test-all"),
  testKey: (id: string, index: number) =>
    api<PingResult>("POST", `/admin/providers/${encodeURIComponent(id)}/keys/${index}/test`),
  checkKey: (id: string, key: string) =>
    api<PingResult>("POST", `/admin/providers/${encodeURIComponent(id)}/keys/check`, { key }),
  testModel: (id: string, model: string) =>
    api<{ ok: boolean; status?: number; error?: string }>(
      "POST",
      `/admin/providers/${encodeURIComponent(id)}/models/test?model=${encodeURIComponent(model)}`,
    ),
  validateProvider: (b: { format: WireFormat; base_url: string; api_key?: string }) =>
    api<PingResult>("POST", "/admin/providers/validate", b),
  // discover: returns the upstream catalog flagged with which ids are in config.
  discoverModels: (id: string) =>
    api<{ ok: boolean; models: Array<{ id: string; added: boolean }> }>(
      "POST",
      `/admin/providers/${encodeURIComponent(id)}/connect`,
    ),
  exportProviders: () => "/api/gw/admin/providers/export",
  importProviders: (providers: unknown[]) =>
    api<{ ok: boolean; result: ImportResult }>("POST", "/admin/providers/import", { providers }),

  reorderProvider: (from: number, to: number) =>
    api<ConfigReply>("PUT", "/admin/providers/reorder", { from, to }),
  reorderKey: (id: string, from: number, to: number) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/keys/reorder`, { from, to }),
  toggleKey: (id: string, index: number, enabled: boolean) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/keys/${index}/toggle`, { enabled }),
  setProviderStrategy: (id: string, strategy: "fallback" | "round-robin" | null, sticky?: number) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/strategy`, { strategy, sticky }),
  setProviderDisabled: (id: string, disabled: boolean) =>
    api<ConfigReply>("PUT", `/admin/providers/${encodeURIComponent(id)}/disabled`, { disabled }),

  setRoute: (
    alias: string,
    body: { target: string[]; model?: string | string[]; strategy?: "fallback" | "round-robin"; sticky?: number; price_in?: number; price_out?: number },
  ) => api<ConfigReply>("PUT", `/admin/routes/${encodeURIComponent(alias)}`, body),
  removeRoute: (alias: string) => api<ConfigReply>("DELETE", `/admin/routes/${encodeURIComponent(alias)}`),

  endpoint: () => api<EndpointPayload>("GET", "/admin/endpoint"),
  setRtk: (enabled: boolean) => api<ConfigReply>("PUT", "/admin/endpoint/rtk", { enabled }),
  setCaveman: (level: InjectLevel) => api<ConfigReply>("PUT", "/admin/endpoint/caveman", { level }),
  setPonytail: (level: InjectLevel) => api<ConfigReply>("PUT", "/admin/endpoint/ponytail", { level }),
  addServerKey: (key: string, name?: string) => api<ConfigReply>("POST", "/admin/endpoint/keys", { key, name }),
  editServerKey: (index: number, name: string) => api<ConfigReply>("PUT", `/admin/endpoint/keys/${index}`, { name }),
  setServerKeyScope: (index: number, body: { models?: string[]; rpm?: number | null; expires?: number | null }) =>
    api<ConfigReply>("PUT", `/admin/endpoint/keys/${index}/scope`, body),
  removeServerKey: (index: number) => api<ConfigReply>("DELETE", `/admin/endpoint/keys/${index}`),
  revealServerKey: (index: number) => api<{ key: string }>("GET", `/admin/endpoint/keys/${index}/reveal`),

  setHeadroom: (patch: { enabled?: boolean; url?: string; compress_user_messages?: boolean }) =>
    api<ConfigReply>("PUT", "/admin/endpoint/headroom", patch),
  headroomStatus: () => api<HeadroomStatusReply>("GET", "/admin/headroom/status"),
  headroomStart: () => api<{ success?: boolean; pid?: number; alreadyRunning?: boolean }>("POST", "/admin/headroom/start"),
  headroomStop: () => api<{ stopped: boolean; reason?: string; pid?: number }>("POST", "/admin/headroom/stop"),

  putConfig: (text: string) => api<{ ok: boolean }>("PUT", "/admin/config", { text }),

  version: () => api<{ current: string; latest: string | null; updateAvailable: boolean }>("GET", "/admin/version"),
  shutdown: () => api<{ ok: boolean; message: string }>("POST", "/admin/shutdown"),
};

// Local CLI-tool detection/auto-config. These hit the dashboard's OWN server
// routes (/api/cli-detect/*), not the gateway proxy — they read/write the tool's
// config file on this machine. Session-gated by middleware like everything else.
export interface CliStatus {
  auto: boolean;
  installed: boolean;
  configured?: boolean;
  path?: string;
  baseUrl?: string | null;
  models?: string[];
  activeModel?: string | null;
  // claude returns its three slot defaults instead of a flat list
  modelSlots?: { opus?: string | null; sonnet?: string | null; haiku?: string | null };
}

async function appApi<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return { ok: false, status: 0, data: null, error: (e as Error).message };
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T) : null;
  if (!res.ok) {
    const err = (data as { error?: string } | null)?.error ?? `request failed (${res.status})`;
    return { ok: false, status: res.status, data, error: err };
  }
  return { ok: true, status: res.status, data };
}

/** Admin account actions that hit the dashboard's OWN routes (not the gw proxy). */
export const account = {
  changePassword: (current: string, next: string) =>
    appApi<{ ok: boolean }>("POST", "/api/password", { current, next }),
};

export const cliConfig = {
  status: (tool: string) => appApi<CliStatus>("GET", `/api/cli-detect/${encodeURIComponent(tool)}`),
  apply: (tool: string, body: { base: string; key?: string; models?: string[] | Record<string, string>; active?: string; modalities?: Record<string, { input: string[]; output: string[] }> }) =>
    appApi<{ success?: boolean; path?: string }>("POST", `/api/cli-detect/${encodeURIComponent(tool)}`, body),
  reset: (tool: string) => appApi<{ success?: boolean }>("DELETE", `/api/cli-detect/${encodeURIComponent(tool)}`),
};
