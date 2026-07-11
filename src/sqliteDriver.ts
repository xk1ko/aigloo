import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface StatementSyncLike {
  get(...args: unknown[]): unknown;
  all(...args: unknown[]): unknown[];
  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint };
}

export interface DatabaseSyncLike {
  exec(sql: string): void;
  prepare(sql: string): StatementSyncLike;
  close(): void;
}

export type SqliteDriverName = "better-sqlite3" | "node:sqlite" | "sql.js";

export interface OpenSqliteResult {
  db: DatabaseSyncLike;
  driver: SqliteDriverName;
}

interface OpenSqliteOptions {
  /** Test-only: force a specific driver instead of probing in order. */
  forceDriver?: SqliteDriverName;
  /** Test-only: inject a fake require instead of node:module's real one. */
  requireFn?: (id: string) => unknown;
  /** Test-only: inject a pre-initialized sql.js WASM module. */
  sqlJsModule?: unknown;
}

// ── require helper ───────────────────────────────────────────────
// process.argv[1] = absolute path to standalone server.js at runtime.
// Prefer that over import.meta.url: webpack hardcodes import.meta.url to the
// *build machine* path (often Linux), which createRequire rejects on Windows
// (ERR_INVALID_ARG_VALUE — no drive letter). Traced deps live in sibling
// node_modules/ (or legacy vendor/); cli.ts puts that dir on NODE_PATH so
// require('sql.js') / better-sqlite3 resolve on all platforms.
let _req: ((id: string) => unknown) | null = null;

export function getRequire(): (id: string) => unknown {
  if (_req) return _req;
  try {
    _req = createRequire(process.argv[1] || import.meta.url);
  } catch {
    _req = createRequire(import.meta.url);
  }
  return _req;
}

// ── sql.js pre-init ──────────────────────────────────────────────
// sql.js loads its WASM binary asynchronously. We pre-init it once
// (called via top-level await in the dashboard's gw.ts) so that
// openSqliteDatabase — which is sync — can use the cached module
// without an async cascade through UsageDB → gw() → route handlers.
let sqlJsModule: any = null;
let sqlJsInitAttempted = false;

export async function preInitSqlJs(): Promise<void> {
  if (sqlJsInitAttempted) return;
  sqlJsInitAttempted = true;
  try {
    const req = getRequire();
    const mod = req("sql.js") as any;
    const initSqlJs = mod.default ?? mod;
    sqlJsModule = await initSqlJs();
  } catch (e) {
    console.error("[sql.js] preInit FAILED:", (e as Error)?.message ?? e);
  }
}

// ── sql.js adapter ───────────────────────────────────────────────
// sql.js keeps the entire DB in memory (WASM-compiled SQLite).
// Persistence is manual: flush via db.export() → writeFileSync.
// Periodic flush every 5s + flush on close keeps data safe without
// write-amplifying on every request.

const FLUSH_INTERVAL_MS = 5_000;

class SqlJsStatementAdapter implements StatementSyncLike {
  constructor(
    private stmt: any,
    private dbAdapter: SqlJsDatabaseAdapter,
  ) {}

  get(...args: unknown[]): unknown {
    this.bindArgs(args);
    if (this.stmt.step()) {
      const row = this.stmt.getAsObject();
      this.stmt.reset();
      return row;
    }
    this.stmt.reset();
    return undefined;
  }

  all(...args: unknown[]): unknown[] {
    this.bindArgs(args);
    const rows: unknown[] = [];
    while (this.stmt.step()) rows.push(this.stmt.getAsObject());
    this.stmt.reset();
    return rows;
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    this.bindArgs(args);
    this.stmt.step();
    this.stmt.reset();
    this.dbAdapter.markDirty();
    const changes = this.dbAdapter.getRowsModified();
    const lastInsertRowid = this.dbAdapter.getLastInsertRowid();
    return { changes, lastInsertRowid };
  }

  private bindArgs(args: unknown[]): void {
    if (args.length === 0) return;
    const first = args[0];
    // Named params: sql.js expects keys WITH the prefix (@name / :name).
    // db.ts passes bare names ({model: "...", input: 123}) — add @ prefix.
    if (
      args.length === 1 &&
      typeof first === "object" &&
      first !== null &&
      !Array.isArray(first) &&
      !(first instanceof Date) &&
      !(first instanceof Uint8Array) &&
      !(first instanceof Buffer)
    ) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(first as Record<string, unknown>)) {
        obj[k.startsWith("@") || k.startsWith(":") || k.startsWith("$") ? k : "@" + k] = v;
      }
      this.stmt.bind(obj);
    } else {
      this.stmt.bind(args);
    }
  }
}

