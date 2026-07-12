/**
 * Autodetect which RTK filter to apply to a tool-output blob.
 * Order matches common tool-output compressor ports (git-log before porcelain, etc.).
 */
import {
  DETECT_WINDOW,
  READ_NUMBERED_MIN_HIT_RATIO,
  SMART_TRUNCATE_MIN_LINES,
  type ToolOutputShape,
} from "./constants.js";
import { filterForShape, type FilterFn } from "./registry.js";
import { READ_NUMBERED_LINE_RE } from "./filters/readNumbered.js";
import { SEARCH_LIST_HEADER_RE } from "./filters/searchList.js";

const RE_GIT_DIFF = /^diff --git /m;
const RE_GIT_DIFF_HUNK = /^@@ /m;
const RE_GIT_STATUS = /^On branch |^nothing to commit|^Changes (not |to be )|^Untracked files:/m;
const RE_GIT_LOG = /^[*|/\\ ]*commit [0-9a-f]{7,40}$/m;
const RE_PORCELAIN = /^[ MADRCU?!][ MADRCU?!] \S/m;
const RE_BUILD_OUTPUT =
  /^(npm (warn|error|ERR!)|yarn (warn|error)|\s*Compiling\s+\S+|\s*Downloading\s+\S+|added \d+ package|\[ERROR\]|BUILD (SUCCESS|FAILED)|\s*Finished\s+|Successfully (installed|built)|ERROR:)/im;
const RE_TREE_GLYPH = /[├└]──|│  /;
const RE_LS_ROW = /^[-dlbcps][rwx-]{9}/m;
const RE_LS_TOTAL = /^total \d+$/m;

/** Back-compat name used by tests and callers. */
export type { ToolOutputShape };

export function autoDetectFilter(text: string): FilterFn | null {
  const head = text.length > DETECT_WINDOW ? text.slice(0, DETECT_WINDOW) : text;

  if (RE_GIT_LOG.test(head)) return filterForShape("git-log");
  if (RE_GIT_DIFF.test(head) || RE_GIT_DIFF_HUNK.test(head)) return filterForShape("git-diff");
  if (RE_GIT_STATUS.test(head)) return filterForShape("git-status");
  if (RE_BUILD_OUTPUT.test(head)) return filterForShape("build-output");
  if (isMostlyPorcelain(head)) return filterForShape("git-status");

  const lines = head.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);

  const first5 = nonEmpty.slice(0, 5);
  if (first5.some(isGrepLine)) return filterForShape("grep");

  if (nonEmpty.length >= 3 && nonEmpty.every(isPathLike)) return filterForShape("find");
  if (RE_TREE_GLYPH.test(head)) return filterForShape("tree");
  if (RE_LS_TOTAL.test(head) || countMatches(head, RE_LS_ROW) >= 3) return filterForShape("ls");
  if (SEARCH_LIST_HEADER_RE.test(head)) return filterForShape("search-list");

  if (lines.length >= SMART_TRUNCATE_MIN_LINES && isLineNumbered(lines)) {
    return filterForShape("read-numbered");
  }
  if (nonEmpty.length >= 5) return filterForShape("dedup-log");
  if (text.split("\n").length >= SMART_TRUNCATE_MIN_LINES) return filterForShape("smart-truncate");

  return null;
}

/** Shape name for stats / logs (first match wins). */
export function detectShape(text: string): ToolOutputShape | null {
  const fn = autoDetectFilter(text);
  if (!fn) return null;
  return (fn.filterName as ToolOutputShape) || null;
}

function isGrepLine(line: string): boolean {
  const first = line.indexOf(":");
  if (first === -1) return false;
  const second = line.indexOf(":", first + 1);
  if (second === -1) return false;
  return /^\d+$/.test(line.slice(first + 1, second));
}

function isPathLike(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (/^[A-Za-z]:[\\/]/.test(t)) return true;
  if (t.includes(":")) return false;
  return t.startsWith(".") || t.startsWith("/") || t.includes("/") || t.includes("\\");
}

function isMostlyPorcelain(head: string): boolean {
  const lines = head.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;
  const hits = lines.filter((l) => RE_PORCELAIN.test(l)).length;
  return hits / lines.length >= 0.6;
}

function isLineNumbered(lines: string[]): boolean {
  let hits = 0;
  let nonEmpty = 0;
  for (const l of lines.slice(0, 100)) {
    if (l.length === 0) continue;
    nonEmpty++;
    if (READ_NUMBERED_LINE_RE.test(l)) hits++;
  }
  if (nonEmpty < 5) return false;
  return hits / nonEmpty >= READ_NUMBERED_MIN_HIT_RATIO;
}

function countMatches(text: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  return (text.match(g) || []).length;
}
