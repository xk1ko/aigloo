/**
 * Windows tray via PowerShell NotifyIcon (AV-safe, zero native deps).
 *
 * Writes tray.ps1 + icon.ico to the data dir at startup, then invokes
 * PowerShell with -File (not -Command). -Command with inline base64 is
 * fragile (quoting, escaping, command-line length limits on Windows).
 *
 * IPC: stdin JSON commands → stdout JSON events.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDataDir } from "../../appDirs.js";
import { TRAY_ICON_ICO_BASE64 } from "./icon.js";

interface WinTrayConfig {
  tooltip: string;
  items: Array<{ title: string; tooltip: string; enabled: boolean }>;
  onClick: (index: number) => void;
}

interface WinTrayHandle {
  kill(): void;
  updateItem(i: number, title: string, enabled: boolean): void;
  setTooltip(text: string): void;
}

/** PowerShell script — written to disk so we can use -File (not -Command). */
const PS_SCRIPT = `# aigloo tray icon for Windows using NotifyIcon
# IPC: stdin JSON commands, stdout JSON events
param([string]$IconPath, [string]$Tooltip)

$ErrorActionPreference = "Stop"

Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class WinDpiAwareness {
  public static IntPtr PerMonitorAwareV2 { get { return new IntPtr(-4); } }
  public static IntPtr PerMonitorAware { get { return new IntPtr(-3); } }

  [DllImport("user32.dll")]
  public static extern bool SetProcessDpiAwarenessContext(IntPtr value);

  [DllImport("user32.dll")]
  public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);

  [DllImport("shcore.dll")]
  public static extern int SetProcessDpiAwareness(int value);

  [DllImport("user32.dll")]
  public static extern bool SetProcessDPIAware();
}
"@

function Enable-HighDpiAwareness {
  $contexts = @([WinDpiAwareness]::PerMonitorAwareV2, [WinDpiAwareness]::PerMonitorAware)
  foreach ($context in $contexts) {
    try { if ([WinDpiAwareness]::SetProcessDpiAwarenessContext($context)) { break } } catch {}
  }
  try { [WinDpiAwareness]::SetProcessDpiAwareness(2) | Out-Null } catch {}
  try { [WinDpiAwareness]::SetProcessDPIAware() | Out-Null } catch {}
  foreach ($context in $contexts) {
    try { $previous = [WinDpiAwareness]::SetThreadDpiAwarenessContext($context); if ($previous -ne [IntPtr]::Zero) { break } } catch {}
  }
}

Enable-HighDpiAwareness

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

[System.Windows.Forms.Application]::EnableVisualStyles()
[System.Windows.Forms.Application]::SetCompatibleTextRenderingDefault($false)

$script:notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$script:notifyIcon.Icon = New-Object System.Drawing.Icon($IconPath)
$script:notifyIcon.Text = $Tooltip
$script:notifyIcon.Visible = $true

$script:menu = New-Object System.Windows.Forms.ContextMenuStrip
$script:notifyIcon.ContextMenuStrip = $script:menu
$script:items = @()

function Write-Event($obj) {
  $json = $obj | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($json)
  [Console]::Out.Flush()
}

function Add-MenuItem($index, $title, $enabled) {
  $item = New-Object System.Windows.Forms.ToolStripMenuItem
  $item.Text = $title
  $item.Enabled = $enabled
  $idx = $index
  $item.Add_Click({ Write-Event @{ type = "click"; index = $idx } }.GetNewClosure())
  $script:menu.Items.Add($item) | Out-Null
  $script:items += $item
}

function Update-MenuItem($index, $title, $enabled) {
  if ($index -lt $script:items.Count) {
    $script:items[$index].Text = $title
    $script:items[$index].Enabled = $enabled
  }
}

function Set-Tooltip($text) {
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $script:notifyIcon.Text = $text
}

$script:timer = New-Object System.Windows.Forms.Timer
$script:timer.Interval = 100
$script:timer.Add_Tick({
  try {
    while ([Console]::In.Peek() -ne -1) {
      $line = [Console]::In.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $cmd = $line | ConvertFrom-Json
      switch ($cmd.action) {
        "add-item"    { Add-MenuItem $cmd.index $cmd.title $cmd.enabled }
        "update-item" { Update-MenuItem $cmd.index $cmd.title $cmd.enabled }
        "set-tooltip" { Set-Tooltip $cmd.text }
        "kill"        { $script:notifyIcon.Visible = $false; $script:notifyIcon.Dispose(); [System.Windows.Forms.Application]::Exit() }
      }
    }
  } catch {
    Write-Event @{ type = "error"; message = $_.Exception.Message }
  }
})
$script:timer.Start()

Write-Event @{ type = "started" }
[System.Windows.Forms.Application]::Run()
`;

const TRAY_SCRIPT_VERSION = "2";

/** Write the .ps1 and .ico files to the data dir (overwrite if version changed). */
function ensureTrayFiles(): { scriptPath: string; iconPath: string } {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const scriptPath = join(dir, "tray.ps1");
  const iconPath = join(dir, "tray.ico");
  const versionPath = join(dir, "tray.ps1.ver");

  let needsWrite = true;
  try {
    const prev = readFileSync(versionPath, "utf8").trim();
    if (prev === TRAY_SCRIPT_VERSION && existsSync(scriptPath)) needsWrite = false;
  } catch {}

  if (needsWrite) {
    writeFileSync(scriptPath, PS_SCRIPT, "utf8");
    writeFileSync(versionPath, TRAY_SCRIPT_VERSION, "utf8");
  }
  if (!existsSync(iconPath)) {
    const icoBytes = Buffer.from(TRAY_ICON_ICO_BASE64, "base64");
    writeFileSync(iconPath, icoBytes);
  }

  return { scriptPath, iconPath };
}

export function initWinTray(cfg: WinTrayConfig): WinTrayHandle {
  const { scriptPath, iconPath } = ensureTrayFiles();

  const proc: ChildProcessWithoutNullStreams = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-WindowStyle", "Hidden",
      "-InputFormat", "Text",
      "-OutputFormat", "Text",
      "-File", scriptPath,
      "-IconPath", iconPath,
      "-Tooltip", cfg.tooltip,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );

  const ee = new EventEmitter();

  const rl = createInterface({ input: proc.stdout });
  rl.on("line", (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const evt = JSON.parse(trimmed);
      if (evt.type === "click") cfg.onClick(evt.index);
      else ee.emit(evt.type, evt);
    } catch { /* ignore non-JSON */ }
  });

  proc.stderr.on("data", (data: Buffer) => {
    process.stderr.write(`[tray-win] ${data}`);
  });

  proc.on("error", (err: Error) => {
    process.stderr.write(`[tray-win] spawn error: ${err.message}\n`);
  });

  proc.on("exit", (code: number | null) => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[tray-win] PowerShell exited with code ${code}\n`);
    }
  });

  function sendCommand(cmd: Record<string, unknown>): void {
    if (proc.stdin.writable) {
      proc.stdin.write(`${JSON.stringify(cmd)}\n`, "utf8");
    }
  }

  cfg.items.forEach((item, index) => {
    sendCommand({ action: "add-item", index, title: item.title, enabled: item.enabled });
  });

  return {
    kill() {
      try {
        sendCommand({ action: "kill" });
      } catch { /* gone */ }
      setTimeout(() => {
        try { proc.kill(); } catch { /* gone */ }
      }, 300);
    },
    updateItem(i: number, title: string, enabled: boolean) {
      sendCommand({ action: "update-item", index: i, title, enabled });
    },
    setTooltip(text: string) {
      sendCommand({ action: "set-tooltip", text });
    },
  };
}
