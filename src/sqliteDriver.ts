import { createRequire } from "node:module";

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

export type SqliteDriverName = "better-sqlite3" | "node:sqlite";

export interface OpenSqliteResult {
  db: DatabaseSyncLike;
  driver: SqliteDriverName;
}

interface OpenSqliteOptions {
  /** Test-only: force a specific driver instead of probing better-sqlite3 first. */
  forceDriver?: SqliteDriverName;
  /** Test-only: inject a fake require instead of node:module's real one. */
  requireFn?: (id: string) => unknown;
}

/**
 * Opens `path` with the fastest available SQLite driver: native
 * better-sqlite3 (optionalDependency — may be absent if the platform has
 * no prebuilt binary and no build tools), else the Node builtin
 * node:sqlite (>=22.5, this package's floor — see package.json engines
 * and cli.ts's --experimental-sqlite injection for 22.5-22.12). Both
 * expose the same exec/prepare/get/all/run shape db.ts's queries use —
 * verified for positional args, @name objects, ON CONFLICT...DO UPDATE,
 * PRAGMA table_info, and FILTER(WHERE).
 */
export function openSqliteDatabase(path: string, opts: OpenSqliteOptions = {}): OpenSqliteResult {
  const req = opts.requireFn ?? createRequire(import.meta.url);

  if (opts.forceDriver !== "node:sqlite") {
    let Better: (new (path: string) => DatabaseSyncLike) | undefined;
    try {
      Better = req("better-sqlite3") as new (path: string) => DatabaseSyncLike;
    } catch (e) {
      if (opts.forceDriver === "better-sqlite3") throw e;
      // not installed (optionalDependency skipped — no build tools / no
      // prebuilt binary for this platform) — fall through to node:sqlite.
    }
    if (Better) {
      return { db: new Better(path), driver: "better-sqlite3" };
    }
  }

  const { DatabaseSync } = req("node:sqlite") as { DatabaseSync: new (path: string) => DatabaseSyncLike };
  return { db: new DatabaseSync(path), driver: "node:sqlite" };
}
