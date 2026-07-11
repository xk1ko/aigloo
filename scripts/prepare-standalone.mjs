#!/usr/bin/env node
/**
 * Post-build fixup for the Next.js standalone output before npm pack / Docker COPY.
 *
 * Why rename node_modules → vendor?
 *   npm ALWAYS omits directories named `node_modules` from the published tarball
 *   (root and nested). Next's `output: "standalone"` puts traced runtime deps in
 *   `dashboard/.next/standalone/node_modules` (including `next` itself). Without
 *   this rename the published package ships server.js with no deps →
 *   `Cannot find module 'next'` on every platform (Linux/macOS/Windows).
 *
 * cli.ts spawnDashboard() sets NODE_PATH to standalone/vendor (or node_modules
 * for unreleased local builds that skip this script).
 *
 * Also: copy .next/static into standalone, drop unused standalone/src, strip
 * sourcemaps/d.ts from dist/, and fail hard if vendor/next is missing.
 */
import {
  cpSync,
  existsSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const standaloneDir = join(root, "dashboard", ".next", "standalone");
const nm = join(standaloneDir, "node_modules");
const vendor = join(standaloneDir, "vendor");
const staticSrc = join(root, "dashboard", ".next", "static");
const staticDst = join(standaloneDir, ".next", "static");
const distDir = join(root, "dist");

function die(msg) {
  console.error(`prepare-standalone: ${msg}`);
  process.exit(1);
}

if (!existsSync(join(standaloneDir, "server.js"))) {
  die(`missing ${standaloneDir}/server.js — run dashboard build first`);
}

// Prefer rename (same FS); fall back to cp+rm for Docker overlay EXDEV.
if (existsSync(nm)) {
  if (existsSync(vendor)) rmSync(vendor, { recursive: true, force: true });
  try {
    renameSync(nm, vendor);
  } catch (err) {
    if (err && (err.code === "EXDEV" || err.code === "EPERM")) {
      cpSync(nm, vendor, { recursive: true });
      rmSync(nm, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  console.log("  prepare-standalone: renamed standalone/node_modules → vendor");
} else if (existsSync(vendor)) {
  console.log("  prepare-standalone: vendor/ already present");
} else {
  die(
    "standalone has neither node_modules nor vendor — Next did not emit traced deps. " +
      "Check dashboard next.config output: 'standalone'.",
  );
}

if (existsSync(staticSrc)) {
  cpSync(staticSrc, staticDst, { recursive: true });
  console.log("  prepare-standalone: copied .next/static into standalone");
} else {
  console.warn("  prepare-standalone: warning — dashboard/.next/static missing");
}

const straySrc = join(standaloneDir, "src");
if (existsSync(straySrc)) {
  rmSync(straySrc, { recursive: true, force: true });
  console.log("  prepare-standalone: removed standalone/src");
}

function stripMapsAndDts(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) stripMapsAndDts(f);
    else if (e.name.endsWith(".map") || e.name.endsWith(".d.ts")) rmSync(f);
  }
}
if (existsSync(distDir) && statSync(distDir).isDirectory()) {
  stripMapsAndDts(distDir);
}

const nextPkg = join(vendor, "next", "package.json");
if (!existsSync(nextPkg)) {
  die(
    `vendor/next/package.json missing after rename — refusing to ship a broken package.\n` +
      `  looked for: ${nextPkg}`,
  );
}

console.log("  prepare-standalone: ok (vendor/next present)");