class SqlJsDatabaseAdapter implements DatabaseSyncLike {
  private db: any;
  private readonly path: string;
  private dirty = false;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private _lastRowidStmt: any = null;

  constructor(path: string, SQL: any) {
    this.path = path;
    if (path === ":memory:") {
      this.db = new SQL.Database();
    } else {
      if (existsSync(path)) {
        const buf = readFileSync(path);
        this.db = new SQL.Database(new Uint8Array(buf));
      } else {
        this.db = new SQL.Database();
      }
      this.flushTimer = setInterval(() => this.flushIfDirty(), FLUSH_INTERVAL_MS);
      if (typeof this.flushTimer.unref === "function") this.flushTimer.unref();
    }
  }

  exec(sql: string): void {
    this.db.exec(sql);
    this.dirty = true;
  }

  prepare(sql: string): StatementSyncLike {
    return new SqlJsStatementAdapter(this.db.prepare(sql), this);
  }

  markDirty(): void {
    this.dirty = true;
  }

  getRowsModified(): number {
    return this.db.getRowsModified();
  }

  getLastInsertRowid(): number {
    if (!this._lastRowidStmt) this._lastRowidStmt = this.db.prepare("SELECT last_insert_rowid() AS id");
    this._lastRowidStmt.step();
    const row = this._lastRowidStmt.getAsObject();
    this._lastRowidStmt.reset();
    return Number(row?.id) || 0;
  }

  private flushIfDirty(): void {
    if (!this.dirty || this.path === ":memory:") return;
    try {
      writeFileSync(this.path, Buffer.from(this.db.export()));
      this.dirty = false;
    } catch {
      // unwritable data dir — data stays in memory, will retry next flush
    }
  }

  close(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushIfDirty();
    try { this._lastRowidStmt?.free(); } catch {}
    try { this.db.close(); } catch {}
  }
}

// ── driver resolver ──────────────────────────────────────────────

/**
 * Opens `path` with the fastest available SQLite driver. Tries in order:
 *   1. better-sqlite3 (native C++ — fastest, may not be installed)
 *   2. node:sqlite (built-in since Node 22.5 — fast, always available)
 *   3. sql.js (pure WASM — always installable, slowest)
 *
 * better-sqlite3 is installed at runtime (not as an npm dependency) to
 * avoid triggering native build scripts during `npm install -g`. If
 * absent, falls through silently to node:sqlite, then sql.js.
 */
export function openSqliteDatabase(path: string, opts: OpenSqliteOptions = {}): OpenSqliteResult {
  const req = opts.requireFn ?? getRequire();
  const errors: string[] = [];

  if (opts.forceDriver !== "node:sqlite" && opts.forceDriver !== "sql.js") {
    let Better: (new (path: string) => DatabaseSyncLike) | undefined;
    try {
      Better = req("better-sqlite3") as new (path: string) => DatabaseSyncLike;
    } catch (e) {
      errors.push(`better-sqlite3: ${(e as Error)?.message ?? e}`);
      if (opts.forceDriver === "better-sqlite3") throw e;
    }
    if (Better) {
      return { db: new Better(path), driver: "better-sqlite3" };
    }
  }

  if (opts.forceDriver !== "better-sqlite3" && opts.forceDriver !== "sql.js") {
    try {
      const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (path: string) => DatabaseSyncLike };
      return { db: new DatabaseSync(path), driver: "node:sqlite" };
    } catch (e) {
      errors.push(`node:sqlite: ${(e as Error)?.message ?? e}`);
      if (opts.forceDriver === "node:sqlite") throw e;
    }
  }

  const SQL = opts.sqlJsModule ?? sqlJsModule;
  if (SQL) {
    return { db: new SqlJsDatabaseAdapter(path, SQL), driver: "sql.js" };
  }

  throw new Error(
    `[DB] No SQLite driver available. [${errors.join("; ")}]; sql.js module: ${sqlJsModule ? "loaded" : "null"}`,
  );
}
