import "server-only";
import { join } from "node:path";
import { loadConfig } from "@/gw/config.js";
import { getDataDir, getConfigPath } from "@/gw/appDirs.js";
import { GatewayState } from "@/gw/core/state.js";
import { UsageDB } from "@/gw/db.js";
import { AuthStore } from "@/gw/core/authStore.js";
import { Notifier } from "@/gw/core/notifier.js";
import { RateLimiter } from "@/gw/core/ratelimit.js";
import { consoleBuffer } from "@/gw/core/console-buffer.js";
import { initAdmin } from "@/gw/core/admin-handler.js";

export interface Gw {
  state: GatewayState;
  db: UsageDB;
  auth: AuthStore;
  notifier: Notifier;
  limiter: RateLimiter;
  log: (msg: string) => void;
}

// Anchored on globalThis (not a plain module-level `let`) so Next.js dev-mode
// HMR — which re-evaluates this module on every edit to its dependency graph —
// doesn't reset it and silently open a second sqlite/AuthStore handle. Same
// pattern Next's own docs recommend for a Prisma-style singleton.
declare global {
  var __aigloo_gw: Gw | undefined;
}

function init(): Gw {
  const configPath = getConfigPath();
  const config = loadConfig(configPath);
  const dataDir = getDataDir();
  const db = new UsageDB(join(dataDir, "usage.sqlite"));
  consoleBuffer.push("INFO", `usage DB driver: ${db.driver}`);
  const state = new GatewayState(configPath, config, db);
  const auth = AuthStore.open(dataDir, process.env.AIGLOO_ADMIN_PASSWORD);
  const notifier = new Notifier(db);
  const limiter = new RateLimiter();

  const log = (msg: string) => {
    consoleBuffer.push("INFO", msg);
    console.log(msg);
  };

  // Also seeds the runtime pricing-override map — same function handleAdmin()
  // calls lazily on its own first request, so calling it here up front means
  // that lazy path sees `pricingInitialized` already true and skips its own
  // (previously duplicate) reload.
  initAdmin({ state, db, auth, notifier, log });

  consoleBuffer.push("INFO", "aigloo gateway initialized");

  return { state, db, auth, notifier, limiter, log };
}

export function gw(): Gw {
  if (!globalThis.__aigloo_gw) {
    try {
      globalThis.__aigloo_gw = init();
    } catch (e) {
      console.error("[gw] init FAILED:", e);
      throw e;
    }
  }
  return globalThis.__aigloo_gw;
}
