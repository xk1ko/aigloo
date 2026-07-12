import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveOnPath,
  isOnPath,
  clearResolveBinCache,
  pythonVersionOf,
} from "../src/platform/resolveBin.js";

const IS_WIN = process.platform === "win32";

describe("resolveOnPath (no-shell)", () => {
  let root: string;
  let binDir: string;

  beforeEach(() => {
    clearResolveBinCache();
    root = join(tmpdir(), `aigloo-resolve-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    binDir = join(root, "bin");
    mkdirSync(binDir, { recursive: true });
  });

  afterEach(() => {
    clearResolveBinCache();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  function plant(name: string): string {
    const p = join(binDir, name);
    writeFileSync(p, IS_WIN ? "@echo off\r\n" : "#!/bin/sh\n");
    if (!IS_WIN) chmodSync(p, 0o755);
    return p;
  }

  it("finds a binary in extraDirs without using PATH", () => {
    const planted = plant(IS_WIN ? "claude.cmd" : "claude");
    const found = resolveOnPath("claude", {
      extraDirs: [binDir],
      pathEnv: "", // empty PATH
      noCache: true,
    });
    expect(found).toBe(planted);
    expect(isOnPath("claude", { extraDirs: [binDir], pathEnv: "", noCache: true })).toBe(true);
  });

  it("finds a binary on PATH", () => {
    const planted = plant(IS_WIN ? "opencode.exe" : "opencode");
    const found = resolveOnPath("opencode", {
      extraDirs: [],
      pathEnv: binDir,
      noCache: true,
    });
    expect(found).toBe(planted);
  });

  it("returns null when missing", () => {
    expect(
      resolveOnPath("definitely-not-installed-xyz", {
        extraDirs: [binDir],
        pathEnv: "",
        noCache: true,
      }),
    ).toBeNull();
  });

  it("caches positive and negative results", () => {
    plant(IS_WIN ? "headroom.cmd" : "headroom");
    const a = resolveOnPath("headroom", { extraDirs: [binDir], pathEnv: "", noCache: false });
    const b = resolveOnPath("headroom", { extraDirs: [binDir], pathEnv: "", noCache: false });
    expect(a).toBe(b);
    expect(a).not.toBeNull();

    const miss1 = resolveOnPath("nope-tool", { extraDirs: [binDir], pathEnv: "", noCache: false });
    const miss2 = resolveOnPath("nope-tool", { extraDirs: [binDir], pathEnv: "", noCache: false });
    expect(miss1).toBeNull();
    expect(miss2).toBeNull();
  });
});

describe("pythonVersionOf", () => {
  it("parses version from the real process binary when available", () => {
    // Use the Node we are running under? No — need python. Skip if none.
    const candidates = IS_WIN
      ? ["python", "python3"]
      : ["python3", "python"];
    let any: string | null = null;
    for (const c of candidates) {
      const r = resolveOnPath(c, { noCache: true });
      if (r) {
        any = r;
        break;
      }
    }
    if (!any) return; // environment has no python — ok
    const ver = pythonVersionOf(any);
    expect(ver).not.toBeNull();
    if (ver) {
      expect(ver[0]).toBeGreaterThanOrEqual(2);
    }
  });
});
