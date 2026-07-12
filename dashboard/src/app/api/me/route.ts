import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSession, SESSION_COOKIE } from "@/lib/session";
import { gw } from "@/lib/gw";
import { clientKeyFingerprint } from "@/gw/middleware/auth.js";
import { maskKey } from "@/gw/config.js";

export type MemberBudgetInfo = {
  unit: "usd" | "tokens";
  limit: number;
  spent: number;
  remaining: number;
  pct: number;
  window: string;
  exhausted: boolean;
  alert: boolean;
  reset_in_ms: number;
};

export type MemberMeResponse = {
  role: "member";
  fingerprint: string;
  name: string;
  masked: string;
  /** Allowed model ids; null means unrestricted (all models). */
  models: string[] | null;
  rpm: number | null;
  /** Unix ms when the key expires; null = no expiry. */
  expires: number | null;
  expired: boolean;
  /** Key-scoped budget only (not global/provider). null = no key budget. */
  budget: MemberBudgetInfo | null;
};

/** Current dashboard session identity (admin vs member) + member access limits. */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const g = gw();
  const keys: string[] = g.state.config.raw.server.api_keys ?? [];
  const fps = keys.map((k: string) => clientKeyFingerprint(k));
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

  const server = g.state.config.raw.server;
  const raw = keys.find((k: string) => clientKeyFingerprint(k) === session.fingerprint);
  const name = raw
    ? (server.key_names?.[raw] ?? maskKey(raw))
    : session.fingerprint;
  const masked = raw ? maskKey(raw) : session.fingerprint;
  const models = raw ? (server.key_models?.[raw] ?? null) : null;
  const rpm = raw ? (server.key_rpm?.[raw] ?? null) : null;
  const expires = raw ? (server.key_expires?.[raw] ?? null) : null;
  const expired = typeof expires === "number" && Date.now() > expires;

  let budget: MemberBudgetInfo | null = null;
  const fp = session.fingerprint;
  const status = g.state.budget.statuses().find(
    (s: { scope: { type: string; id?: string }; unit: "usd" | "tokens"; limit: number; spent: number; pct: number; window: string; exhausted: boolean; alert: boolean; reset_in_ms: number }) =>
      s.scope.type === "key" && s.scope.id === fp,
  );
  if (status) {
    budget = {
      unit: status.unit,
      limit: status.limit,
      spent: status.spent,
      remaining: Math.max(0, status.limit - status.spent),
      pct: status.pct,
      window: status.window,
      exhausted: status.exhausted,
      alert: status.alert,
      reset_in_ms: status.reset_in_ms,
    };
  }

  const body: MemberMeResponse = {
    role: "member",
    fingerprint: session.fingerprint,
    name,
    masked,
    models,
    rpm,
    expires,
    expired,
    budget,
  };
  return NextResponse.json(body);
}
