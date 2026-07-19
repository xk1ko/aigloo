/**
 * Upstream provider client. Translates a canonical request into the provider's
 * native format, calls it, and returns either a parsed canonical response
 * (non-stream) or the raw byte stream (stream — consumed in Phase 3).
 */
import { request } from "undici";
import type { Provider } from "../config.js";
import type { CanonicalRequest, CanonicalResponse } from "../core/canonical.js";
import { adapterFor } from "../adapters/index.js";
import { applyThinking, parseSuffix, type ThinkingConfig } from "../translator/thinkingUnified.js";

export interface UpstreamError extends Error {
  status?: number;
  body?: string;
  /** true if trying a different key/provider might succeed */
  retryable?: boolean;
}

/**
 * Retryable = an availability problem another key/provider could clear: rate
 * limits (429), server errors (5xx), network/timeout (no status), or quota/
 * billing errors (another provider could still serve the request).
 * Non-retryable = the request itself is bad (400/401/403/404/422) — falling
 * back just wastes time and spams other providers.
 */
const RETRYABLE_BODY_RE = /quota|exhausted|payment|billing|free.?tier|insufficient|credit|limit.*exceed|eligible|denied|not.?available|not.?supported|not.*access/i;
function classifyRetryable(status: number | undefined, body?: string): boolean {
  if (status === undefined) return true;
  if (status === 429) return true;
  if (status >= 500) return true;
  if (body && RETRYABLE_BODY_RE.test(body)) return true;
  return false;
}

function buildHeaders(provider: Provider, key: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(provider.headers ?? {}),
  };
  if (provider.format === "anthropic") {
    if (key) headers["x-api-key"] = key;
    headers["anthropic-version"] ??= "2023-06-01";
  } else if (provider.format === "gemini") {
    if (key) headers["x-goog-api-key"] = key;
  } else {
    if (key) headers["authorization"] = `Bearer ${key}`;
  }
  return headers;
}

/**
 * OpenAI/Anthropic use a fixed path on base_url; Gemini puts the model and
 * stream mode in the path (:generateContent | :streamGenerateContent?alt=sse).
 */
function buildUrl(provider: Provider, model: string, stream: boolean): string {
  const base = provider.base_url.replace(/\/$/, "");
  if (provider.format === "gemini") {
    const method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
    return `${base}/models/${encodeURIComponent(model)}:${method}`;
  }
  return base + (provider.format === "anthropic" ? "/messages" : "/chat/completions");
}

function buildBody(
  provider: Provider,
  req: CanonicalRequest,
  model: string,
  stream: boolean,
  thinkingIntent?: ThinkingConfig | null,
): unknown {
  const adapter = adapterFor(provider.format);
  // Strip any `model(level)` thinking suffix before the body sees it — upstream
  // providers don't know about aigloo's suffix convention. The original suffixed
  // model is still passed to applyThinking below so the suffix drives intent.
  const { cleanModel } = parseSuffix(model);
  const upstreamReq: CanonicalRequest = { ...req, model: cleanModel, stream };
  const out = adapter.requestFromCanonical(upstreamReq) as Record<string, unknown>;
  // OpenAI-compatible streams omit usage entirely unless you opt in — without this
  // every streamed call through an openai-format provider logs 0 tokens in/out
  // (anthropic/gemini report usage inline, so they're unaffected). Ask for the
  // final usage chunk; the handler taps it for accounting. Preserve a usage opt-in
  // the client already set.
  if (stream && provider.format === "openai") {
    const existing = (out.stream_options ?? {}) as Record<string, unknown>;
    out.stream_options = { ...existing, include_usage: true };
  }
  // Normalize thinking into THIS provider's native format, keyed by the upstream
  // model's capabilities. No-op for non-reasoning models. Runs per-attempt so each
  // provider in a fallback chain gets the right shape. Pass the original (possibly
  // suffixed) model so parseSuffix inside applyThinking can extract the override.
  applyThinking(provider.format, model, out, provider.id, thinkingIntent);
  return out;
}

export interface NonStreamResult {
  stream: false;
  response: CanonicalResponse;
}
export interface StreamResult {
  stream: true;
  body: AsyncIterable<Uint8Array>;
}

export async function callUpstream(
  provider: Provider,
  req: CanonicalRequest,
  model: string,
  opts: { stream: boolean; key?: string; signal?: AbortSignal; thinkingIntent?: ThinkingConfig | null },
): Promise<NonStreamResult | StreamResult> {
  // Gemini puts the model in the URL path; strip the thinking suffix so the
  // upstream URL is clean. buildBody does its own parseSuffix for the body.
  const { cleanModel } = parseSuffix(model);
  const url = buildUrl(provider, cleanModel, opts.stream);
  const headers = buildHeaders(provider, opts.key);
  const body = buildBody(provider, req, model, opts.stream, opts.thinkingIntent);

  let res;
  try {
    res = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
      // providers can be slow to first byte on long generations
      headersTimeout: 600_000,
      bodyTimeout: 600_000,
    });
  } catch (e) {
    const err = new Error(`upstream ${provider.id} request failed: ${(e as Error).message}`) as UpstreamError;
    err.retryable = true;
    throw err;
  }

  if (res.statusCode >= 400) {
    const text = await res.body.text();
    const err = new Error(`upstream ${provider.id} returned ${res.statusCode}`) as UpstreamError;
    err.status = res.statusCode;
    err.body = text;
    err.retryable = classifyRetryable(res.statusCode, text);
    throw err;
  }

  if (opts.stream) return { stream: true, body: res.body };

  const json = await res.body.json();
  const adapter = adapterFor(provider.format);
  return { stream: false, response: adapter.responseToCanonical(json) };
}

