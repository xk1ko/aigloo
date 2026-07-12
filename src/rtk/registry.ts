import type { ToolOutputShape } from "./constants.js";
import { gitDiff } from "./filters/gitDiff.js";
import { gitStatus } from "./filters/gitStatus.js";
import { gitLog } from "./filters/gitLog.js";
import { grep } from "./filters/grep.js";
import { find } from "./filters/find.js";
import { ls } from "./filters/ls.js";
import { tree } from "./filters/tree.js";
import { buildOutput } from "./filters/buildOutput.js";
import { dedupLog } from "./filters/dedupLog.js";
import { smartTruncate } from "./filters/smartTruncate.js";
import { readNumbered } from "./filters/readNumbered.js";
import { searchList } from "./filters/searchList.js";

export type FilterFn = ((text: string) => string) & { filterName?: string };

const REGISTRY: Record<ToolOutputShape, FilterFn> = {
  "git-diff": gitDiff,
  "git-status": gitStatus,
  "git-log": gitLog,
  grep,
  find,
  ls,
  tree,
  "build-output": buildOutput,
  "dedup-log": dedupLog,
  "smart-truncate": smartTruncate,
  "read-numbered": readNumbered,
  "search-list": searchList,
};

const ALIASES: Record<string, FilterFn> = {
  rg: grep,
  fd: find,
};

export function resolveFilter(name: string): FilterFn | null {
  return REGISTRY[name as ToolOutputShape] || ALIASES[name] || null;
}

export function filterForShape(shape: ToolOutputShape): FilterFn {
  return REGISTRY[shape];
}

export function allFilters(): typeof REGISTRY {
  return REGISTRY;
}
