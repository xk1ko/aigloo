import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
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

const PS_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$iconBytes = [System.Convert]::FromBase64String("${TRAY_ICON_ICO_BASE64}")
$ms = New-Object System.IO.MemoryStream(,$iconBytes)
$ni = New-Object System.Windows.Forms.NotifyIcon
$ni.Icon = New-Object System.Drawing.Icon($ms)
$ni.Visible = $true
$menu = New-Object System.Windows.Forms.ContextMenuStrip
$ni.ContextMenuStrip = $menu
$items = @()

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
  $menu.Items.Add($item) | Out-Null
  $items += $item
}

function Update-MenuItem($index, $title, $enabled) {
  if ($index -lt $items.Count) {
    $items[$index].Text = $title
    $items[$index].Enabled = $enabled
  }
}

function Set-Tooltip($text) {
  if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
  $ni.Text = $text
}

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 100
$timer.Add_Tick({
  try {
    while ([Console]::In.Peek() -ne -1) {
      $line = [Console]::In.ReadLine()
      if ([string]::IsNullOrWhiteSpace($line)) { continue }
      $cmd = $line | ConvertFrom-Json
      switch ($cmd.action) {
        "add-item"    { Add-MenuItem $cmd.index $cmd.title $cmd.enabled }
        "update-item" { Update-MenuItem $cmd.index $cmd.title $cmd.enabled }
        "set-tooltip" { Set-Tooltip $cmd.text }
        "kill"        { $ni.Visible = $false; $ni.Dispose(); [System.Windows.Forms.Application]::Exit() }
      }
    }
  } catch {
    Write-Event @{ type = "error"; message = $_.Exception.Message }
  }
})
$timer.Start()

Write-Event @{ type = "started" }
[System.Windows.Forms.Application]::Run()
`;

export function initWinTray(cfg: WinTrayConfig): WinTrayHandle {
  const tooltip = cfg.tooltip.replace(/"/g, '`"');

  const proc: ChildProcessWithoutNullStreams = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-InputFormat", "Text", "-OutputFormat", "Text", "-Command", PS_SCRIPT],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );

  const ee = new EventEmitter();

  let buffer = "";
  proc.stdout.on("data", (data: Buffer) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        if (evt.type === "click") cfg.onClick(evt.index);
        else ee.emit(evt.type, evt);
      } catch { /* ignore non-JSON */ }
    }
  });

  proc.stderr.on("data", (data: Buffer) => {
    process.stderr.write(`[tray-win] ${data}`);
  });

  proc.on("error", () => { /* gone */ });

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
