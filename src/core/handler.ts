/**
 * Core request pipeline, independent of which client endpoint was hit.
 *
 *   client body (clientFormat)
 *     -> ingress adapter        -> canonical request
 *     -> config.resolve(model)  -> prioritized provider chain + upstream model
 *     -> fallback engine        -> rotate keys, walk the chain until one serves
 *     -> provider reply         -> canonical -> egress adapter -> client body
 *
 * Streaming (Phase 3): provider SSE -> canonical chunks -> client SSE. Fallback
 * + key rotation (Phase 4) run here. RTK compression + caveman/ponytail
 * injection (Phase 6) transform the request before routing; usage logging
 * (Phase 5) records each served request.
 */
import type { GatewayConfig, ResolvedRoute } from "../config.js";
import type { WireFormat, CanonicalUsage } from "./canonical.js";
import { adapterFor } from "../adapters/index.js";
import type { UpstreamError } from "../upstream/client.js";
import { parseSSE, encodeSSE } from "../stream/sse.js";
import { streamAdapterFor } from "../stream/index.js";

function humanDuration(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

function budgetErrorBody(resetMs: number) {
  const resetAt = new Date(Date.now() + resetMs).toISOString();
  const msg = resetMs > 0
    ? `budget exceeded — resets in ${humanDuration(resetMs)}`
    : "budget exceeded";
  return buildOpenAIError(402, msg, { reset_in_ms: resetMs, reset_at: resetAt });
}

const ERROR_TYPES: Record<number, { type: string; code: string }> = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "forbidden" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" },
};

function buildOpenAIError(status: number, message: string, extra?: Record<string, unknown>) {
  const info = ERROR_TYPES[status] ?? (status >= 500
    ? { type: "server_error", code: "internal_server_error" }
    : { type: "invalid_request_error", code: "" });
  const error: Record<string, unknown> = { message, type: info.type, code: info.code };
  if (extra) Object.assign(error, extra);
  return { error };
}

function extractUpstreamMessage(body?: string): string {
  if (!body) return "";
  try {
    const json = JSON.parse(body);
    if (typeof json === "string") return json;
    return json?.error?.message ?? json?.message ?? json?.error ?? "";
  } catch {
    return body.slice(0, 500);
  }
}
import type { CanonicalChunk } from "../stream/chunk.js";
import type { KeyPool } from "./keypool.js";
import { executeWithFallback } from "./fallback.js";
import { type UsageDB, computeCost } from "../db.js";
import { compressMessages } from "../rtk/index.js";
import { injectInto } from "../inject/index.js";
import { parseSuffix, captureThinking, type ThinkingConfig } from "../translator/thinkingUnified.js";
import { compressWithHeadroom, formatHeadroomLog } from "../headroom/compress.js";
import { getPricingForModel } from "../providers/pricing.js";

export interface HandleResult {
  status: number;
  /** non-streaming JSON reply */
  json?: unknown;
  /** streaming reply: an async iterable of SSE bytes */
  sse?: AsyncIterable<Uint8Array>;
}

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
  ) {
    super(typeof payload === "string" ? payload : JSON.stringify(payload));
  }
}

export interface HandleDeps {
  config: GatewayConfig;
  pool: KeyPool;
  db?: UsageDB;
  budget?: {
    globalStatus(): { exhausted: boolean; reset_in_ms: number } | null;
    blocks(providerId: string, model: string): { exhausted: true; reset_in_ms: number } | null;
    blocksKey(fp: string): { exhausted: true; reset_in_ms: number } | null;
    clearCache(): void;
    checkAlerts(
      send: (p: {
        type: "budget_alert" | "budget_exceeded";
        scope: string;
        label: string;
        message: string;
        spent: number;
        limit: number;
        unit: "usd" | "tokens";
        pct: number;
        note?: string;
      }) => Promise<void>,
      getAlertState: (s: string) => { alerted_at: number; window_start: number } | null,
      setAlertState: (s: string, at: number, ws: number) => void,
    ): Promise<void>;
  };
  notifier?: { send(p: {
    type: "budget_alert" | "budget_exceeded";
    scope: string;
    label: string;
    message: string;
    spent: number;
    limit: number;
    unit: "usd" | "tokens";
    pct: number;
    note?: string;
  }): Promise<void> };
  clientKeyModels?: string[];
  clientKeyFp?: string;
  log?: (msg: string) => void;
  now?: () => number;
}

interface SaverStats {
  rtkBytesIn: number;
  rtkBytesOut: number;
  headroomTokensBefore: number;
  headroomTokensAfter: number;
  cavemanLevel: string;
  ponytailLevel: string;
}

