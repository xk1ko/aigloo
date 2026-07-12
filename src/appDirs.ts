import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * User data directory — same on every OS:
 *   ~/.aigloo
 *   Windows: C:\Users\<name>\.aigloo
 *
 * Override with AIGLOO_DATA_DIR.
 *
 * Older Windows builds briefly used %APPDATA%\aigloo — if that folder still
 * has data and ~/.aigloo is empty, we migrate once so login/session don't
 * split across two homes (symptom: Connect succeeds then bounces back to /login).
 */
export function getDataDir(): string {
  const env = process.env.AIGLOO_DATA_DIR;
  if (env) return resolve(env);

  const dir = join(homedir(), ".aigloo");
  if (process.platform === "win32") {
    migrateFromAppDataIfNeeded(dir);
  }
  return dir;
}

export function getConfigPath(): string {
  const env = process.env.AIGLOO_CONFIG;
  return env ? resolve(env) : join(getDataDir(), "config.yaml");
}

function dirHasEntries(dir: string): boolean {
  try {
    return existsSync(dir) && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** One-time: %APPDATA%\aigloo → ~/.aigloo when home dir is empty. */
function migrateFromAppDataIfNeeded(homeDir: string): void {
  const appData = process.env.APPDATA;
  if (!appData) return;
  const legacy = join(appData, "aigloo");
  if (!dirHasEntries(legacy)) return;
  if (dirHasEntries(homeDir)) return; // already using ~/.aigloo

  try {
    mkdirSync(homeDir, { recursive: true });
    for (const name of readdirSync(legacy)) {
      const src = join(legacy, name);
      const dest = join(homeDir, name);
      if (existsSync(dest)) continue;
      const st = statSync(src);
      if (st.isFile()) {
        copyFileSync(src, dest);
      } else if (st.isDirectory()) {
        // Prefer rename for large runtime/ trees when same volume; else shallow copy.
        try {
          renameSync(src, dest);
        } catch {
          mkdirSync(dest, { recursive: true });
          for (const child of readdirSync(src)) {
            const csrc = join(src, child);
            const cdest = join(dest, child);
            if (!existsSync(cdest) && statSync(csrc).isFile()) copyFileSync(csrc, cdest);
          }
        }
      }
    }
    console.log(`  migrated data %APPDATA%\\aigloo → ${homeDir}`);
  } catch (e) {
    console.warn(`  could not migrate %APPDATA%\\aigloo → ${homeDir}:`, e);
  }
}
