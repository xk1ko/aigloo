import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { openSqliteDatabase, preInitSqlJs } from "../src/sqliteDriver.js";

describe("openSqliteDatabase", () => {
  it("uses better-sqlite3 when its require succeeds", () => {
    class FakeBetter {
      constructor(public path: string) {}
    }
    const requireFn = vi.fn((id: string) => {
      if (id === "better-sqlite3") return FakeBetter;
      throw new Error(`unexpected require(${id})`);
    });
    const { driver, db } = openSqliteDatabase(":memory:", { requireFn });
    expect(driver).toBe("better-sqlite3");
    expect(db).toBeInstanceOf(FakeBetter);
  });

  it("falls back to node:sqlite when better-sqlite3's require throws", () => {
    class FakeNodeSqlite {
      constructor(public path: string) {}
    }
    const requireFn = vi.fn((id: string) => {
      if (id === "better-sqlite3") throw new Error("no prebuilt binary for this platform");
      if (id === "node:sqlite") return { DatabaseSync: FakeNodeSqlite };
      throw new Error(`unexpected require(${id})`);
    });
    const { driver, db } = openSqliteDatabase(":memory:", { requireFn });
    expect(driver).toBe("node:sqlite");
    expect(db).toBeInstanceOf(FakeNodeSqlite);
  });

  it("falls back to sql.js when both better-sqlite3 and node:sqlite fail", () => {
    const fakeSqlJs = { Database: class { constructor() {} } };
    const requireFn = vi.fn((id: string) => {
      if (id === "better-sqlite3") throw new Error("not installed");
      if (id === "node:sqlite") throw new Error("not available");
      throw new Error(`unexpected require(${id})`);
    });
    const { driver } = openSqliteDatabase(":memory:", { requireFn, sqlJsModule: fakeSqlJs });
    expect(driver).toBe("sql.js");
  });

  it("forceDriver: 'sql.js' skips better-sqlite3 and node:sqlite entirely", () => {
    const fakeSqlJs = { Database: class { constructor() {} } };
    const requireFn = vi.fn(() => { throw new Error("should never be called"); });
    const { driver } = openSqliteDatabase(":memory:", { forceDriver: "sql.js", requireFn, sqlJsModule: fakeSqlJs });
    expect(driver).toBe("sql.js");
    expect(requireFn).not.toHaveBeenCalled();
  });

  it("throws when all three drivers are unavailable", () => {
    const requireFn = vi.fn((id: string) => {
      throw new Error(`unavailable: ${id}`);
    });
    expect(() => openSqliteDatabase(":memory:", { requireFn })).toThrow("No SQLite driver available");
  });

  it("forceDriver: 'node:sqlite' skips the better-sqlite3 probe entirely", () => {
    const requireFn = vi.fn((id: string) => {
      if (id === "better-sqlite3") throw new Error("should never be called");
      if (id === "node:sqlite") return { DatabaseSync: class { constructor(public path: string) {} } };
      throw new Error(`unexpected require(${id})`);
    });
    const { driver } = openSqliteDatabase(":memory:", { forceDriver: "node:sqlite", requireFn });
    expect(driver).toBe("node:sqlite");
    expect(requireFn).not.toHaveBeenCalledWith("better-sqlite3");
  });

  it("forceDriver: 'better-sqlite3' rethrows instead of silently falling back", () => {
    const requireFn = vi.fn((id: string) => {
      if (id === "better-sqlite3") throw new Error("forced failure");
      throw new Error(`unexpected require(${id})`);
    });
    expect(() => openSqliteDatabase(":memory:", { forceDriver: "better-sqlite3", requireFn })).toThrow("forced failure");
  });

  it("really opens a working database with the real node:sqlite driver (no mocks)", () => {
    const { db, driver } = openSqliteDatabase(":memory:", { forceDriver: "node:sqlite" });
    expect(driver).toBe("node:sqlite");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
    const row = db.prepare("SELECT * FROM t WHERE id = ?").get(1) as { v: string };
    expect(row.v).toBe("hello");
    db.close();
  });

  const betterSqliteAvailable = (() => {
    try {
      createRequire(import.meta.url)("better-sqlite3");
      return true;
    } catch {
      return false;
    }
  })();

  it("propagates a real DB-open error instead of silently falling back (better-sqlite3 module loads fine, constructor throws)", () => {
    class ThrowingBetter {
      constructor(_path: string) {
        throw new Error("EACCES: permission denied");
      }
    }
    const requireFn = vi.fn((id: string) => {
      if (id === "better-sqlite3") return ThrowingBetter;
      throw new Error(`unexpected require(${id}) — should not reach node:sqlite fallback`);
    });
    expect(() => openSqliteDatabase("/no/permission/path", { requireFn })).toThrow("EACCES");
  });

  it.skipIf(!betterSqliteAvailable)(
    "really opens a working database with the real better-sqlite3 driver (no mocks)",
    () => {
      const { db, driver } = openSqliteDatabase(":memory:", { forceDriver: "better-sqlite3" });
      expect(driver).toBe("better-sqlite3");
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
      db.prepare("INSERT INTO t (v) VALUES (?)").run("hello");
      const row = db.prepare("SELECT * FROM t WHERE id = ?").get(1) as { v: string };
      expect(row.v).toBe("hello");
      db.close();
    },
  );
});

describe("preInitSqlJs", () => {
  it("does not throw when sql.js is available", async () => {
    await expect(preInitSqlJs()).resolves.not.toThrow();
  });

  it("is idempotent — second call is a no-op", async () => {
    await preInitSqlJs();
    await preInitSqlJs();
  });
});
