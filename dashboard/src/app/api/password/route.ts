import { NextResponse } from "next/server";
import { sealSession, SESSION_COOKIE } from "@/lib/session";
import { gateway } from "@/lib/gateway";
import { gw } from "@/lib/gw";

/**
 * Change the admin password. The gateway verifies the current password and
 * persists the new hash (which also rotates AuthStore.version); on success we
 * re-issue this browser's session cookie bound to the new version so it stays
 * logged in — every other outstanding session's cookie now carries a stale
 * version and gets rejected on its next request, no separate revocation step.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const { current, next } = (await req.json().catch(() => ({}))) as { current?: string; next?: string };
  if (!current || !next) {
    return NextResponse.json({ error: "current and next are required" }, { status: 400 });
  }
  if (next.length < 4) {
    return NextResponse.json({ error: "new password must be at least 4 characters" }, { status: 400 });
  }

  const r = await gateway.changePassword(current, next);
  if (!r.ok) {
    return NextResponse.json({ error: r.error ?? "could not change password" }, { status: r.status || 400 });
  }

  // Same cookie policy as /api/login — never force Secure on plain HTTP
  // localhost (NODE_ENV=production in the standalone build would break it).
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sealSession(gw().auth.version), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
