import { NextResponse } from "next/server";
import { sealSession, SESSION_COOKIE } from "@/lib/session";
import { gw } from "@/lib/gw";

const DEFAULT_PASSWORD = "123456";

/** Whether the admin password is still the seeded default — lets the login
 *  page hint at it for a first run, without ever sending the password itself
 *  to the browser. Already public knowledge (documented as the default in
 *  the README), so this isn't exposing a new secret. */
export async function GET(): Promise<NextResponse> {
  const g = gw();
  return NextResponse.json({ isDefault: g.auth.verify(DEFAULT_PASSWORD) });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password) {
    return NextResponse.json({ error: "password required" }, { status: 400 });
  }
  const g = gw();
  if (!g.auth.verify(password)) {
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }

  // Set cookie on the response object (not cookies() from next/headers).
  // Some Next/browser combos drop jar.set() from route handlers; attaching to
  // NextResponse is the reliable path so the subsequent hard nav to / carries
  // the session and the proxy doesn't bounce back to /login.
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sealSession(g.auth.version), {
    httpOnly: true,
    sameSite: "lax",
    // Only Secure over real HTTPS. Localhost HTTP must stay non-secure or
    // browsers refuse to store the cookie → login appears to do nothing.
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}
