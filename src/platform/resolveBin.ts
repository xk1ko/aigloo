/**
 * Resolve executables on PATH without shelling out to `where` / `which`.
 * Avoids Windows console flashes (cmd.exe) when the dashboard probes tools.
 */
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const IS_WIN = process.platform === "win32";

/** Windows PATHEXT-style suffixes we try (order matters). */
const WIN_EXTS = [".exe", ".cmd", ".bat", ".ps1", ""];

export type ResolveBinOptions = {
  /** Prepended before process.env.PATH segments. */
  extraDirs?: string[];
  /** Override PATH (defaults to process.env.PATH). */
  pathEnv?: string;
  /** Clear process-level cache (tests). */
  noCache?: boolean;
};

const pathCache = new Map<string, string | null>();

function cacheKey(bin: string, extraDirs: string[] | undefined, pathEnv: string | undefined): string {
  return `${bin}\0${(extraDirs ?? []).join("|")}\0${pathEnv ?? process.env.PATH ?? ""}`;
}

/** Directories often missing from a packaged / tray PATH. */
export function defaultExtraBinDirs(): string[] {
  if (IS_WIN) {
    const la = process.env.LOCALAPPDATA || "";
    const ad = process.env.APPDATA || "";
    return [
      join(ad, "npm"),
      join(la, "Programs", "Python", "Python313", "Scripts"),
      join(la, "Programs", "Python", "Python312", "Scripts"),
      join(la, "Programs", "Python", "Python311", "Scripts"),
      join(la, "Programs", "Python", "Python310", "Scripts"),
      join(ad, "Python", "Python313", "Scripts"),
      join(ad, "Python", "Python312", "Scripts"),
    ].filter((d) => d.length > 3);
  }
  const home = process.env.HOME || homedir();
  return [
    "/usr/local/bin",
    "/opt/homebrew/bin",
    join(home, ".local", "bin"),
    join(home, ".npm-global", "bin"),
    "/usr/bin",
    "/bin",
  ];
}

function pathDirs(extraDirs: string[] | undefined, pathEnv: string | undefined): string[] {
  const envPath = pathEnv ?? process.env.PATH ?? "";
  const fromEnv = envPath.split(delimiter).filter(Boolean);
  const extra = (extraDirs ?? defaultExtraBinDirs()).filter(Boolean);
  // Preserve order, de-dupe
  const seen = new Set<string>();
  const out: string[] = [];
  for (const d of [...extra, ...fromEnv]) {
    const n = d.trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function nameVariants(bin: string): string[] {
  // Already has an extension → only try as-is
  if (IS_WIN && /\.(exe|cmd|bat|ps1|com)$/i.test(bin)) return [bin];
  if (!IS_WIN) return [bin];
  return WIN_EXTS.map((ext) => (ext ? `${bin}${ext}` : bin));
}

function isUsableFile(p: string): boolean {
  try {
    if (!existsSync(p)) return false;
    const st = statSync(p);
    if (!st.isFile() && !st.isSymbolicLink()) {
      // On Windows, .cmd files are files; on Unix allow symlink to binary
      if (!st.isFile()) return false;
    }
    if (!IS_WIN) {
      try {
        accessSync(p, constants.X_OK);
      } catch {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `bin` to an absolute path by walking extra dirs + PATH.
 * Never spawns a shell. Returns null if not found.
 */
export function resolveOnPath(bin: string, opts: ResolveBinOptions = {}): string | null {
  if (!bin || bin.includes("/") || bin.includes("\\")) {
    // Absolute/relative path given — just validate
    return isUsableFile(bin) ? bin : null;
  }

  const key = cacheKey(bin, opts.extraDirs, opts.pathEnv);
  if (!opts.noCache && pathCache.has(key)) return pathCache.get(key) ?? null;

  const variants = nameVariants(bin);
  let found: string | null = null;

  for (const dir of pathDirs(opts.extraDirs, opts.pathEnv)) {
    for (const name of variants) {
      const candidate = join(dir, name);
      if (isUsableFile(candidate)) {
        found = candidate;
        break;
      }
    }
    if (found) break;
  }

  if (!opts.noCache) pathCache.set(key, found);
  return found;
}

/** True if `bin` is on PATH (or extra dirs) without shelling out. */
export function isOnPath(bin: string, opts: ResolveBinOptions = {}): boolean {
  return resolveOnPath(bin, opts) !== null;
}

/** Clear resolve cache (unit tests). */
export function clearResolveBinCache(): void {
  pathCache.clear();
  pythonCache.clear();
}

// ── Python (≥ min version) ──────────────────────────────────────────────────

const PYTHON_NAMES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const pythonCache = new Map<string, string | null>();

function knownPythonDirs(): string[] {
  if (!IS_WIN) {
    return [
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      join(process.env.HOME || homedir(), ".local", "bin"),
      "/usr/bin",
    ];
  }
  const la = process.env.LOCALAPPDATA || "";
  const ad = process.env.APPDATA || "";
  return [
    join(la, "Programs", "Python", "Python313"),
    join(la, "Programs", "Python", "Python312"),
    join(la, "Programs", "Python", "Python311"),
    join(la, "Programs", "Python", "Python310"),
    join(ad, "Python", "Python313"),
    join(ad, "Python", "Python312"),
  ];
}

function parsePythonVersion(text: string): [number, number] | null {
  const m = text.match(/(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10)];
}

function meetsMin(ver: [number, number], min: [number, number]): boolean {
  return ver[0] > min[0] || (ver[0] === min[0] && ver[1] >= min[1]);
}

/**
 * Read interpreter version via execFile (no shell). Returns null on failure.
 */
export function pythonVersionOf(pythonPath: string): [number, number] | null {
  try {
    const out = execFileSync(pythonPath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      timeout: 3000,
    });
    // python prints to stderr on some builds
    return parsePythonVersion(String(out));
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string };
    const text = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    return parsePythonVersion(text);
  }
}

/**
 * Find a Python interpreter ≥ minVersion without using `where`/`which`.
 * Walks known install dirs + PATH; verifies with execFile --version only.
 */
export function resolvePython(minVersion: [number, number] = [3, 10], opts: ResolveBinOptions = {}): string | null {
  const key = `py:${minVersion.join(".")}\0${(opts.extraDirs ?? []).join("|")}\0${opts.pathEnv ?? process.env.PATH ?? ""}`;
  if (!opts.noCache && pythonCache.has(key)) return pythonCache.get(key) ?? null;

  const candidates: string[] = [];
  const push = (p: string | null) => {
    if (p && !candidates.includes(p)) candidates.push(p);
  };

  // 1) Full paths under known Python install roots
  for (const dir of knownPythonDirs()) {
    for (const name of PYTHON_NAMES) {
      for (const variant of nameVariants(name)) {
        const p = join(dir, variant);
        if (isUsableFile(p)) push(p);
      }
    }
  }

  // 2) PATH / extra (Scripts dirs often hold headroom, not always python.exe)
  for (const name of PYTHON_NAMES) {
    push(resolveOnPath(name, { ...opts, noCache: opts.noCache }));
  }

  let found: string | null = null;
  for (const c of candidates) {
    if (!c) continue;
    const ver = pythonVersionOf(c);
    if (ver && meetsMin(ver, minVersion)) {
      found = c;
      break;
    }
  }

  if (!opts.noCache) pythonCache.set(key, found);
  return found;
}
