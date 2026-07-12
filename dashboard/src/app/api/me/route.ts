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
  /** Never refills (all-time spend). */
  lifetime: boolean;
};

export type MemberModelGroup = { label: string; items: { value: string; label: string }[] };

export type MemberMeResponse = {
  role: "member";
  fingerprint: string;
  name: string;
  masked: string;
  models: string[] | null;
  rpm: number | null;
  expires: number | null;
  expired: boolean;
  budget: MemberBudgetInfo | null;
  /** Human reasons this key will fail or is limited. */
  blocks: string[];
  /** Origin for tool setup snippets (best-effort from request). */
  base_url: string;
  /** Gateway listen port (for CLI Tools auto base URL). */
  port: number;
  /**
   * Models this key may pick in CLI Tools.
   * Allowlist if set on the key; otherwise combo aliases + enabled provider/model refs.
   */
  catalog: string[];
  catalog_groups: MemberModelGroup[];
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
    (s: {
      scope: { type: string; id?: string };
      unit: "usd" | "tokens";
      limit: number;
      spent: number;
      pct: number;
      window: string;
      exhausted: boolean;
      alert: boolean;
      reset_in_ms: number;
      lifetime?: boolean;
    }) => s.scope.type === "key" && s.scope.id === fp,
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
      lifetime: !!status.lifetime || status.window === "lifetime",
    };
  }

  const blocks: string[] = [];
  if (expired) {
    blocks.push("This access key has expired — API and login will be rejected.");
  }
  if (budget?.exhausted) {
    blocks.push(
      budget.lifetime
        ? "Spend cap is exhausted (lifetime total — does not refill)."
        : budget.reset_in_ms > 0
          ? `Spend cap is exhausted — refills in the next window.`
          : "Spend cap is exhausted.",
    );
  } else if (budget?.alert) {
    blocks.push("Spend cap is nearing its limit — ask your admin if you need more headroom.");
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:18080";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const base_url = `${proto}://${host}`.replace(/\/$/, "");

  // CLI Tools catalog — allowlist only, or full callable set when unrestricted
  let catalog: string[] = [];
  let catalog_groups: MemberModelGroup[] = [];
  if (models && models.length > 0) {
    catalog = [...models];
    catalog_groups = [{ label: "Allowed", items: models.map((m: string) => ({ value: m, label: m })) }];
  } else {
    const cfg = g.state.config.raw;
    const aliases = (cfg.models ?? []).map((m: { alias: string }) => m.alias);
    const live = (cfg.providers ?? []).filter((p: { disabled?: boolean }) => !p.disabled);
    const refs = live.flatMap((p: { id: string; models: { id: string }[] }) =>
      (p.models ?? []).map((m: { id: string }) => `${p.id}/${m.id}`),
    );
    catalog = [...aliases, ...refs];
    catalog_groups = [];
    if (aliases.length) {
      catalog_groups.push({ label: "Combos", items: aliases.map((a: string) => ({ value: a, label: a })) });
    }
    for (const p of live as { id: string; models: { id: string }[] }[]) {
      if (p.models?.length) {
        catalog_groups.push({
          label: p.id,
          items: p.models.map((m: { id: string }) => ({ value: `${p.id}/${m.id}`, label: `${p.id}/${m.id}` })),
        });
      }
    }
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
    blocks,
    base_url,
    port: server.port ?? 18080,
    catalog,
    catalog_groups,
  };
  return NextResponse.json(body);
}
