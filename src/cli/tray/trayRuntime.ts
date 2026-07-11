/**
 * Lazy-install the system-tray runtime (`systray2`) into a user data dir rather
 * than the published npm tarball. systray2 ships a small Go binary; keeping it
 * out of the tarball avoids antivirus false positives (e.g. Kaspersky) and
 * per-arch packaging in the published package.
 *
 * macOS/Linux: install systray2 into ~/.aigloo/runtime/node_modules.
 * Windows: no binary — a PowerShell NotifyIcon is used instead (see trayWin).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SYSTRAY_PKG = "systray2";
const SYSTRAY_VERSION = "2.1.4";

/** ~/.aigloo (or %APPDATA%/aigloo on Windows) — holds the tray runtime. */
export function getRuntimeDir(): string {
  const base =
    process.platform === "win32"
      ? process.env.APPDATA || homedir()
      : homedir();
  return join(base, process.platform === "win32" ? "aigloo" : ".aigloo", "runtime");
}

export function getRuntimeNodeModules(): string {
  return join(getRuntimeDir(), "node_modules");
}

function trayBinName(): string | null {
  if (process.platform === "darwin") return "tray_darwin_release";
  if (process.platform === "linux") return "tray_linux_release";
  return null; // windows uses powershell, no binary
}

/** systray2's tarball sometimes drops the +x bit on the Go binary → EACCES. */
function chmodTrayBin(): void {
  const bin = trayBinName();
  if (!bin) return;
  const p = join(getRuntimeNodeModules(), SYSTRAY_PKG, "traybin", bin);
  try {
    if (existsSync(p)) chmodSync(p, 0o755);
  } catch {
    /* best-effort */
  }
}

export function hasSystray(): boolean {
  return existsSync(join(getRuntimeNodeModules(), SYSTRAY_PKG, "package.json"));
}

function ensureRuntimeDir(): string {
  const dir = getRuntimeDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const pkg = join(dir, "package.json");
  if (!existsSync(pkg)) {
    writeFileSync(pkg, JSON.stringify({ name: "aigloo-runtime", version: "1.0.0", private: true }, null, 2));
  }
  return dir;
}

/**
 * Make sure systray2 is installed (Windows skips — PowerShell needs no binary).
 * Returns true if the tray runtime is ready. Best-effort: install failure just
 * disables the tray, never crashes the launcher.
 */
export function ensureTrayRuntime({ silent = false } = {}): boolean {
  if (process.platform === "win32") return true;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    return false; // no GUI session — a tray icon has nowhere to live
  }
  if (hasSystray()) {
    chmodTrayBin();
    return true;
  }
  const cwd = ensureRuntimeDir();
  if (!silent) console.log("  installing system tray (first run)…");
  const res = spawnSync("npm", ["install", `${SYSTRAY_PKG}@${SYSTRAY_VERSION}`, "--no-audit", "--no-fund"], {
    cwd,
    stdio: silent ? "ignore" : "inherit",
    timeout: 120_000,
  });
  if (res.status !== 0) {
    if (!silent) console.warn("  system tray install failed — tray disabled (everything else works).");
    return false;
  }
  chmodTrayBin();
  return hasSystray();
}
