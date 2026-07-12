import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "@/gw/appDirs.js";

/**
 * Dashboard session. The cookie carries no secret — just a signed claim
 * `{ v, iat }` where `v` is the admin password's current change-fingerprint
 * (AuthStore.version). A session is valid only if the signature checks out
 * AND `v` still matches the CURRENT password version — so rotating the
 * password invalidates every outstanding session in one place, instead of
 * each route having to independently re-verify a forwarded password.
 *
 * Cookie token = `<base64url(payload)>.<hmac(payload)>`.
 */
const _port = process.env.AIGLOO_PORT ?? process.env.PORT ?? "18080";
const COOKIE = `aigloo_session_${_port}`;

// Defense in depth on top of the cookie's own Max-Age (12h, set by the login/
// password routes) — a raw stolen token replayed directly (bypassing the
// browser's own expiry enforcement) still dies after this long.
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Prefer env; fall back to the persisted file the CLI writes so a standalone
 *  server that lost SESSION_SECRET in its env still validates cookies it sealed
 *  (or can re-seal) against the same key. Empty secret → every session invalid. */
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

/** Issue a signed session token bound to the given password version. */
export function sealSession(version: string): string {
  const payload = Buffer.from(JSON.stringify({ v: version, iat: Date.now() }), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** Verify signature, freshness, and that the token's version matches current. */
export function isSessionValid(token: string | undefined, currentVersion: string): boolean {
  if (!token || !currentVersion || !secret()) return false;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;

  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  let claims: { v?: string; iat?: number };
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (claims.v !== currentVersion) return false;
  if (typeof claims.iat !== "number" || Date.now() - claims.iat > MAX_AGE_MS) return false;
  return true;
}

export const SESSION_COOKIE = COOKIE;
