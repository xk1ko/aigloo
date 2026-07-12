/** Shared response-shaping for Next.js route handlers — was independently
 *  redefined in v1-handler.ts, admin/[...path]/route.ts, api/gw/[...path]/route.ts,
 *  and each v1/*\/route.ts's OPTIONS handler; a header change had to be applied
 *  in 3-4 places by hand and had already drifted. */

export const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

export function corsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": req.headers.get("origin") ?? "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key, anthropic-version",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

// Old Fastify server had bodyLimit: 32MB; nothing replaced it after the 1-port
// migration, so req.json()/req.text() buffered unbounded. Content-Length-based
// check only — a chunked body with no Content-Length still isn't capped
// mid-stream; good enough for a self-hosted personal gateway, not a hardened
// public-internet defense.
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

export function bodyTooLarge(req: Request): boolean {
  const len = req.headers.get("content-length");
  return len !== null && Number(len) > MAX_BODY_BYTES;
}

/** Loose headers: admin-handler may leave optional keys as undefined. */
export type AdminResultLike = {
  status: number;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  stream?: ReadableStream<Uint8Array>;
};

/** Response-shaping for an AdminResult (stream / string body / json body),
 *  shared by admin/[...path]/route.ts (Bearer-password auth) and
 *  api/gw/[...path]/route.ts (session-cookie auth) — the two differ only in
 *  how they authenticate the caller, not in how they turn a result into a
 *  Response. */
export function adminResultToResponse(result: AdminResultLike): Response {
  const extra: Record<string, string> = {};
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      if (v !== undefined) extra[k] = v;
    }
  }
  const headers = { ...SECURITY_HEADERS, ...extra };
  if (result.stream) {
    return new Response(result.stream, { status: result.status, headers });
  }
  if (typeof result.body === "string") {
    return new Response(result.body, { status: result.status, headers });
  }
  return Response.json(result.body ?? {}, { status: result.status, headers });
}
