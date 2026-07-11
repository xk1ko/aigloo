#!/usr/bin/env node
/**
 * `aigloo` launcher — one command brings up the whole stack:
 *   - the Next.js dashboard + gateway on one port (default 18080)
 *
 * Gateway logic (routing, translation, auth, budgets) runs inside Next.js
 * API routes — no separate Fastify process, no proxy hop. The standalone
 * build (`dashboard/.next/standalone/server.js`) serves everything.
 *
 * Ctrl-C tears down cleanly. An admin password and session secret are
 * generated if not already in the environment, and the browser is opened
 * once the server answers /health.
 *
 * Prefers a production build when present (dashboard/.next/standalone,
 * dist/), otherwise falls back to the tsx / Next dev flow for live reload.
 */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, copyFileSync, readFileSync, writeFileSync, mkdirSync, statSync, readlinkSync, appendFileSync } from "node:fs";
import { resolve, dirname, join, delimiter } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { ensureTrayRuntime } from "./cli/tray/trayRuntime.js";
import { initTray, killTray } from "./cli/tray/tray.js";
import { enableAutoStart } from "./cli/tray/autostart.js";
import { getDataDir, getConfigPath } from "./appDirs.js";
import { loadConfig } from "./config.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dashboardDir = join(root, "dashboard");
const pkgVersion = (() => { try { return JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? "0.0.0"; } catch { return "0.0.0"; } })();

const MAX_RESTARTS = 2;
const CRASH_LOG_LINES = 50;
let crashLog: string[] = [];
let serverStartTime = 0;
let restartCount = 0;

// ── CLI flags (aigloo-style): -p/--port, -n/--no-browser, -y/--yes, -h/--help ──
interface CliOpts {
  port?: number;
  noBrowser: boolean;
  yes: boolean;
  help: boolean;
  version: boolean;
  tray: boolean;
  skipUpdate: boolean;
}
function parseArgs(argv: string[]): CliOpts {
  const o: CliOpts = { noBrowser: false, yes: false, help: false, version: false, tray: false, skipUpdate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-p" || a === "--port") o.port = Number(argv[++i]);
    else if (a === "-n" || a === "--no-browser") o.noBrowser = true;
    else if (a === "-y" || a === "--yes") o.yes = true;
    else if (a === "-t" || a === "--tray") o.tray = true;
    else if (a === "--skip-update") o.skipUpdate = true;
    else if (a === "-v" || a === "--version") o.version = true;
    else if (a === "-h" || a === "--help") o.help = true;
  }
  return o;
}
const opts = parseArgs(process.argv.slice(2));

const HELP = `
  aigloo — personal AI gateway + dashboard

  Usage: aigloo [options]

  Options:
    -p, --port <n>    port for the gateway + dashboard, one URL (default 18080)
    -n, --no-browser  start without opening the browser (terminal logs only)
    -y, --yes         skip the interactive menu (just run; honors --no-browser)
    -t, --tray        run in the system tray (background, no terminal needed)
    -v, --version     print version and exit
    -h, --help        show this help

  With a TTY and no --yes, a menu lets you pick: Web UI / Terminal / Hide to Tray / Exit.
`;

const GATEWAY_PORT = opts.port ?? Number(process.env.AIGLOO_PORT ?? 18080);

const adminPassword = process.env.AIGLOO_ADMIN_PASSWORD ?? "123456";
const generatedPw = !process.env.AIGLOO_ADMIN_PASSWORD;

/**
 * The dashboard session cookie is signed+encrypted with SESSION_SECRET. A fresh
 * random secret each boot would invalidate every cookie on restart — the symptom
 * being "re-enter the password after a relaunch" — so persist a generated one to
 * the data dir (alongside auth.json) and reuse it. An explicit env var wins.
 */
function loadOrCreateSessionSecret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dataDir = getDataDir();
  const file = join(dataDir, "session-secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {
    // not created yet — fall through and generate.
  }
  const secret = randomBytes(24).toString("hex");
  try {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, secret, { mode: 0o600 });
  } catch {
    // unwritable data dir — fall back to an ephemeral secret (cookies won't
    // survive this boot, but the gateway still runs).
  }
  return secret;
}
const sessionSecret = loadOrCreateSessionSecret();

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

