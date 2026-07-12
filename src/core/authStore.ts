/**
 * Admin password store — the single source of truth for the admin password,
 * persisted as a scrypt hash (no plaintext, no native deps). Seeded once from
 * AIGLOO_ADMIN_PASSWORD (default 123456 via the launcher); after that it is
 * changed at runtime from the dashboard and the env var is only a fallback seed.
 *
 * File: <dataDir>/auth.json — { algo, salt, hash } (all hex). Absent → seeded.
 */
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

interface AuthRecord {
  algo: "scrypt";
  salt: string;
  hash: string;
  /** Regenerated on every seed/change — session cookies embed this, so rotating
   *  the password invalidates every outstanding session in one place (see
   *  dashboard/src/lib/session.ts). Not a secret, just a change fingerprint. */
  version: string;
}

function hashPassword(password: string, salt: Buffer): Buffer {
  // 64-byte derived key; scrypt's default cost is fine for a local admin gate.
  return scryptSync(password, salt, 64);
}

function makeRecord(password: string): AuthRecord {
  const salt = randomBytes(16);
  return {
    algo: "scrypt",
    salt: salt.toString("hex"),
    hash: hashPassword(password, salt).toString("hex"),
    version: randomBytes(8).toString("hex"),
  };
}

export class AuthStore {
  private record: AuthRecord | null = null;

  constructor(private file: string) {}

  /** Load the stored hash, seeding it from `seed` (the env password) on first run. */
  static open(dataDir: string, seed: string | undefined): AuthStore {
    const store = new AuthStore(join(dataDir, "auth.json"));
    if (existsSync(store.file)) {
      try {
        store.record = JSON.parse(readFileSync(store.file, "utf8")) as AuthRecord;
      } catch {
        store.record = null;
      }
    }
    // seed from the env password when there's nothing stored yet.
    if (!store.record && seed) store.persist(makeRecord(seed));
    // upgrade path: a record written before `version` existed — stamp one in
    // now so session binding has something to compare against, and so every
    // outstanding pre-upgrade session cookie is invalidated once (expected: a
    // one-time re-login after upgrading, same as a password rotation).
    else if (store.record && !store.record.version) {
      store.persist({ ...store.record, version: randomBytes(8).toString("hex") });
    }
    return store;
  }

  /** Cheap read of the current password version without booting a full
   *  AuthStore/gateway instance — safe to call from proxy on every request.
   *  Cached by mtime+size so the hot path (every nav/prefetch) skips the
   *  readFileSync+JSON.parse unless auth.json actually changed on disk.
   *  Size is included because Windows can keep the same mtimeMs across
   *  rapid rewrites (ms precision).
   *  Returns "" if no auth.json exists yet (admin disabled). */
  static currentVersion(dataDir: string): string {
    const file = join(dataDir, "auth.json");
    try {
      const st = statSync(file);
      const cached = AuthStore.versionCache.get(file);
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        return cached.version;
      }
      const rec = JSON.parse(readFileSync(file, "utf8")) as AuthRecord;
      const version = rec.version ?? "";
      AuthStore.versionCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, version });
      return version;
    } catch {
      return "";
    }
  }
  private static versionCache = new Map<string, { mtimeMs: number; size: number; version: string }>();

  /** In-memory store seeded from a password — for tests (file under tmpdir). */
  static memory(seed: string): AuthStore {
    const store = new AuthStore(join(tmpdir(), `aigloo-auth-${randomBytes(4).toString("hex")}.json`));
    store.record = makeRecord(seed);
    return store;
  }

  /** True once a password is set (stored or seeded). */
  get enabled(): boolean {
    return this.record !== null;
  }

  /** Current password's change-fingerprint — see AuthRecord.version. */
  get version(): string {
    return this.record?.version ?? "";
  }

  private persist(rec: AuthRecord): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(rec));
    this.record = rec;
    // Keep currentVersion()'s cache coherent after our own write (mtime can
    // stay equal on Windows for same-ms rewrites).
    try {
      const st = statSync(this.file);
      AuthStore.versionCache.set(this.file, {
        mtimeMs: st.mtimeMs,
        size: st.size,
        version: rec.version,
      });
    } catch {
      AuthStore.versionCache.delete(this.file);
    }
  }

  /** Constant-time check of a presented password against the stored hash. */
  verify(password: string): boolean {
    if (!this.record) return false;
    const salt = Buffer.from(this.record.salt, "hex");
    const expected = Buffer.from(this.record.hash, "hex");
    const got = hashPassword(password, salt);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  /** Change the password after verifying the current one. */
  change(current: string, next: string): { ok: boolean; error?: string } {
    if (!this.verify(current)) return { ok: false, error: "current password is incorrect" };
    if (typeof next !== "string" || next.length < 4) {
      return { ok: false, error: "new password must be at least 4 characters" };
    }
    this.persist(makeRecord(next));
    return { ok: true };
  }
}
