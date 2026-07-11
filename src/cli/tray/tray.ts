/**
 * System tray icon. macOS/Linux use the lazy-installed `systray2` Go binary;
 * Windows uses a PowerShell NotifyIcon (see trayWin). Menu: status · Open
 * Dashboard · Auto-start toggle · Quit. The launcher owns the gateway +
 * dashboard child processes, so Quit tears those down too.
 */
import { exec } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { getRuntimeNodeModules } from "./trayRuntime.js";
import { TRAY_ICON_PNG_BASE64 } from "./icon.js";
import { isAutoStartEnabled, enableAutoStart, disableAutoStart } from "./autostart.js";

export interface TrayOptions {
  dashboardUrl: string;
  port: number;
  onQuit: () => void;
}

interface SysTrayInstance {
  onClick(cb: (action: { seq_id: number }) => void): void;
  sendAction(action: unknown): void;
  ready?: () => Promise<void>;
  onReady?: (cb: () => void) => void;
  onError?: (cb: () => void) => void;
  kill(graceful?: boolean): void;
}

const MENU = { STATUS: 0, DASHBOARD: 1, AUTOSTART: 2, QUIT: 3 };
let tray: SysTrayInstance | null = null;
let winTray: { kill(): void; updateItem(i: number, t: string, e: boolean): void; setTooltip(text: string): void } | null = null;

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? `open "${url}"` : process.platform === "win32" ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

function isTraySupported(): boolean {
  if (!["darwin", "win32", "linux"].includes(process.platform)) return false;
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  return true;
}

function menuItems(autostart: boolean): Array<{ title: string; tooltip: string; enabled: boolean }> {
  return [
    { title: `aigloo (port ${0})`, tooltip: "gateway + dashboard running", enabled: false },
    { title: "Open Dashboard", tooltip: "open the console in your browser", enabled: true },
    { title: autostart ? "✓ Auto-start enabled" : "Enable auto-start", tooltip: "run on OS startup", enabled: true },
    { title: "Quit", tooltip: "stop the gateway + dashboard and exit", enabled: true },
  ];
}

function handleClick(index: number, opts: TrayOptions, onToggle: (enabled: boolean) => void): void {
  if (index === MENU.DASHBOARD) {
    openBrowser(opts.dashboardUrl);
  } else if (index === MENU.AUTOSTART) {
    const enabled = isAutoStartEnabled();
    if (enabled) disableAutoStart();
    else enableAutoStart();
    onToggle(!enabled);
  } else if (index === MENU.QUIT) {
    opts.onQuit();
    void killTray();
    setTimeout(() => process.exit(0), 400);
  }
}

/** Show the tray icon. Returns true if it started, false if unsupported/failed. */
export function initTray(opts: TrayOptions): boolean {
  if (!isTraySupported()) return false;
  if (process.platform === "win32") return initWindowsTray(opts);
  return initUnixTray(opts);
}

function initUnixTray(opts: TrayOptions): boolean {
  try {
    const require = createRequire(import.meta.url);
    let SysTray: new (cfg: unknown) => SysTrayInstance;
    try {
      SysTray = require(join(getRuntimeNodeModules(), "systray2")).default;
    } catch {
      SysTray = require("systray2").default; // fallback to a local install
    }
    const autostart = isAutoStartEnabled();
    const items = menuItems(autostart).map((it, i) =>
      i === MENU.STATUS ? { ...it, title: `aigloo (port ${opts.port})` } : it,
    );
    tray = new SysTray({
      menu: {
        icon: TRAY_ICON_PNG_BASE64,
        isTemplateIcon: false,
        title: "",
        tooltip: `aigloo — port ${opts.port}`,
        items,
      },
      debug: false,
      copyDir: true,
    });
    tray.onClick((action) => {
      handleClick(action.seq_id, opts, (enabled) => {
        tray?.sendAction({
          type: "update-item",
          item: { title: enabled ? "✓ Auto-start enabled" : "Enable auto-start", tooltip: "run on OS startup", enabled: true },
          seq_id: MENU.AUTOSTART,
        });
      });
    });
    tray.ready?.().catch((e: unknown) =>
      process.stderr.write(`  tray failed to start: ${(e as Error)?.message ?? e}\n`),
    );
    return true;
  } catch (e) {
    process.stderr.write(`  tray init error: ${(e as Error).message}\n`);
    return false;
  }
}

function initWindowsTray(opts: TrayOptions): boolean {
  try {
    const require = createRequire(import.meta.url);
    const { initWinTray } = require("./trayWin.js") as {
      initWinTray: (cfg: unknown) => { kill(): void; updateItem(i: number, t: string, e: boolean): void; setTooltip(text: string): void };
    };
    const autostart = isAutoStartEnabled();
    winTray = initWinTray({
      tooltip: `aigloo - port ${opts.port}`,
      items: menuItems(autostart).map((it, i) =>
        i === MENU.STATUS ? { ...it, title: `aigloo (port ${opts.port})` } : it,
      ),
      onClick: (index: number) =>
        handleClick(index, opts, (enabled) =>
          winTray?.updateItem(MENU.AUTOSTART, enabled ? "✓ Auto-start enabled" : "Enable auto-start", true),
        ),
    });
    return true;
  } catch {
    return false;
  }
}

/** Tear down the tray icon (graceful so macOS releases the menubar item). */
export function killTray(): Promise<void> {
  if (winTray) {
    try { winTray.kill(); } catch { /* gone */ }
    winTray = null;
    return Promise.resolve();
  }
  const inst = tray;
  tray = null;
  if (!inst) return Promise.resolve();
  try { inst.kill(true); } catch { /* gone */ }
  try { inst.kill(false); } catch { /* gone */ }
  return Promise.resolve();
}