async function waitForGateway(
  url: string,
  timeoutMs = 20000,
  ready: (status: number) => boolean = (s) => s > 0,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      // default: any HTTP answer (even 401/503) means the port is up. A caller
      // can demand more — e.g. a non-5xx, to wait past a proxy's boot-time 502/500
      // while the upstream it fronts is still coming up.
      if (ready(res.status)) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const children: ChildProcess[] = [];

/**
 * Kill a child AND its descendants. npm/npx spawn grandchildren (next-server,
 * tsx→node); signalling only the direct child leaves those orphaned, holding
 * their ports and breaking the next run. Children are spawned detached (own
 * process group), so a negative-pid signal reaches the whole group.
 */
function killTree(c: ChildProcess, sig: NodeJS.Signals = "SIGTERM"): void {
  if (!c.pid || c.killed) return;
  try {
    process.kill(-c.pid, sig);
  } catch {
    try {
      c.kill(sig);
    } catch {
      // already gone
    }
  }
}

function shutdown(): void {
  void killTray();
  for (const c of children) killTree(c);
}

function pidOnPort(port: number): number | null {
  if (process.platform === "win32") {
    try {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8", windowsHide: true, timeout: 5000,
      });
      const line = out.split("\n").find((l) => l.includes("LISTENING"));
      if (line) {
        const pid = line.trim().split(/\s+/).pop();
        if (pid && /^\d+$/.test(pid)) return Number(pid);
      }
    } catch { /* port free */ }
    return null;
  }
  for (const probe of [
    `ss -ltnHp 'sport = :${port}' 2>/dev/null`,
    `lsof -ti tcp:${port} -sTCP:LISTEN 2>/dev/null`,
  ]) {
    try {
      const out = execSync(probe, { encoding: "utf8" });
      const m = out.match(/pid=(\d+)/) ?? out.match(/^\s*(\d+)\s*$/m);
      if (m) return Number(m[1]);
    } catch {
      // tool absent or nothing listening — try the next probe
    }
  }
  return null;
}

/**
 * Kill all stale aigloo processes (launcher + dashboard) by matching the
 * install root path in the command line. More thorough than port-based kill —
 * catches zombies not holding the port but still locking files/sqlite handles.
 * Never matches other apps (9router, etc.) — filter is the exact aigloo path.
 */
function killAllAppProcesses(): void {
  const rootLower = root.toLowerCase();
  const isOurs = (cmd: string) => cmd.includes(rootLower);
  const pids: number[] = [];
  const ownPid = process.pid;

  if (process.platform === "win32") {
    try {
      const out = execSync(
        `powershell -NoProfile -WindowStyle Hidden -Command "Get-WmiObject Win32_Process -Filter 'Name=\\"node.exe\\"' | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"`,
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
      );
      for (const line of out.split("\n").slice(1).filter((l) => l.trim())) {
        if (isOurs(line.toLowerCase())) {
          const m = line.match(/^"(\d+)"/);
          if (m && Number(m[1]) !== ownPid) pids.push(Number(m[1]));
        }
      }
    } catch { /* none found */ }
    for (const pid of pids) {
      try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore", windowsHide: true, timeout: 3000 }); } catch {}
    }
  } else {
    try {
      const out = execSync("ps -eo pid,command", { encoding: "utf8", timeout: 5000 });
      for (const line of out.split("\n")) {
        if (isOurs(line.toLowerCase())) {
          const m = line.trim().match(/^(\d+)/);
          if (m && Number(m[1]) !== ownPid) pids.push(Number(m[1]));
        }
      }
    } catch { /* none found */ }
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch {}
    }
  }
  if (pids.length) {
    console.log(`  killed ${pids.length} stale aigloo process(es).`);
  }
}

/**
 * Make sure `port` is free before we bind it. A leftover dev server (next/node/
 * tsx) from a previous run that died ungracefully is reaped automatically — the
 * zero-config promise is "just run", not "go hunt a stray pid". A port held by
 * something unrelated is left alone and surfaced as a clear error.
 */
