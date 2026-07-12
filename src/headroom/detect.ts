/**
 * Headroom CLI detection. "Headroom" is an external context-compression proxy
 * (a Python tool, `headroom proxy`, default http://localhost:8787) that aigloo
 * pipes request messages through. This module only DETECTS it — install, python
 * interpreter, and whether a proxy is already reachable.
 *
 * Binary lookup uses no-shell PATH walking (see platform/resolveBin) so Windows
 * does not flash a console via `where` / `which`.
 */
import { defaultExtraBinDirs, resolveOnPath, resolvePython } from "../platform/resolveBin.js";

const MIN_VERSION: [number, number] = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

export interface HeadroomStatus {
  installed: boolean;
  path: string | null;
  running: boolean;
  python: string | null;
  localUrl: boolean;
  canStart: boolean;
}

/** Locate the `headroom` binary, or null if not installed. */
export function findHeadroomBinary(): string | null {
  return resolveOnPath("headroom", { extraDirs: defaultExtraBinDirs() });
}

/** Find a Python interpreter >= 3.10 (headroom-ai requires it), or null. */
export function findPython310(): string | null {
  return resolvePython(MIN_VERSION, { extraDirs: defaultExtraBinDirs() });
}

/** Probe a Headroom proxy's /health. */
export async function probeProxyRunning(url: string): Promise<boolean> {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

/** Aggregate status for the dashboard: installed, running, python interpreter. */
export async function getHeadroomStatus(url: string): Promise<HeadroomStatus> {
  const path = findHeadroomBinary();
  const python = findPython310();
  const installed = Boolean(path);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  return { installed, path, running, python, localUrl, canStart: installed && localUrl };
}
