import { NextResponse } from "next/server";
import { sealSession, sealMemberSession, SESSION_COOKIE } from "@/lib/session";
import { gw } from "@/lib/gw";
import { matchKey, clientKeyFingerprint } from "@/gw/middleware/auth.js";

const DEFAULT_PASSWORD = "123456";

function cookieOpts(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}

/** Whether the admin password is still the seeded default — login page hint. */
export async function GET(): Promise<NextResponse> {
  const g = gw();
  return NextResponse.json({
    isDefault: g.auth.verify(DEFAULT_PASSWORD),
    memberLogin: (g.state.config.raw.server.api_keys?.length ?? 0) > 0,
  });
}

/**
 * POST body: `{ password?: string }` — admin password **or** a gateway access key.
 * Tries admin password first, then gateway keys (constant-time match).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body = (await req.json().catch(() => ({}))) as { password?: string; gatewayKey?: string };
  const secret = (body.password ?? body.gatewayKey ?? "").trim();
  if (!secret) {
    return NextResponse.json({ error: "password or access key required" }, { status: 400 });
  }

  const g = gw();

  // 1) Admin password
  if (g.auth.verify(secret)) {
    const res = NextResponse.json({ ok: true, role: "admin" as const });
    res.cookies.set(SESSION_COOKIE, sealSession(g.auth.version), cookieOpts(req));
    return res;
  }

  // 2) Gateway access key → member session
  const keys = g.state.config.raw.server.api_keys ?? [];
  const matched = matchKey(secret, keys);
  if (matched) {
    const fp = clientKeyFingerprint(matched);
    const res = NextResponse.json({ ok: true, role: "member" as const, fingerprint: fp });
    res.cookies.set(SESSION_COOKIE, sealMemberSession(fp), cookieOpts(req));
    return res;
  }

  return NextResponse.json({ error: "wrong password or access key" }, { status: 401 });
}