async function ensurePortFree(port: number, envVar: string): Promise<void> {
  if (process.platform === "win32") {
    const pid = pidOnPort(port);
    if (!pid) return;
    console.log(`  port ${port} held by stale process (pid ${pid}) — killing it.`);
    try { execSync(`taskkill /F /T /PID ${pid}`, { stdio: "ignore" }); } catch {}
    await new Promise((r) => setTimeout(r, 500));
    return;
  }
  const pid = pidOnPort(port);
  if (!pid) return;

  let cmd = "";
  try {
    cmd = execSync(`ps -p ${pid} -o command= 2>/dev/null`, { encoding: "utf8" });
  } catch {
    // ps failed — fall through to the unknown-owner branch
  }

  // also check the process CWD — standalone server.js runs with a relative
  // path, so "aigloo" won't appear in the command string. Read /proc/PID/cwd
  // (Linux) to see if it's inside the aigloo package directory.
  let cwd = "";
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {}

  const isOurs = /aigloo/.test(cmd) || /aigloo/.test(cwd) || /\.(\/)?(dist\/(server|cli)\.js|dashboard\/\.next\/standalone\/server\.js)/.test(cmd);

  if (!isOurs) {
    console.error(
      `  port ${port} is in use by another process (pid ${pid}). free it or set ${envVar}.`,
    );
    process.exit(1);
  }

  console.log(`  port ${port} held by a stale dev server (pid ${pid}) — reaping it.`);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // already exiting
  }
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && pidOnPort(port)) {
    await new Promise((r) => setTimeout(r, 150));
  }
  if (pidOnPort(port)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone between checks
    }
  }
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

/** config.server.host, falling back to loopback (never wide-open) if config
 *  can't be read — ensureSetup() has already seeded it by the time this runs,
 *  so a failure here means something is actually wrong with config.yaml. */
function resolveHostname(): string {
  try {
    return loadConfig(getConfigPath()).server.host;
  } catch {
    return "127.0.0.1";
  }
}

/** node:sqlite requires --experimental-sqlite on Node ≥22.5; older Node doesn't
 *  recognise the flag at all and crashes with "bad option". Gate on version. */
function supportsExperimentalSqlite(): boolean {
  const parts = process.versions.node.split(".").map(Number);
  const maj = parts[0] ?? 0;
  const min = parts[1] ?? 0;
  return maj > 22 || (maj === 22 && min >= 5);
}

/** Write crash details to a log file so background/tray mode users can debug
 *  when there's no terminal to see stderr. */
function writeCrashLog(lines: string[]): void {
  try {
    const logFile = join(getDataDir(), "aigloo-crash.log");
    const ts = new Date().toISOString();
    appendFileSync(logFile, `\n[${ts}] aigloo dashboard crashed:\n${lines.join("\n")}\n`);
  } catch { /* unwritable data dir */ }
}

function spawnDashboard(): ChildProcess {
  const standaloneDir = join(dashboardDir, ".next", "standalone");
  const standaloneServer = join(standaloneDir, "server.js");

  const runtimeNodeModules = join(getDataDir(), "runtime", "node_modules");

  const env = {
    ...process.env,
    PORT: String(GATEWAY_PORT),
    HOSTNAME: resolveHostname(),
    AIGLOO_ADMIN_PASSWORD: adminPassword,
    AIGLOO_PORT: String(GATEWAY_PORT),
    AIGLOO_DATA_DIR: getDataDir(),
    AIGLOO_CONFIG: getConfigPath(),
    SESSION_SECRET: sessionSecret,
    AIGLOO_VERSION: pkgVersion,
  };

  // Node flags passed as direct spawn args (not NODE_OPTIONS — that's a string
  // and breaks on Windows paths with spaces like C:\Program Files\...).
  // --experimental-sqlite is only valid on Node ≥22.5; on older Node the flag
  // itself crashes the process with "bad option".
  const nodeFlags = [
    ...(supportsExperimentalSqlite() ? ["--experimental-sqlite"] : []),
    "--require", join(root, "net-preload.cjs"),
  ];

  if (existsSync(standaloneServer)) {
    const nodePath = [join(standaloneDir, "vendor"), runtimeNodeModules, process.env.NODE_PATH]
      .filter(Boolean).join(delimiter);
    return spawn("node", [...nodeFlags, standaloneServer], {
      cwd: standaloneDir,
      stdio: ["ignore", "inherit", "pipe"],
      detached: true,
      windowsHide: true,
      env: { ...env, NODE_PATH: nodePath },
    });
  }

  // Dev fallback: npm.cmd on Windows (npm is npm.cmd, needs shell to resolve).
  // Skip --require in NODE_OPTIONS — paths with spaces break NODE_OPTIONS
  // string parsing. The preload is only needed in production (real IP trust
  // header); dev mode runs on localhost anyway.
  const prod = existsSync(join(dashboardDir, ".next", "BUILD_ID"));
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const args = prod ? ["run", "start"] : ["run", "dev"];
  const nodePath = [runtimeNodeModules, process.env.NODE_PATH].filter(Boolean).join(delimiter);
  const devNodeOptions = [
    ...(supportsExperimentalSqlite() ? ["--experimental-sqlite"] : []),
    process.env.NODE_OPTIONS,
  ].filter(Boolean).join(" ");
  return spawn(npmCmd, args, {
    cwd: dashboardDir,
    stdio: ["ignore", "inherit", "pipe"],
    detached: true,
    windowsHide: true,
    shell: process.platform === "win32",
    env: { ...env, NODE_PATH: nodePath, NODE_OPTIONS: devNodeOptions },
  });
}