function recordUsage(
  deps: HandleDeps,
  route: ResolvedRoute,
  usage: CanonicalUsage | undefined,
  status: number,
  latencyMs: number,
  stream: boolean,
  savers: SaverStats,
): void {
  const tokensIn = usage?.prompt_tokens ?? 0;
  const tokensOut = usage?.completion_tokens ?? 0;
  const reasoningTokens = usage?.reasoning_tokens ?? 0;
  const cachedTokens = usage?.cached_tokens ?? 0;
  const cacheCreationTokens = usage?.cache_creation_tokens ?? 0;
  if (!deps.db) return;
  const pricing = getPricingForModel(route.provider.id, route.model);
  const priceIn = route.price_in ?? pricing?.input ?? 0;
  const priceOut = route.price_out ?? pricing?.output ?? 0;
  const priceCached = pricing?.cached ?? priceIn;
  const priceCacheCreation = pricing?.cache_creation ?? priceIn;
  const priceReasoning = pricing?.reasoning ?? priceOut;
  deps.db.record({
    alias: route.alias,
    provider: route.provider.id,
    model: route.model,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    reasoning_tokens: reasoningTokens,
    cached_tokens: cachedTokens,
    cache_creation_tokens: cacheCreationTokens,
    cost: computeCost({
      tokensIn, tokensOut, cachedTokens, cacheCreationTokens, reasoningTokens,
      priceIn, priceOut, priceCached, priceCacheCreation, priceReasoning,
    }),
    status,
    latency_ms: latencyMs,
    stream: stream ? 1 : 0,
    client_key: deps.clientKeyFp ?? "",
    rtk_bytes_in: savers.rtkBytesIn,
    rtk_bytes_out: savers.rtkBytesOut,
    headroom_tokens_before: savers.headroomTokensBefore,
    headroom_tokens_after: savers.headroomTokensAfter,
    caveman_level: savers.cavemanLevel,
    ponytail_level: savers.ponytailLevel,
  });
}

function fireAlertCheck(deps: HandleDeps): void {
  if (!deps.budget || !deps.notifier || !deps.db) return;
  deps.budget.clearCache();
  void deps.budget.checkAlerts(
    (p) => deps.notifier!.send(p),
    (s) => deps.db!.getAlertState(s),
    (s, at, ws) => deps.db!.setAlertState(s, at, ws),
  );
}

