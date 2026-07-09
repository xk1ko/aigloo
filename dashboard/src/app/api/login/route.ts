import { NextResponse } from "next/server";
import { cookies } from "next/headers";
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

  const jar = await cookies();
  jar.set(SESSION_COOKIE, sealSession(g.auth.version), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return NextResponse.json({ ok: true });
}