function ensureBetterSqlite3(): void {
  const runtimeDir = join(getDataDir(), "runtime");
  const runtimeNodeModules = join(runtimeDir, "node_modules");
  const marker = join(runtimeNodeModules, "better-sqlite3", "package.json");

  const req = createRequire(import.meta.url);
  try { req("better-sqlite3"); return; } catch {}
  if (existsSync(marker)) return;

  mkdirSync(runtimeDir, { recursive: true });
  if (!existsSync(join(runtimeDir, "package.json"))) {
    writeFileSync(join(runtimeDir, "package.json"), JSON.stringify({ name: "aigloo-runtime", version: "1.0.0", private: true }, null, 2));
  }
  console.log("  installing better-sqlite3 (fastest SQLite driver)…");
  try {
    execSync("npm install better-sqlite3 --no-audit --no-fund --prefer-online", {
      cwd: runtimeDir, stdio: "pipe", timeout: 60_000,
    });
  } catch {
    // no build tools / no network — node:sqlite or sql.js will be used at runtime
  }
}

/**
 * One-time bootstrap so a fresh `npm i -g aigloo` runs with a single command.
 * Seeds a working config from the example, installs the dashboard's own deps
 * (npm doesn't install nested package node_modules for us), and builds the
 * dashboard if the published .next is absent. Each step is skipped once done, so
 * normal runs pay nothing.
 */
function ensureSetup(): void {
  const configPath = getConfigPath();
  const dataDir = getDataDir();
  mkdirSync(dataDir, { recursive: true });

  // migrate: copy old config + auth from inside the npm package dir on first run
  if (!existsSync(configPath)) {
    const oldConfig = join(root, "config.yaml");
    const src = existsSync(oldConfig) ? oldConfig : join(root, "config.example.yaml");
    if (existsSync(src)) {
      copyFileSync(src, configPath);
      if (existsSync(oldConfig)) {
        console.log(`  migrated config.yaml → ${configPath}`);
      } else {
        console.log("  seeded config.yaml — add providers via the dashboard or edit it directly.");
      }
    }
  }
  // migrate auth.json + session-secret + usage.sqlite from old data/ dir if present
  for (const f of ["auth.json", "session-secret", "usage.sqlite"]) {
    const dest = join(dataDir, f);
    const old = join(root, "data", f);
    if (!existsSync(old)) continue;
    const shouldCopy = !existsSync(dest)
      || (f === "usage.sqlite" && statSync(dest).size < 8192 && statSync(old).size > statSync(dest).size);
    if (shouldCopy) {
      copyFileSync(old, dest);
      if (f === "usage.sqlite") console.log(`  migrated usage data → ${dest}`);
    }
  }

  if (!existsSync(join(root, "node_modules"))) {
    console.log("  installing gateway dependencies (first run)…");
    execSync("npm install --omit=dev --no-fund --no-audit", { cwd: root, stdio: "inherit" });
  }
  if (existsSync(join(dashboardDir, "package.json"))) {
    const hasStandalone = existsSync(join(dashboardDir, ".next", "standalone", "server.js"));
    if (!hasStandalone && !existsSync(join(dashboardDir, "node_modules"))) {
      console.log("  installing dashboard dependencies (first run)…");
      execSync("npm install --no-fund --no-audit", { cwd: dashboardDir, stdio: "inherit" });
    }
    if (!hasStandalone && !existsSync(join(dashboardDir, ".next", "BUILD_ID"))) {
      console.log("  building dashboard (first run)…");
      execSync("npm run build", { cwd: dashboardDir, stdio: "inherit" });
    }
  }

  ensureBetterSqlite3();
}

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

