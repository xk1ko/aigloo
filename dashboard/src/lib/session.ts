import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/gw/appDirs.js";

/**
 * Dashboard session cookie.
 *
 * Cookie token = `<base64url(payload)>.<hmac(payload)>`.
 *
 * Roles:
 *   - admin  — `{ role:"admin", v, iat }` where `v` is AuthStore.version
 *              (password rotation invalidates all admin sessions).
 *              Legacy tokens `{ v, iat }` (no role) are treated as admin.
 *   - member — `{ role:"member", fp, iat }` where `fp` is the gateway access-key
 *              fingerprint. Valid while that key still exists in config.
 */
const _port = process.env.AIGLOO_PORT ?? process.env.PORT ?? "18080";
const COOKIE = `aigloo_session_${_port}`;

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type SessionRole = "admin" | "member";

export type AdminSession = { role: "admin"; version: string; iat: number };
export type MemberSession = { role: "member"; fingerprint: string; iat: number };
export type Session = AdminSession | MemberSession;

let fileSecretCache: string | null | undefined;

function secret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv) return fromEnv;
  if (fileSecretCache !== undefined) return fileSecretCache ?? "";
  try {
    const s = readFileSync(join(getDataDir(), "session-secret"), "utf8").trim();
    fileSecretCache = s || null;
  } catch {
    fileSecretCache = null;
  }
  return fileSecretCache ?? "";
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("hex");
}

function sealPayload(obj: object): string {
  const payload = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Issue a signed admin session bound to the password version. */
export function sealSession(version: string): string {
  return sealPayload({ role: "admin", v: version, iat: Date.now() });
}

/** Issue a signed member session bound to a gateway key fingerprint. */
export function sealMemberSession(fingerprint: string): string {
  return sealPayload({ role: "member", fp: fingerprint, iat: Date.now() });
}

function verifySig(token: string): { payload: string; claims: Record<string, unknown> } | null {
  if (!token || !secret()) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof claims.iat !== "number" || Date.now() - claims.iat > MAX_AGE_MS) return null;
    return { payload, claims };
  } catch {
    return null;
  }
}

/**
 * Parse + validate a session token.
 * - admin: `currentAdminVersion` must match claim `v`
 * - member: `validFingerprints` must include claim `fp` (key still exists)
 */
export function parseSession(
  token: string | undefined,
  opts: { currentAdminVersion: string; validFingerprints?: ReadonlySet<string> | string[] },
): Session | null {
  if (!token) return null;
  const verified = verifySig(token);
  if (!verified) return null;
  const { claims } = verified;
  const role = claims.role;

  // Legacy admin cookie: { v, iat } without role
  if (role === undefined || role === "admin") {
    const v = typeof claims.v === "string" ? claims.v : "";
    if (!v || !opts.currentAdminVersion || v !== opts.currentAdminVersion) return null;
    return { role: "admin", version: v, iat: claims.iat as number };
  }

  if (role === "member") {
    const fp = typeof claims.fp === "string" ? claims.fp : "";
    if (!fp) return null;
    const allowed = opts.validFingerprints;
    if (allowed) {
      const set = allowed instanceof Set ? allowed : new Set(allowed);
      if (!set.has(fp)) return null;
    }
    return { role: "member", fingerprint: fp, iat: claims.iat as number };
  }

  return null;
}

/** Back-compat: admin-only validity check (used by older call sites / tests). */
export function isSessionValid(token: string | undefined, currentVersion: string): boolean {
  const s = parseSession(token, { currentAdminVersion: currentVersion });
  return s?.role === "admin";
}

/** Any valid session (admin or member with known fingerprint). */
export function isAnySessionValid(
  token: string | undefined,
  currentAdminVersion: string,
  validFingerprints: ReadonlySet<string> | string[],
): boolean {
  return parseSession(token, { currentAdminVersion, validFingerprints }) !== null;
}

export const SESSION_COOKIE = COOKIE;

/** Paths members may open (pages + APIs). Everything else → redirect/403. */
export function memberPathAllowed(pathname: string): boolean {
  if (pathname === "/usage" || pathname.startsWith("/usage/")) return true;
  if (pathname === "/api/me") return true;
  if (pathname === "/api/logout") return true;
  // usage + savings read-only under the dashboard gw proxy
  if (pathname === "/api/gw/admin/usage") return true;
  if (pathname === "/api/gw/admin/usage/series") return true;
  if (pathname === "/api/gw/admin/savings/summary") return true;
  if (pathname === "/api/gw/admin/keys") return true; // labels only; filtered in route
  return false;
}
