import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSession, SESSION_COOKIE } from "@/lib/session";
import { gw } from "@/lib/gw";
import { clientKeyFingerprint } from "@/gw/middleware/auth.js";
import { maskKey } from "@/gw/config.js";

/** Current dashboard session identity (admin vs member). */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = gw();
  const keys = g.state.config.raw.server.api_keys ?? [];
  const fps = keys.map(clientKeyFingerprint);
  const session = parseSession(req.cookies.get(SESSION_COOKIE)?.value, {
    currentAdminVersion: g.auth.version,
    validFingerprints: fps,
  });

  if (!session) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (session.role === "admin") {
    return NextResponse.json({ role: "admin" as const });
  }

  const raw = keys.find((k) => clientKeyFingerprint(k) === session.fingerprint);
  const name = raw
    ? (g.state.config.raw.server.key_names?.[raw] ?? maskKey(raw))
    : session.fingerprint;

  return NextResponse.json({
    role: "member" as const,
    fingerprint: session.fingerprint,
    name,
  });
}