/**
 * aigloo-style launch menu. With a TTY (and no --yes), let the operator pick
 * how to run; otherwise honor the flags. "web" opens the browser, "terminal"
 * runs with live logs only, "exit" quits before starting anything.
 */
async function chooseMode(): Promise<"web" | "terminal" | "hide" | "exit"> {
  if (opts.yes || !process.stdin.isTTY) return opts.noBrowser ? "terminal" : "web";
  console.log(
    "\n  aigloo\n\n" +
      "  [1] Web UI        start + open the dashboard in your browser\n" +
      "  [2] Terminal      start with live logs only (no browser)\n" +
      "  [3] Hide to Tray  run in the background with a tray icon\n" +
      "  [4] Exit\n",
  );
  const c = (await prompt("  choose [1]: ")).trim().toLowerCase();
  if (c === "4" || c === "exit" || c === "q") return "exit";
  if (c === "3" || c === "hide" || c === "tray") return "hide";
  if (c === "2" || c === "terminal") return "terminal";
  return "web"; // default on Enter
}

/**
 * "Hide to Tray": re-launch ourselves detached with --tray (which runs the stack
 * + tray icon and survives the terminal closing), then exit so the background
 * copy claims the ports. Also enables run-on-startup, matching aigloo.
 */
function hideToTray(): void {
  try { enableAutoStart(); } catch { /* optional */ }
  console.log("\n  starting background process… (tray icon appears in a few seconds)");
  const thisFile = fileURLToPath(import.meta.url);
  // dev mode: thisFile is a .ts source — Node can't run it; use tsx instead.
  const [cmd, args] = thisFile.endsWith(".ts")
    ? [process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", thisFile, "--tray"]]
    : [process.execPath, [thisFile, "--tray"]];
  const bg = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: process.platform === "win32" && thisFile.endsWith(".ts"),
    env: {
      ...process.env,
      AIGLOO_ADMIN_PASSWORD: adminPassword,
      SESSION_SECRET: sessionSecret,
      AIGLOO_DATA_DIR: getDataDir(),
      AIGLOO_CONFIG: getConfigPath(),
    },
  });
  bg.unref();
  console.log(`  aigloo now running in the background (pid ${bg.pid}).`);
  console.log(`  dashboard: http://localhost:${GATEWAY_PORT}`);
  console.log("  right-click the tray icon → Open Dashboard / Quit, or open the URL above. You can close this terminal.\n");
}

