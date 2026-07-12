import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { gw } from "@/lib/gw";
import { handleAdmin } from "@/gw/core/admin-handler.js";
import { parseSession, memberPathAllowed, SESSION_COOKIE } from "@/lib/session";
import { SECURITY_HEADERS, adminResultToResponse, bodyTooLarge } from "@/lib/http";
import { clientKeyFingerprint } from "@/gw/middleware/auth.js";
import { maskKey } from "@/gw/config.js";

type Ctx = { params: Promise<{ path: string[] }> };

const MEMBER_ADMIN_GET = new Set([
  "usage",
  "usage/series",
  "savings/summary",
  "keys",
]);

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse | Response> {
  const sub = path.join("/");
  if (!sub.startsWith("admin/")) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const g = gw();
  const keys = g.state.config.raw.server.api_keys ?? [];
  const fps = keys.map(clientKeyFingerprint);
  const session = parseSession(req.cookies.get(SESSION_COOKIE)?.value, {
    currentAdminVersion: g.auth.version,
    validFingerprints: fps,
  });

  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: SECURITY_HEADERS });
  }

  if (bodyTooLarge(req)) {
    return NextResponse.json({ error: "request body too large" }, { status: 413, headers: SECURITY_HEADERS });
  }

  const segments = sub.split("/").slice(1);
  const adminPath = segments.join("/");
  const url = new URL(req.url);
  const search = new URLSearchParams(url.searchParams);

  // Members: read-only usage scoped to their fingerprint
  if (session.role === "member") {
    const pathname = `/api/gw/admin/${adminPath}`;
    if (req.method !== "GET" || !memberPathAllowed(pathname) || !MEMBER_ADMIN_GET.has(adminPath)) {
      return NextResponse.json(
        { error: "forbidden — access key sessions can only view their own usage" },
        { status: 403, headers: SECURITY_HEADERS },
      );
    }

    if (adminPath === "keys") {
      const raw = keys.find((k) => clientKeyFingerprint(k) === session.fingerprint);
      if (!raw) {
        return NextResponse.json({ error: "key no longer valid" }, { status: 401, headers: SECURITY_HEADERS });
      }
      return NextResponse.json(
        [
          {
            fingerprint: session.fingerprint,
            name: g.state.config.raw.server.key_names?.[raw] ?? maskKey(raw),
            masked: maskKey(raw),
          },
        ],
        { headers: SECURITY_HEADERS },
      );
    }

    // Force scope — never trust client-supplied client_key
    search.set("client_key", session.fingerprint);
  }

  let body: unknown = undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    if (session.role === "member") {
      return NextResponse.json({ error: "forbidden" }, { status: 403, headers: SECURITY_HEADERS });
    }
    body = await req.json().catch(() => undefined);
  }

  const result = await handleAdmin(req.method, segments, search, body, {
    state: g.state,
    db: g.db,
    auth: g.auth,
    notifier: g.notifier,
    log: g.log,
  });

  return adminResultToResponse(result);
}

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