export type PingErrorType = "auth" | "rate_limit" | "server_error" | "network" | "unknown";

export interface PingResult {
  reachable: boolean;
  status?: number;
  ok: boolean; // 2xx — endpoint + key both good
  error?: string;
  latencyMs?: number;
  errorType?: PingErrorType;
}

function classifyError(status: number | undefined, msg: string): PingErrorType {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status && status >= 500) return "server_error";
  if (/timeout|econnreset|enotfound|econnrefused|fetch failed/i.test(msg)) return "network";
  return "unknown";
}

const STATUS_ERRORS: Record<number, string> = {
  400: "Bad request — check API parameters",
  401: "Authentication failed — invalid API key",
  403: "Access forbidden — key lacks permission",
  404: "Endpoint not found — check base URL",
  408: "Request timeout",
  422: "Unprocessable request",
  429: "Rate limit exceeded — too many requests",
  500: "Internal server error on provider side",
  502: "Bad gateway — provider upstream is down",
  503: "Service unavailable — provider is overloaded",
  504: "Gateway timeout — provider took too long",
};

function parseErrorBody(status: number, text: string): string {
  const fallback = STATUS_ERRORS[status] ?? `HTTP ${status}`;
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message
      ?? (typeof parsed?.error === "string" ? parsed.error : null)
      ?? parsed?.message
      ?? fallback;
  } catch {
    return text.slice(0, 200).trim() || fallback;
  }
}

/**
 * Real-usability check: a genuine 1-token completion against `model`, through
 * the same callUpstream() path real traffic uses. Unlike the /models-only
 * check below, this actually exercises billing/balance — a provider whose
 * /models endpoint is a free metadata call (no billing check) will otherwise
 * report a zero-balance key as "valid" even though no real request can
 * succeed. Never throws — returns a structured result for the dashboard.
 */
async function pingProviderCompletion(provider: Provider, key: string | undefined, model: string): Promise<PingResult> {
  const t0 = Date.now();
  try {
    await callUpstream(provider, { model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }, model, { stream: false, key });
    return { reachable: true, status: 200, ok: true, latencyMs: Date.now() - t0 };
  } catch (e) {
    const err = e as UpstreamError;
    const latencyMs = Date.now() - t0;
    if (err.status === undefined) {
      return { reachable: false, ok: false, error: err.message, latencyMs, errorType: classifyError(undefined, err.message) };
    }
    const error = err.body ? parseErrorBody(err.status, err.body) : (STATUS_ERRORS[err.status] ?? `HTTP ${err.status}`);
    return { reachable: true, status: err.status, ok: false, error, latencyMs, errorType: classifyError(err.status, error) };
  }
}

/**
 * Connectivity + usability check. With `model`, does a real 1-token
 * completion (see pingProviderCompletion) — the accurate but slightly more
 * expensive check, used whenever the provider already has a model configured
 * to test against. Without one (e.g. validating a brand-new provider before
 * it has any models yet), falls back to a lightweight GET {base}/models —
 * any HTTP status means the host is reachable, 2xx means the key is accepted,
 * but note this does NOT exercise billing on providers whose /models endpoint
 * is a free metadata call. Never throws — returns a structured result for
 * the dashboard.
 */
export async function pingProvider(provider: Provider, key: string | undefined, model?: string): Promise<PingResult> {
  if (model) return pingProviderCompletion(provider, key, model);

  const base = provider.base_url.replace(/\/$/, "");
  const url = `${base}/models`;
  const headers = buildHeaders(provider, key);
  const t0 = Date.now();
  try {
    const res = await request(url, { method: "GET", headers, headersTimeout: 10_000, bodyTimeout: 10_000 });
    const text = await res.body.text();
    const latencyMs = Date.now() - t0;
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const error = ok ? undefined : parseErrorBody(res.statusCode, text);
    return {
      reachable: true,
      status: res.statusCode,
      ok,
      error,
      latencyMs,
      errorType: ok ? undefined : classifyError(res.statusCode, error ?? ""),
    };
  } catch (e) {
    const msg = (e as Error).message;
    return {
      reachable: false,
      ok: false,
      error: msg,
      latencyMs: Date.now() - t0,
      errorType: classifyError(undefined, msg),
    };
  }
}

export { buildHeaders, buildUrl, buildBody };