export async function handle(
  deps: HandleDeps,
  clientFormat: WireFormat,
  body: unknown,
  signal?: AbortSignal,
): Promise<HandleResult> {
  const { config, pool } = deps;
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const ingress = adapterFor(clientFormat);
  const canonical = ingress.requestToCanonical(body);

  if (!canonical.model) {
    throw new GatewayError(400, buildOpenAIError(400, "missing 'model' in request"));
  }

  // Thinking: a model-name suffix like "claude-opus-4-6(high)" or "alias(none)"
  // carries the client's thinking intent. Strip it so routing matches the clean
  // model, and capture the intent (suffix wins, else any reasoning param already
  // in the body). It's applied per-attempt in the served provider's native format
  // (upstream/client.ts), driven by the capabilities table — a no-op for models
  // that can't reason. Matches aigloo's capture-before-translate flow.
  const { cleanModel, override } = parseSuffix(canonical.model);
  canonical.model = cleanModel;

  // per-key allowlist: a key may be restricted to specific call-strings. Empty/
  // absent → unrestricted. Match the literal clean model the client asked for.
  if (deps.clientKeyModels && deps.clientKeyModels.length > 0 && !deps.clientKeyModels.includes(cleanModel)) {
    throw new GatewayError(403, buildOpenAIError(403, "model not allowed for this key"));
  }

  const thinkingIntent: ThinkingConfig | null =
    override ?? captureThinking(canonical as Record<string, unknown>);

  let routes = config.resolve(canonical.model);
  if (routes.length === 0) {
    throw new GatewayError(404, buildOpenAIError(404, `unknown model "${canonical.model}"`));
  }

  // Budget hard-stop. Global overrun fails fast. Provider/model budgets bar the
  // matching routes; if every candidate is barred, there's nothing to serve → 402.
  if (deps.budget) {
    const g = deps.budget.globalStatus();
    if (g?.exhausted) throw new GatewayError(402, budgetErrorBody(g.reset_in_ms));
    if (deps.clientKeyFp) {
      const kb = deps.budget.blocksKey(deps.clientKeyFp);
      if (kb?.exhausted) throw new GatewayError(402, budgetErrorBody(kb.reset_in_ms));
    }
    const eligible = routes.filter((r) => !deps.budget!.blocks(r.provider.id, r.model));
    if (eligible.length === 0) {
      const b = deps.budget.blocks(routes[0]!.provider.id, routes[0]!.model);
      throw new GatewayError(402, budgetErrorBody(b?.reset_in_ms ?? 0));
    }
    routes = eligible;
  }

  // Pipeline order matters: RTK compresses tool_result in the INPUT first, then
  // inject prepends the output-style system prompt. They touch different parts
  // of the request and stack cleanly. Both run before routing so every fallback
  // attempt sends the same transformed request.
  const savers: SaverStats = {
    rtkBytesIn: 0,
    rtkBytesOut: 0,
    headroomTokensBefore: 0,
    headroomTokensAfter: 0,
    cavemanLevel: config.endpoint.caveman,
    ponytailLevel: config.endpoint.ponytail,
  };

  if (config.endpoint.rtk) {
    const stats = compressMessages(canonical.messages);
    if (stats.hits > 0) {
      const pct = Math.round((1 - stats.bytesOut / stats.bytesIn) * 100);
      deps.log?.(
        `[rtk] compressed ${stats.hits} tool output(s): ${stats.bytesIn}B -> ${stats.bytesOut}B (${pct}%) via [${stats.shapes.join(",")}]`,
      );
      savers.rtkBytesIn = stats.bytesIn;
      savers.rtkBytesOut = stats.bytesOut;
    }
  }

  // fail-open: an injection error must never break the request.
  try {
    const injected = injectInto(canonical, {
      caveman: config.endpoint.caveman,
      ponytail: config.endpoint.ponytail,
    });
    if (injected) deps.log?.(`[inject] caveman=${config.endpoint.caveman} ponytail=${config.endpoint.ponytail}`);
  } catch (e) {
    deps.log?.(`[inject] skipped (error): ${(e as Error).message}`);
  }

  // Headroom: pipe the (OpenAI-shaped) messages through the external compression
  // proxy when enabled. Fail-open — on any error the original messages stand and
  // the request proceeds. Runs after RTK/inject so it compresses the final context.
  if (config.endpoint.headroom.enabled) {
    const hr = await compressWithHeadroom(canonical.messages, {
      url: config.endpoint.headroom.url,
      model: canonical.model,
      compressUserMessages: config.endpoint.headroom.compress_user_messages,
    });
    if (hr) {
      canonical.messages = hr.messages;
      const line = formatHeadroomLog(hr);
      if (line) deps.log?.(`[headroom] ${line}`);
      savers.headroomTokensBefore = hr.tokens_before ?? 0;
      savers.headroomTokensAfter = hr.tokens_after ?? 0;
    }
  }

  const wantStream = canonical.stream === true;

  let won;
  try {
    won = await executeWithFallback(routes, pool, canonical, {
      stream: wantStream,
      signal,
      thinkingIntent,
      onAttempt: (a) =>
        deps.log?.(`[fallback] ${a.provider}/${a.model} ${a.status ?? "-"} -> ${a.outcome}${a.detail ? ` (${a.detail})` : ""}`),
    });
  } catch (e) {
    const err = e as UpstreamError;
    const status = (err.status === 401 || err.status === 403) ? 502 : (err.status ?? 502);
    const providerMatch = err.message.match(/^upstream (\S+)/);
    const providerId = providerMatch?.[1] ?? null;
    const upstreamMsg = extractUpstreamMessage(err.body) || `HTTP ${err.status ?? "error"}`;
    const message = providerId ? `[${providerId}] ${upstreamMsg}` : upstreamMsg;
    throw new GatewayError(status, buildOpenAIError(status, message));
  }

  const { route, result } = won;

  if (!result.stream) {
    const clientBody = ingress.responseFromCanonical(result.response);
    recordUsage(deps, route, result.response.usage, 200, now() - startedAt, false, savers);
    fireAlertCheck(deps);
    return { status: 200, json: clientBody };
  }

  // streaming: provider SSE -> canonical chunks -> client SSE bytes. The
  // provider and client formats may differ (e.g. an Anthropic client talking to
  // an OpenAI provider), so both ends translate through the canonical chunk.
  const providerStream = streamAdapterFor(route.provider.format);
  const clientStream = streamAdapterFor(clientFormat);
  const canonicalChunks = providerStream.streamToCanonical(parseSSE(result.body));

  // tap the canonical chunk stream to capture usage from the final chunk(s),
  // which arrive as partial fields across multiple chunks.
  let lastUsage: CanonicalUsage | undefined;
  async function* tap(): AsyncGenerator<CanonicalChunk> {
    for await (const chunk of canonicalChunks) {
      if (chunk.usage) {
        lastUsage = {
          prompt_tokens: chunk.usage.prompt_tokens ?? lastUsage?.prompt_tokens ?? 0,
          completion_tokens: chunk.usage.completion_tokens ?? lastUsage?.completion_tokens ?? 0,
          total_tokens: 0,
          cached_tokens: chunk.usage.cached_tokens ?? lastUsage?.cached_tokens,
        };
      }
      yield chunk;
    }
  }

  const clientEvents = clientStream.streamFromCanonical(tap());

  async function* toBytes(): AsyncGenerator<Uint8Array> {
    try {
      for await (const ev of clientEvents) {
        yield encodeSSE(ev);
      }
    } finally {
      recordUsage(deps, route, lastUsage, 200, now() - startedAt, true, savers);
      fireAlertCheck(deps);
    }
  }

  return { status: 200, sse: toBytes() };
}
