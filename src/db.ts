/**
 * Usage tracking store, backed by SQLite (better-sqlite3 if available,
 * else the built-in node:sqlite — see sqliteDriver.ts). One `usage` row
 * per upstream request that produced usage; an optional `logs` table
 * holds request/response summaries for debugging. Unified under DATA_DIR
 * (default ./data).
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openSqliteDatabase, type DatabaseSyncLike, type SqliteDriverName } from "./sqliteDriver.js";

export interface UsageRow {
  ts: number;
  alias: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  reasoning_tokens: number;
  cached_tokens: number;
  cache_creation_tokens: number;
  cost: number;
  cost_out: number;
  status: number;
  latency_ms: number;
  stream: number; // 0/1
  client_key: string;
  rtk_bytes_in: number;
  rtk_bytes_out: number;
  headroom_tokens_before: number;
  headroom_tokens_after: number;
  caveman_level: string;
  ponytail_level: string;
  rtk_cost_saved: number;
  headroom_cost_saved: number;
}

export interface SavingsSummary {
  rtk: { bytes_in: number; bytes_out: number; hits: number; cost_saved: number };
  headroom: { tokens_before: number; tokens_after: number; hits: number; cost_saved: number };
  by_caveman_level: Array<{ level: string; requests: number; avg_tokens_out: number }>;
  by_ponytail_level: Array<{ level: string; requests: number; avg_tokens_out: number }>;
}

export interface LogRow {
  ts: number;
  direction: string; // "ingress" | "egress" | "error"
  provider: string;
  status: number;
  request_summary: string;
  response_summary: string;
}

export interface UsageTotals {
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

export interface UsageSummary {
  total: { requests: number; tokens_in: number; tokens_out: number; cost: number; cost_out: number };
  by_provider: Array<{ provider: string; requests: number; tokens_in: number; tokens_out: number; cost: number; cost_out: number }>;
  by_model: Array<{ alias: string; model: string; requests: number; tokens_in: number; tokens_out: number; cost: number; cost_out: number }>;
}

export interface UsageSeriesPoint {
  ts: number;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  cost: number;
}

// node:sqlite returns loosely-typed rows; this alias documents the cast site.
type SqlRow = Record<string, unknown>;
const num = (v: unknown): number => Number(v ?? 0);

export class UsageDB {
  private readonly db: DatabaseSyncLike;
  readonly driver: SqliteDriverName;
  private readonly insertUsage;
  private readonly insertLog;
  private readonly upsertPricing;
  private readonly deletePricing;
  private readonly getAllPricing;
  private readonly clearSyncedPricingStmt;
  private readonly clearAllSyncedPricingStmt;
  private readonly insertSyncedPricing;
  private readonly listSyncedPricingStmt;
  private readonly listAllSyncedPricingStmt;
  private readonly clearSyncedCapsStmt;
  private readonly insertSyncedCaps;
  private readonly listSyncedCapsStmt;
  private readonly upsertNotification;
  private readonly getNotification;
  private readonly getAllNotifications;
  private readonly insertAlertLog;
  private readonly getRecentAlerts;
  private readonly getAlertStateStmt;
  private readonly upsertAlertState;
  private readonly clearAlertStateStmt;
  private readonly now: () => number;

  constructor(
    path: string,
    now: () => number = Date.now,
    driverOpts: { forceDriver?: SqliteDriverName } = {},
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    // AIGLOO_TEST_FORCE_SQLITE_DRIVER lets the existing test suite run
    // unmodified against both drivers for parity checking (see Task 3 in
    // .local-plans/sqlite-driver-chain.md) — never set outside tests.
    const forceDriver =
      driverOpts.forceDriver ?? (process.env.AIGLOO_TEST_FORCE_SQLITE_DRIVER as SqliteDriverName | undefined);
    const { db, driver } = openSqliteDatabase(path, { forceDriver });
    this.db = db;
    this.driver = driver;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        alias TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        cost_out REAL NOT NULL DEFAULT 0,
        status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        stream INTEGER NOT NULL DEFAULT 0,
        client_key TEXT NOT NULL DEFAULT '',
        rtk_bytes_in INTEGER NOT NULL DEFAULT 0,
        rtk_bytes_out INTEGER NOT NULL DEFAULT 0,
        headroom_tokens_before INTEGER NOT NULL DEFAULT 0,
        headroom_tokens_after INTEGER NOT NULL DEFAULT 0,
        caveman_level TEXT NOT NULL DEFAULT 'off',
        ponytail_level TEXT NOT NULL DEFAULT 'off',
        rtk_cost_saved REAL NOT NULL DEFAULT 0,
        headroom_cost_saved REAL NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts);
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        direction TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        status INTEGER NOT NULL DEFAULT 0,
        request_summary TEXT NOT NULL DEFAULT '',
        response_summary TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);
      CREATE TABLE IF NOT EXISTS quota_state (
        provider_id TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0,
        last_reset INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS pricing_overrides (
        model TEXT PRIMARY KEY,
        input REAL,
        output REAL,
        cached REAL,
        cache_creation REAL,
        reasoning REAL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pricing_synced (
        source TEXT NOT NULL,
        model TEXT NOT NULL,
        input REAL,
        output REAL,
        cached REAL,
        cache_creation REAL,
        reasoning REAL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (source, model)
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_synced_model ON pricing_synced(model);
      CREATE TABLE IF NOT EXISTS capabilities_synced (
        model TEXT PRIMARY KEY,
        caps_json TEXT NOT NULL,
        fetched_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        url TEXT NOT NULL DEFAULT '',
        token TEXT NOT NULL DEFAULT '',
        chat_id TEXT NOT NULL DEFAULT '',
        events TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alert_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT '',
        message TEXT NOT NULL,
        delivered INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS alert_state (
        scope TEXT PRIMARY KEY,
        alerted_at INTEGER NOT NULL,
        window_start INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alert_log_ts ON alert_log(ts);
    `);
    // migrate older DBs created before client_key existed.
    const cols = this.db.prepare(`PRAGMA table_info(usage)`).all() as SqlRow[];
    if (!cols.some((c) => String(c.name) === "client_key")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN client_key TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols.some((c) => String(c.name) === "reasoning_tokens")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN reasoning_tokens INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "cache_creation_tokens")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "rtk_bytes_in")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN rtk_bytes_in INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "rtk_bytes_out")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN rtk_bytes_out INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "headroom_tokens_before")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN headroom_tokens_before INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "headroom_tokens_after")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN headroom_tokens_after INTEGER NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "caveman_level")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN caveman_level TEXT NOT NULL DEFAULT 'off'`);
    }
    if (!cols.some((c) => String(c.name) === "ponytail_level")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN ponytail_level TEXT NOT NULL DEFAULT 'off'`);
    }
    if (!cols.some((c) => String(c.name) === "rtk_cost_saved")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN rtk_cost_saved REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "headroom_cost_saved")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN headroom_cost_saved REAL NOT NULL DEFAULT 0`);
    }
    if (!cols.some((c) => String(c.name) === "cost_out")) {
      this.db.exec(`ALTER TABLE usage ADD COLUMN cost_out REAL NOT NULL DEFAULT 0`);
    }
    const alertCols = this.db.prepare(`PRAGMA table_info(alert_log)`).all() as SqlRow[];
    if (!alertCols.some((c) => String(c.name) === "channel")) {
      this.db.exec(`ALTER TABLE alert_log ADD COLUMN channel TEXT NOT NULL DEFAULT ''`);
    }
    this.now = now;
    this.insertUsage = this.db.prepare(`
      INSERT INTO usage (ts, alias, provider, model, tokens_in, tokens_out, reasoning_tokens, cached_tokens, cache_creation_tokens, cost, cost_out, status, latency_ms, stream, client_key, rtk_bytes_in, rtk_bytes_out, headroom_tokens_before, headroom_tokens_after, caveman_level, ponytail_level, rtk_cost_saved, headroom_cost_saved)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertLog = this.db.prepare(`
      INSERT INTO logs (ts, direction, provider, status, request_summary, response_summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.upsertPricing = this.db.prepare(`
      INSERT INTO pricing_overrides (model, input, output, cached, cache_creation, reasoning, updated_at)
      VALUES (@model, @input, @output, @cached, @cache_creation, @reasoning, @ts)
      ON CONFLICT(model) DO UPDATE SET
        input = @input, output = @output, cached = @cached,
        cache_creation = @cache_creation, reasoning = @reasoning, updated_at = @ts
    `);
    this.deletePricing = this.db.prepare(`DELETE FROM pricing_overrides WHERE model = ?`);
    this.getAllPricing = this.db.prepare(`SELECT * FROM pricing_overrides ORDER BY model`);
    this.clearSyncedPricingStmt = this.db.prepare(`DELETE FROM pricing_synced WHERE source = ?`);
    this.clearAllSyncedPricingStmt = this.db.prepare(`DELETE FROM pricing_synced`);
    this.insertSyncedPricing = this.db.prepare(`
      INSERT INTO pricing_synced (source, model, input, output, cached, cache_creation, reasoning, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source, model) DO UPDATE SET
        input = excluded.input, output = excluded.output, cached = excluded.cached,
        cache_creation = excluded.cache_creation, reasoning = excluded.reasoning,
        fetched_at = excluded.fetched_at
    `);
    this.listSyncedPricingStmt = this.db.prepare(`SELECT * FROM pricing_synced WHERE source = ? ORDER BY model`);
    this.listAllSyncedPricingStmt = this.db.prepare(`SELECT * FROM pricing_synced ORDER BY source, model`);
    this.clearSyncedCapsStmt = this.db.prepare(`DELETE FROM capabilities_synced`);
    this.insertSyncedCaps = this.db.prepare(`
      INSERT INTO capabilities_synced (model, caps_json, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(model) DO UPDATE SET caps_json = excluded.caps_json, fetched_at = excluded.fetched_at
    `);
    this.listSyncedCapsStmt = this.db.prepare(`SELECT * FROM capabilities_synced ORDER BY model`);
    this.upsertNotification = this.db.prepare(`
      INSERT INTO notifications (id, enabled, url, token, chat_id, events, updated_at)
      VALUES (@id, @enabled, @url, @token, @chat_id, @events, @ts)
      ON CONFLICT(id) DO UPDATE SET
        enabled = @enabled, url = @url, token = @token, chat_id = @chat_id,
        events = @events, updated_at = @ts
    `);
    this.getNotification = this.db.prepare(`SELECT * FROM notifications WHERE id = ?`);
    this.getAllNotifications = this.db.prepare(`SELECT * FROM notifications ORDER BY id`);
    this.insertAlertLog = this.db.prepare(`
      INSERT INTO alert_log (ts, type, scope, channel, message, delivered, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.getRecentAlerts = this.db.prepare(`SELECT * FROM alert_log ORDER BY id DESC LIMIT ?`);
    this.getAlertStateStmt = this.db.prepare(`SELECT * FROM alert_state WHERE scope = ?`);
    this.upsertAlertState = this.db.prepare(`
      INSERT INTO alert_state (scope, alerted_at, window_start)
      VALUES (@scope, @alerted_at, @window_start)
      ON CONFLICT(scope) DO UPDATE SET alerted_at = @alerted_at, window_start = @window_start
    `);
    this.clearAlertStateStmt = this.db.prepare(`DELETE FROM alert_state WHERE scope = ?`);
  }

  record(
    row: Omit<
      UsageRow,
      | "ts"
      | "client_key"
      | "reasoning_tokens"
      | "cache_creation_tokens"
      | "rtk_bytes_in"
      | "rtk_bytes_out"
      | "headroom_tokens_before"
      | "headroom_tokens_after"
      | "caveman_level"
      | "ponytail_level"
      | "rtk_cost_saved"
      | "headroom_cost_saved"
      | "cost_out"
    > & {
      ts?: number;
      client_key?: string;
      reasoning_tokens?: number;
      cache_creation_tokens?: number;
      rtk_bytes_in?: number;
      rtk_bytes_out?: number;
      headroom_tokens_before?: number;
      headroom_tokens_after?: number;
      caveman_level?: string;
      ponytail_level?: string;
      rtk_cost_saved?: number;
      headroom_cost_saved?: number;
      cost_out?: number;
    },
  ): void {
    this.insertUsage.run(
      row.ts ?? this.now(),
      row.alias,
      row.provider,
      row.model,
      row.tokens_in,
      row.tokens_out,
      row.reasoning_tokens ?? 0,
      row.cached_tokens,
      row.cache_creation_tokens ?? 0,
      row.cost,
      row.cost_out ?? 0,
      row.status,
      row.latency_ms,
      row.stream,
      row.client_key ?? "",
      row.rtk_bytes_in ?? 0,
      row.rtk_bytes_out ?? 0,
      row.headroom_tokens_before ?? 0,
      row.headroom_tokens_after ?? 0,
      row.caveman_level ?? "off",
      row.ponytail_level ?? "off",
      row.rtk_cost_saved ?? 0,
      row.headroom_cost_saved ?? 0,
    );
  }

  log(row: Omit<LogRow, "ts"> & { ts?: number }): void {
    this.insertLog.run(
      row.ts ?? this.now(),
      row.direction,
      row.provider,
      row.status,
      row.request_summary,
      row.response_summary,
    );
  }

  /** Summary over rows with ts >= sinceMs (default: all time). */
  summary(sinceMs = 0): UsageSummary {
    const total = this.db
      .prepare(
        `SELECT COUNT(*) requests, COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost,
                COALESCE(SUM(cost_out),0) cost_out
         FROM usage WHERE ts >= ?`,
      )
      .get(sinceMs) as SqlRow;

    const by_provider = this.db
      .prepare(
        `SELECT provider, COUNT(*) requests, COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost,
                COALESCE(SUM(cost_out),0) cost_out
         FROM usage WHERE ts >= ? GROUP BY provider ORDER BY cost DESC`,
      )
      .all(sinceMs) as SqlRow[];

    const by_model = this.db
      .prepare(
        `SELECT alias, model, COUNT(*) requests, COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost,
                COALESCE(SUM(cost_out),0) cost_out
         FROM usage WHERE ts >= ? GROUP BY alias, model ORDER BY cost DESC`,
      )
      .all(sinceMs) as SqlRow[];

    return {
      total: {
        requests: num(total.requests),
        tokens_in: num(total.tokens_in),
        tokens_out: num(total.tokens_out),
        cost: num(total.cost),
        cost_out: num(total.cost_out),
      },
      by_provider: by_provider.map((r) => ({
        provider: String(r.provider),
        requests: num(r.requests),
        tokens_in: num(r.tokens_in),
        tokens_out: num(r.tokens_out),
        cost: num(r.cost),
        cost_out: num(r.cost_out),
      })),
      by_model: by_model.map((r) => ({
        alias: String(r.alias),
        model: String(r.model),
        requests: num(r.requests),
        tokens_in: num(r.tokens_in),
        tokens_out: num(r.tokens_out),
        cost: num(r.cost),
        cost_out: num(r.cost_out),
      })),
    };
  }

  /**
   * Summed token + cost totals over rows with ts >= sinceMs, optionally filtered
   * to one provider and/or one model. Backs the scoped budget tracker — the usage
   * table stays the single source of truth (no parallel counter).
   */
  totals(sinceMs: number, filter?: { provider?: string; model?: string; client_key?: string }): UsageTotals {
    const clauses = ["ts >= ?"];
    const params: Array<number | string> = [sinceMs];
    if (filter?.provider) {
      clauses.push("provider = ?");
      params.push(filter.provider);
    }
    if (filter?.model) {
      clauses.push("model = ?");
      params.push(filter.model);
    }
    if (filter?.client_key) {
      clauses.push("client_key = ?");
      params.push(filter.client_key);
    }
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(tokens_in),0) tokens_in, COALESCE(SUM(tokens_out),0) tokens_out,
                COALESCE(SUM(cost),0) cost
         FROM usage WHERE ${clauses.join(" AND ")}`,
      )
      .get(...params) as SqlRow;
    return { tokens_in: num(row.tokens_in), tokens_out: num(row.tokens_out), cost: num(row.cost) };
  }

  /**
   * Bucketed time-series for charts: one point per `bucketMs` interval from
   * `sinceMs` to now, aligned to the bucket boundary, with zero-filled gaps.
   */
  series(sinceMs: number, bucketMs: number): UsageSeriesPoint[] {
    const now = this.now();
    const start = Math.floor(sinceMs / bucketMs) * bucketMs;
    const rows = this.db
      .prepare(
        `SELECT CAST(ts / ? AS INTEGER) * ? AS bucket, COUNT(*) requests,
                COALESCE(SUM(tokens_in),0) tokens_in,
                COALESCE(SUM(tokens_out),0) tokens_out, COALESCE(SUM(cost),0) cost
         FROM usage WHERE ts >= ? GROUP BY bucket ORDER BY bucket`,
      )
      .all(bucketMs, bucketMs, sinceMs) as SqlRow[];

    const byBucket = new Map<number, SqlRow>();
    for (const r of rows) byBucket.set(num(r.bucket), r);

    const out: UsageSeriesPoint[] = [];
    for (let t = start; t <= now; t += bucketMs) {
      const r = byBucket.get(t);
      out.push({
        ts: t,
        requests: r ? num(r.requests) : 0,
        tokens_in: r ? num(r.tokens_in) : 0,
        tokens_out: r ? num(r.tokens_out) : 0,
        cost: r ? num(r.cost) : 0,
      });
    }
    return out;
  }

  /** Most recent usage rows, newest first. For the dashboard logs page. */
  recent(limit = 100): UsageRow[] {
    const rows = this.db
      .prepare(
        `SELECT ts, alias, provider, model, tokens_in, tokens_out, reasoning_tokens, cached_tokens, cache_creation_tokens,
                 cost, cost_out, status, latency_ms, stream, client_key, rtk_bytes_in, rtk_bytes_out,
                 headroom_tokens_before, headroom_tokens_after, caveman_level, ponytail_level,
                 rtk_cost_saved, headroom_cost_saved
         FROM usage ORDER BY id DESC LIMIT ?`,
      )
      .all(Math.max(1, Math.min(limit, 1000))) as SqlRow[];
    return rows.map((r) => ({
      ts: num(r.ts),
      alias: String(r.alias),
      provider: String(r.provider),
      model: String(r.model),
      tokens_in: num(r.tokens_in),
      tokens_out: num(r.tokens_out),
      reasoning_tokens: num(r.reasoning_tokens),
      cached_tokens: num(r.cached_tokens),
      cache_creation_tokens: num(r.cache_creation_tokens),
      cost: num(r.cost),
      cost_out: num(r.cost_out),
      status: num(r.status),
      latency_ms: num(r.latency_ms),
      stream: num(r.stream),
      client_key: String(r.client_key ?? ""),
      rtk_bytes_in: num(r.rtk_bytes_in),
      rtk_bytes_out: num(r.rtk_bytes_out),
      headroom_tokens_before: num(r.headroom_tokens_before),
      headroom_tokens_after: num(r.headroom_tokens_after),
      caveman_level: String(r.caveman_level ?? "off"),
      ponytail_level: String(r.ponytail_level ?? "off"),
      rtk_cost_saved: num(r.rtk_cost_saved),
      headroom_cost_saved: num(r.headroom_cost_saved),
    }));
  }

  /**
   * Token-saver ROI: byte-diff totals for RTK/Headroom (both have a real
   * before/after measurement) plus an avg-tokens_out-by-level breakdown for
   * caveman/ponytail (which bias model *output*, so there's no direct
   * counterfactual — the level breakdown is an honest trend, not a fabricated
   * savings figure). cost_saved is computed per-request at record time (see
   * recordUsage in core/handler.ts) using that request's actual input price,
   * so it's an aggregate SUM here rather than reconstructed from bytes/tokens
   * — the latter would need a single price across possibly many models.
   */
  savingsSummary(sinceMs = 0): SavingsSummary {
    const rtk = this.db
      .prepare(
        `SELECT COALESCE(SUM(rtk_bytes_in),0) bytes_in, COALESCE(SUM(rtk_bytes_out),0) bytes_out,
                COALESCE(SUM(rtk_cost_saved),0) cost_saved,
                COUNT(*) FILTER (WHERE rtk_bytes_in > 0) hits
         FROM usage WHERE ts >= ?`,
      )
      .get(sinceMs) as SqlRow;

    const headroom = this.db
      .prepare(
        `SELECT COALESCE(SUM(headroom_tokens_before),0) tokens_before,
                COALESCE(SUM(headroom_tokens_after),0) tokens_after,
                COALESCE(SUM(headroom_cost_saved),0) cost_saved,
                COUNT(*) FILTER (WHERE headroom_tokens_before > 0) hits
         FROM usage WHERE ts >= ?`,
      )
      .get(sinceMs) as SqlRow;

    const byLevel = (col: "caveman_level" | "ponytail_level") =>
      (
        this.db
          .prepare(
            `SELECT ${col} level, COUNT(*) requests, COALESCE(AVG(tokens_out),0) avg_tokens_out
             FROM usage WHERE ts >= ? GROUP BY ${col} ORDER BY ${col}`,
          )
          .all(sinceMs) as SqlRow[]
      ).map((r) => ({ level: String(r.level), requests: num(r.requests), avg_tokens_out: num(r.avg_tokens_out) }));

    return {
      rtk: { bytes_in: num(rtk.bytes_in), bytes_out: num(rtk.bytes_out), hits: num(rtk.hits), cost_saved: num(rtk.cost_saved) },
      headroom: { tokens_before: num(headroom.tokens_before), tokens_after: num(headroom.tokens_after), hits: num(headroom.hits), cost_saved: num(headroom.cost_saved) },
      by_caveman_level: byLevel("caveman_level"),
      by_ponytail_level: byLevel("ponytail_level"),
    };
  }

  close(): void {
    this.db.close();
  }

  getNotificationConfig(id: string): NotificationConfigRow | null {
    const r = this.getNotification.get(id) as SqlRow | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      enabled: num(r.enabled) === 1,
      url: String(r.url ?? ""),
      token: String(r.token ?? ""),
      chat_id: String(r.chat_id ?? ""),
      events: JSON.parse(String(r.events ?? "[]")) as string[],
      updated_at: num(r.updated_at),
    };
  }

  listNotificationConfigs(): NotificationConfigRow[] {
    return (this.getAllNotifications.all() as SqlRow[]).map((r) => ({
      id: String(r.id),
      enabled: num(r.enabled) === 1,
      url: String(r.url ?? ""),
      token: String(r.token ?? ""),
      chat_id: String(r.chat_id ?? ""),
      events: JSON.parse(String(r.events ?? "[]")) as string[],
      updated_at: num(r.updated_at),
    }));
  }

  setNotificationConfig(cfg: { id: string; enabled: boolean; url?: string; token?: string; chat_id?: string; events?: string[] }): void {
    this.upsertNotification.run({
      id: cfg.id,
      enabled: cfg.enabled ? 1 : 0,
      url: cfg.url ?? "",
      token: cfg.token ?? "",
      chat_id: cfg.chat_id ?? "",
      events: JSON.stringify(cfg.events ?? []),
      ts: this.now(),
    });
  }

  logAlert(type: string, scope: string, channel: string, message: string, delivered: boolean, error?: string): void {
    this.insertAlertLog.run(this.now(), type, scope, channel, message, delivered ? 1 : 0, error ?? "");
  }

  recentAlerts(limit = 50): AlertLogRow[] {
    return (this.getRecentAlerts.all(Math.max(1, Math.min(limit, 500))) as SqlRow[]).map((r) => ({
      id: num(r.id),
      ts: num(r.ts),
      type: String(r.type),
      scope: String(r.scope),
      channel: String(r.channel ?? ""),
      message: String(r.message),
      delivered: num(r.delivered) === 1,
      error: String(r.error ?? ""),
    }));
  }

  getAlertState(scope: string): { alerted_at: number; window_start: number } | null {
    const r = this.getAlertStateStmt.get(scope) as SqlRow | undefined;
    if (!r) return null;
    return { alerted_at: num(r.alerted_at), window_start: num(r.window_start) };
  }

  setAlertState(scope: string, alertedAt: number, windowStart: number): void {
    this.upsertAlertState.run({ scope, alerted_at: alertedAt, window_start: windowStart });
  }

  clearAlertState(scope: string): void {
    this.clearAlertStateStmt.run(scope);
  }

  setPricingOverride(model: string, p: { input?: number | null; output?: number | null; cached?: number | null; cache_creation?: number | null; reasoning?: number | null }): void {
    this.upsertPricing.run({
      model,
      input: p.input ?? null,
      output: p.output ?? null,
      cached: p.cached ?? null,
      cache_creation: p.cache_creation ?? null,
      reasoning: p.reasoning ?? null,
      ts: this.now(),
    });
  }

  deletePricingOverride(model: string): void {
    this.deletePricing.run(model);
  }

  listPricingOverrides(): Array<{ model: string; input: number | null; output: number | null; cached: number | null; cache_creation: number | null; reasoning: number | null; updated_at: number }> {
    return this.getAllPricing.all() as Array<{
      model: string; input: number | null; output: number | null; cached: number | null;
      cache_creation: number | null; reasoning: number | null; updated_at: number;
    }>;
  }

  /** Full-replace synced rows for one source. Synced pricing never touches user overrides (pricing_overrides) — it sits below runtimeOverrides in the resolution chain. */
  saveSyncedPricing(source: string, rows: Array<{ model: string; pricing: { input: number; output: number; cached?: number; cache_creation?: number; reasoning?: number } }>): void {
    const now = this.now();
    this.db.exec("BEGIN");
    try {
      this.clearSyncedPricingStmt.run(source);
      for (const { model, pricing } of rows) {
        this.insertSyncedPricing.run(
          source, model,
          pricing.input, pricing.output,
          pricing.cached ?? null, pricing.cache_creation ?? null, pricing.reasoning ?? null,
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  clearSyncedPricing(source?: string): void {
    if (source) this.clearSyncedPricingStmt.run(source);
    else this.clearAllSyncedPricingStmt.run();
  }

  listSyncedPricing(source?: string): Array<{ source: string; model: string; input: number; output: number; cached: number | null; cache_creation: number | null; reasoning: number | null; fetched_at: number }> {
    const rows = (source ? this.listSyncedPricingStmt.all(source) : this.listAllSyncedPricingStmt.all()) as SqlRow[];
    return rows.map((r) => ({
      source: String(r.source),
      model: String(r.model),
      input: num(r.input),
      output: num(r.output),
      cached: r.cached === null ? null : num(r.cached),
      cache_creation: r.cache_creation === null ? null : num(r.cache_creation),
      reasoning: r.reasoning === null ? null : num(r.reasoning),
      fetched_at: num(r.fetched_at),
    }));
  }

  saveSyncedCapabilities(rows: Array<{ model: string; caps: Record<string, unknown> }>): void {
    const now = this.now();
    this.db.exec("BEGIN");
    try {
      this.clearSyncedCapsStmt.run();
      for (const { model, caps } of rows) {
        this.insertSyncedCaps.run(model, JSON.stringify(caps), now);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  listSyncedCapabilities(): Array<{ model: string; caps: Record<string, unknown>; fetched_at: number }> {
    const rows = this.listSyncedCapsStmt.all() as SqlRow[];
    return rows.map((r) => ({
      model: String(r.model),
      caps: JSON.parse(String(r.caps_json ?? "{}")) as Record<string, unknown>,
      fetched_at: num(r.fetched_at),
    }));
  }
}

export interface NotificationConfigRow {
  id: string;
  enabled: boolean;
  url: string;
  token: string;
  chat_id: string;
  events: string[];
  updated_at: number;
}

export interface AlertLogRow {
  id: number;
  ts: number;
  type: string;
  scope: string;
  channel: string;
  message: string;
  delivered: boolean;
  error: string;
}

export interface CostBreakdown {
  tokensIn: number;
  tokensOut: number;
  cachedTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  priceIn: number;
  priceOut: number;
  priceCached: number;
  priceCacheCreation: number;
  priceReasoning: number;
}

export function computeCost(b: CostBreakdown): number {
  const nonCachedInput = Math.max(0, b.tokensIn - b.cachedTokens - b.cacheCreationTokens);
  let cost = 0;
  cost += nonCachedInput * (b.priceIn / 1_000_000);
  if (b.cachedTokens > 0) cost += b.cachedTokens * (b.priceCached / 1_000_000);
  if (b.cacheCreationTokens > 0) cost += b.cacheCreationTokens * (b.priceCacheCreation / 1_000_000);
  cost += b.tokensOut * (b.priceOut / 1_000_000);
  if (b.reasoningTokens > 0) cost += b.reasoningTokens * (b.priceReasoning / 1_000_000);
  return cost;
}

export function computeCostOut(b: CostBreakdown): number {
  return b.tokensOut * (b.priceOut / 1_000_000)
    + b.reasoningTokens * (b.priceReasoning / 1_000_000);
}