async function main(): Promise<void> {
  if (opts.version) {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
    console.log(pkg.version);
    return;
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // background tray process: skip the menu, never open a browser, show the tray.
  const mode = opts.tray ? "tray" : await chooseMode();
  if (mode === "exit") return;

  // Run setup in the foreground (with visible output) so the background process
  // inherits a ready environment — no silent multi-minute npm build in the dark.
  if (mode !== "tray") ensureSetup();

  if (mode === "hide") {
    // Pre-install the tray runtime while we still have a terminal to show progress.
    ensureTrayRuntime();
    hideToTray();
    return;
  }
  const wantBrowser = mode === "web";

  console.log("\n  aigloo — starting\n");

  if (mode === "tray") ensureSetup();

  if (!existsSync(join(dashboardDir, "package.json"))) {
    console.error("  dashboard not found (dashboard/ not scaffolded). cannot start.");
    process.exit(1);
  }

  killAllAppProcesses();
  await ensurePortFree(GATEWAY_PORT, "AIGLOO_PORT");

  let dash = spawnDashboard();
  serverStartTime = Date.now();
  children.push(dash);

  let isShuttingDown = false;

  function attachCrashHandlers(): void {
    if (dash.stderr) {
      dash.stderr.on("data", (data: Buffer) => {
        const lines = data.toString().split("\n").filter(Boolean);
        crashLog.push(...lines);
        if (crashLog.length > CRASH_LOG_LINES) crashLog = crashLog.slice(-CRASH_LOG_LINES);
        process.stderr.write(data);
      });
    }
    dash.on("error", (err: Error) => {
      const msg = `spawn error: ${err.message}`;
      crashLog.push(msg);
      writeCrashLog([msg]);
      console.error(`\n  ${msg}`);
      if (!isShuttingDown) {
        const delay = Math.min(1000 * (restartCount + 1), 5000);
        restartCount++;
        setTimeout(() => {
          dash = spawnDashboard();
          serverStartTime = Date.now();
          children.length = 0;
          children.push(dash);
          attachCrashHandlers();
        }, delay);
      }
    });
    dash.on("exit", (code) => {
      if (isShuttingDown || code === 0) {
        process.exit(code ?? 0);
        return;
      }
      const aliveMs = Date.now() - serverStartTime;
      if (aliveMs >= 30000) restartCount = 0;
      if (restartCount >= MAX_RESTARTS) {
        console.error(`\n  aigloo crashed ${MAX_RESTARTS} times — resetting and retrying...`);
        if (crashLog.length) {
          writeCrashLog(crashLog);
          console.error("\n  --- crash log ---");
          crashLog.forEach((l) => console.error(`  ${l}`));
          console.error("  --- end crash log ---\n");
        }
        crashLog = [];
        restartCount = 0;
        setTimeout(() => {
          dash = spawnDashboard();
          serverStartTime = Date.now();
          children.length = 0;
          children.push(dash);
          attachCrashHandlers();
        }, 5000);
        return;
      }
      restartCount++;
      const delay = Math.min(1000 * restartCount, 5000);
      console.error(`\n  aigloo exited (code ${code}) — restarting in ${delay / 1000}s... (${restartCount}/${MAX_RESTARTS})`);
      if (crashLog.length) {
        writeCrashLog(crashLog);
        console.error("\n  --- crash log ---");
        crashLog.forEach((l) => console.error(`  ${l}`));
        console.error("  --- end crash log ---\n");
      }
      crashLog = [];
      setTimeout(() => {
        dash = spawnDashboard();
        serverStartTime = Date.now();
        children.length = 0;
        children.push(dash);
        attachCrashHandlers();
      }, delay);
    });
  }
  attachCrashHandlers();

  const appUrl = `http://localhost:${GATEWAY_PORT}`;

  // Tray mode: init the tray icon BEFORE waiting for the dashboard so the
  // user always has a visible icon + a way to quit, even if the server
  // crashes on boot. 9router inits tray after server-ready, but that means
  // no tray if the server fails — we do better.
  let trayInited = false;
  if (mode === "tray") {
    ensureTrayRuntime({ silent: false });
    trayInited = initTray({
      dashboardUrl: appUrl,
      port: GATEWAY_PORT,
      onQuit: () => { isShuttingDown = true; shutdown(); },
    });
  }

  const ready = await waitForGateway(`http://127.0.0.1:${GATEWAY_PORT}/health`, 30000, (s) => s > 0 && s < 500);
  if (!ready) {
    console.error(`\n  aigloo failed to start — dashboard did not respond within 30s.`);
    if (crashLog.length) {
      writeCrashLog(crashLog);
      console.error("\n  --- crash log ---");
      crashLog.forEach((l) => console.error(`  ${l}`));
      console.error("  --- end crash log ---\n");
    }
    if (trayInited) {
      // Keep the tray alive — crash handlers are still running and will
      // auto-restart the dashboard. User can Quit from the tray.
      console.error(`  crash log saved to ${join(getDataDir(), "aigloo-crash.log")}`);
      console.error("  tray is active — auto-restart will keep trying. Right-click tray → Quit to stop.");
      return;
    }
    console.error(`  check if port ${GATEWAY_PORT} is free, or set AIGLOO_PORT to a different port.`);
    isShuttingDown = true;
    shutdown();
    process.exit(1);
  }
  console.log(`\n  aigloo   ${appUrl}`);
  if (generatedPw) {
    console.log(`\n  admin password (generated): ${adminPassword}`);
    console.log("  set AIGLOO_ADMIN_PASSWORD to keep it stable across runs.\n");
  }
  if (trayInited) {
    console.log("\n  running in the system tray — right-click the icon for Open Dashboard / Quit.\n");
  } else if (wantBrowser) {
    openBrowser(appUrl);
  } else {
    console.log(`  (terminal mode — open ${appUrl} when you want the dashboard)\n`);
  }
}

main().catch((e) => {
  console.error(e);
  shutdown();
  process.exit(1);
});
