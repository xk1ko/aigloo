/**
 * Run-on-OS-startup, toggled from the tray menu — registers the aigloo CLI to
 * launch with `--tray` at login.
 *
 *   macOS  → ~/Library/LaunchAgents/com.aigloo.autostart.plist (launchd)
 *   Windows→ %APPDATA%/.../Startup/aigloo.vbs
 *   Linux  → desktop session: ~/.config/autostart/aigloo.desktop (XDG)
 *            headless server:  a systemd service (system unit as root, else a
 *                              per-user unit + linger) so it starts on boot
 *                              without a graphical login.
 */
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const APP_NAME = "aigloo";
const APP_LABEL = "com.aigloo.autostart";
const SYSTEMD_UNIT = `${APP_NAME}.service`;
const SYSTEMD_SYSTEM_PATH = `/etc/systemd/system/${SYSTEMD_UNIT}`;
const here = dirname(fileURLToPath(import.meta.url));

/** Per-user systemd unit path (~/.config/systemd/user/aigloo.service). */
function systemdUserPath(): string {
  return join(homedir(), ".config", "systemd", "user", SYSTEMD_UNIT);
}
function xdgAutostartPath(): string {
  return join(homedir(), ".config", "autostart", `${APP_NAME}.desktop`);
}

/** Absolute path to the launcher script (dist/cli.js). */
function getCliPath(explicit?: string): string | null {
  if (explicit && existsSync(resolve(explicit))) return resolve(explicit);
  if (process.argv[1]) {
    const r = resolve(process.argv[1]);
    if (/cli\.(js|ts)$/.test(basename(r)) && existsSync(r)) return r;
  }
  // dist/cli/tray/autostart.js → up two → dist/cli.js
  const computed = resolve(here, "..", "..", "cli.js");
  return existsSync(computed) ? computed : null;
}

