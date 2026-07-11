#!/usr/bin/env node
/**
 * Post-build fixup for the Next.js standalone output before npm pack / Docker COPY.
 *
 * What this does:
 *   - Copy dashboard/.next/static into standalone (Next does not put it there)
 *   - Drop unused standalone/src and strip dist/ *.map / *.d.ts
 *   - Migrate legacy standalone/vendor → node_modules (v1.1.15 rename workaround)
 *   - Fail hard if standalone/node_modules/next is missing
 *
 * Why we do NOT rename node_modules → vendor:
 *   Nested node_modules pack fine when ignore rules are anchored (`/node_modules`).
 *   The old unanchored `node_modules/` in dashboard/.npmignore was stripping
 *   standalone/node_modules from the tarball — that was the real bug, not npm.
 *   Keep the natural name so Node resolves `next` without NODE_PATH renames.
 *
 * cli.ts sets NODE_PATH to standalone/node_modules (+ runtime) so require() of
 * traced/runtime deps works even when nested resolution is odd.
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

// Legacy: v1.1.15 renamed node_modules → vendor so npm pack would ship deps.
// With anchored ignore rules that is unnecessary; migrate back if present.
if (existsSync(vendor)) {
  if (existsSync(nm)) {
    rmSync(vendor, { recursive: true, force: true });
    console.log("  prepare-standalone: removed legacy vendor/ (node_modules already present)");
  } else {
    try {
      renameSync(vendor, nm);
    } catch (err) {
      if (err && (err.code === "EXDEV" || err.code === "EPERM")) {
        cpSync(vendor, nm, { recursive: true });
        rmSync(vendor, { recursive: true, force: true });
      } else {
        throw err;
      }
    }
    console.log("  prepare-standalone: migrated legacy vendor/ → node_modules");
  }
}

if (!existsSync(nm)) {
  die(
    "standalone/node_modules missing — Next did not emit traced deps. " +
      "Check dashboard next.config output: 'standalone', then rebuild.",
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

const nextPkg = join(nm, "next", "package.json");
if (!existsSync(nextPkg)) {
  die(
    `node_modules/next/package.json missing — refusing to ship a broken package.\n` +
      `  looked for: ${nextPkg}`,
  );
}

console.log("  prepare-standalone: ok (node_modules/next present)");
