import { NextResponse } from "next/server";
import { preInitSqlJs, openSqliteDatabase, getRequire } from "@/gw/sqliteDriver.js";

export async function GET(): Promise<NextResponse> {
  const diag: Record<string, unknown> = {};

  // 1. import.meta.url
  diag.importMetaUrl = import.meta.url;

  // 2. process.argv
  diag.argv1 = process.argv[1] ?? null;

  // 3. NODE_PATH
  diag.nodePath = process.env.NODE_PATH ?? null;

  // 4. getRequire
  try {
    const req = getRequire();
    diag.getRequire = "ok";
    diag.requireResolvedFrom = typeof req === "function" ? "function" : "unknown";
  } catch (e: any) {
    diag.getRequire = `FAIL: ${e?.message ?? e}`;
  }

  // 5. Try each driver
  const req = getRequire();

  try { req("better-sqlite3"); diag.betterSqlite3 = "found"; }
  catch (e: any) { diag.betterSqlite3 = `FAIL: ${e?.message ?? e}`; }

  try { req("node:sqlite"); diag.nodeSqlite = "found"; }
  catch (e: any) { diag.nodeSqlite = `FAIL: ${e?.message ?? e}`; }

  try { req("sql.js"); diag.sqlJs = "found"; }
  catch (e: any) { diag.sqlJs = `FAIL: ${e?.message ?? e}`; }

  // 6. preInitSqlJs
  try {
    await preInitSqlJs();
    diag.preInitSqlJs = "ok";
  } catch (e: any) {
    diag.preInitSqlJs = `FAIL: ${e?.message ?? e}`;
  }

  // 7. Try opening DB in-memory
  try {
    const { db, driver } = openSqliteDatabase(":memory:");
    db.exec("CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1)");
    diag.openDb = `ok (${driver})`;
    db.close();
  } catch (e: any) {
    diag.openDb = `FAIL: ${e?.message ?? e}`;
    diag.openDbStack = e?.stack ?? null;
  }

  return NextResponse.json(diag, { status: 200 });
}