export function isAutoStartEnabled(): boolean {
  try {
    if (process.platform === "darwin") {
      const plist = join(homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
      return existsSync(plist);
    }
    if (process.platform === "win32") {
      return existsSync(join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`));
    }
    // Linux: desktop autostart entry OR a systemd unit (system or per-user).
    return existsSync(xdgAutostartPath()) || existsSync(SYSTEMD_SYSTEM_PATH) || existsSync(systemdUserPath());
  } catch {
    return false;
  }
}

export function enableAutoStart(cliPath?: string): boolean {
  const script = getCliPath(cliPath);
  if (!script) return false;
  const node = process.execPath;
  try {
    if (process.platform === "darwin") return enableMac(node, script);
    if (process.platform === "win32") return enableWin(node, script);
    return enableLinux(node, script);
  } catch {
    return false;
  }
}

export function disableAutoStart(): boolean {
  try {
    if (process.platform === "darwin") return disableMac();
    if (process.platform === "win32") return disableWin();
    return disableLinux();
  } catch {
    return false;
  }
}

// ── macOS ──
function enableMac(node: string, script: string): boolean {
  const dir = join(homedir(), "Library", "LaunchAgents");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const plistPath = join(dir, `${APP_LABEL}.plist`);
  const path = `${dirname(node)}:/usr/local/bin:/usr/bin:/bin`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${APP_LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${node}</string><string>${script}</string><string>--tray</string><string>--skip-update</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${path}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict></plist>`;
  writeFileSync(plistPath, plist);
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* not loaded */ }
  try { execSync(`launchctl load -w "${plistPath}"`, { stdio: "ignore" }); } catch { /* picked up next login */ }
  return true;
}
function disableMac(): boolean {
  const plistPath = join(homedir(), "Library", "LaunchAgents", `${APP_LABEL}.plist`);
  try { execSync(`launchctl unload "${plistPath}"`, { stdio: "ignore" }); } catch { /* not loaded */ }
  if (existsSync(plistPath)) unlinkSync(plistPath);
  return true;
}

// ── Windows ──
function enableWin(node: string, script: string): boolean {
  const dir = join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
  if (!existsSync(dir)) return false;
  const vbs = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${node}"" ""${script}"" --tray --skip-update", 0, False\n`;
  writeFileSync(join(dir, `${APP_NAME}.vbs`), vbs);
  return true;
}
function disableWin(): boolean {
  const vbs = join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", `${APP_NAME}.vbs`);
  if (existsSync(vbs)) unlinkSync(vbs);
  return true;
}

// ── Linux ──
/** A graphical session where XDG autostart (~/.config/autostart) actually fires. */
function isDesktopSession(): boolean {
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
function hasSystemd(): boolean {
  try { execSync("systemctl --version", { stdio: "ignore" }); return true; } catch { return false; }
}
function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}
function currentUser(): string {
  try { return userInfo().username; } catch { return process.env.USER || "root"; }
}

function enableLinux(node: string, script: string): boolean {
  // Desktop → hook into the session's autostart (fires on graphical login).
  if (isDesktopSession()) return enableLinuxXdg(node, script);
  // Headless server → install a systemd service so it starts on boot.
  if (hasSystemd()) return enableLinuxSystemd(node, script);
  return false;
}
function disableLinux(): boolean {
  // Remove whichever mechanism(s) were registered; never stop the running
  // instance (this call is serving the toggle request itself).
  if (existsSync(xdgAutostartPath())) unlinkSync(xdgAutostartPath());
  if (existsSync(SYSTEMD_SYSTEM_PATH)) {
    try { execSync(`systemctl disable ${SYSTEMD_UNIT}`, { stdio: "ignore" }); } catch { /* leftover symlink is harmless */ }
    unlinkSync(SYSTEMD_SYSTEM_PATH);
    try { execSync("systemctl daemon-reload", { stdio: "ignore" }); } catch { /* best effort */ }
  }
  if (existsSync(systemdUserPath())) {
    try { execSync(`systemctl --user disable ${SYSTEMD_UNIT}`, { stdio: "ignore" }); } catch { /* leftover symlink is harmless */ }
    unlinkSync(systemdUserPath());
    try { execSync("systemctl --user daemon-reload", { stdio: "ignore" }); } catch { /* best effort */ }
  }
  return true;
}

function enableLinuxXdg(node: string, script: string): boolean {
  const dir = join(homedir(), ".config", "autostart");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const desktop = `[Desktop Entry]
Type=Application
Name=aigloo
Comment=Personal AI gateway
Exec=${node} ${script} --tray --skip-update
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
`;
  writeFileSync(xdgAutostartPath(), desktop);
  return true;
}

/** systemd unit body. `user` set only for system units (per-user units already
 *  run as the logged-in user). */
function systemdUnit(node: string, script: string, wantedBy: string, user?: string): string {
  const userLine = user ? `User=${user}\n` : "";
  return `[Unit]
Description=aigloo — personal AI gateway
After=network.target

[Service]
Type=simple
${userLine}ExecStart=${node} ${script} --tray --skip-update
Restart=always

[Install]
WantedBy=${wantedBy}
`;
}

function enableLinuxSystemd(node: string, script: string): boolean {
  // We only register for boot — we don't `start` the unit, since aigloo is
  // already running (this very process); systemd takes over on the next boot.
  if (isRoot()) {
    writeFileSync(SYSTEMD_SYSTEM_PATH, systemdUnit(node, script, "multi-user.target", currentUser()));
    try { execSync("systemctl daemon-reload", { stdio: "ignore" }); } catch { /* best effort */ }
    try { execSync(`systemctl enable ${SYSTEMD_UNIT}`, { stdio: "ignore" }); } catch { /* symlinked on next boot */ }
    return true;
  }
  // Non-root: per-user unit + linger so it runs without an active login.
  const dir = dirname(systemdUserPath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(systemdUserPath(), systemdUnit(node, script, "default.target"));
  try { execSync("systemctl --user daemon-reload", { stdio: "ignore" }); } catch { /* best effort */ }
  try { execSync(`systemctl --user enable ${SYSTEMD_UNIT}`, { stdio: "ignore" }); } catch { /* enabled on next login */ }
  try { execSync(`loginctl enable-linger ${currentUser()}`, { stdio: "ignore" }); } catch { /* may need privileges */ }
  return true;
}
