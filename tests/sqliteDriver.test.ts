import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { openSqliteDatabase } from "../src/sqliteDriver.js";

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
