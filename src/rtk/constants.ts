/** RTK size gates and filter caps (aligned with common tool-output compressor ports). */

export const RAW_CAP = 10 * 1024 * 1024; // 10 MiB
export const MIN_COMPRESS_SIZE = 500; // skip tiny blobs
export const DETECT_WINDOW = 1024;

export const GIT_DIFF_HUNK_MAX_LINES = 100;
export const GIT_LOG_MAX_LINES = 200;
export const DEDUP_LINE_MAX = 2000;

export const GREP_PER_FILE_MAX = 10;
export const FIND_PER_DIR_MAX = 10;
export const FIND_TOTAL_DIR_MAX = 20;

export const STATUS_MAX_FILES = 10;
export const STATUS_MAX_UNTRACKED = 10;

export const LS_EXT_SUMMARY_TOP = 5;
export const LS_NOISE_DIRS = [
  "node_modules",
  ".git",
  "target",
  "__pycache__",
  ".next",
  "dist",
  "build",
  ".cache",
  ".turbo",
  ".vercel",
  ".pytest_cache",
  ".mypy_cache",
  ".tox",
  ".venv",
  "venv",
  "env",
  "coverage",
  ".nyc_output",
  ".DS_Store",
  "Thumbs.db",
  ".idea",
  ".vscode",
  ".vs",
];

export const TREE_MAX_LINES = 200;
export const SEARCH_LIST_PER_DIR_MAX = 10;
export const SEARCH_LIST_TOTAL_DIR_MAX = 20;

export const SMART_TRUNCATE_HEAD = 120;
export const SMART_TRUNCATE_TAIL = 60;
export const SMART_TRUNCATE_MIN_LINES = 250;

export const READ_NUMBERED_MIN_HIT_RATIO = 0.7;

export type ToolOutputShape =
  | "git-diff"
  | "git-status"
  | "git-log"
  | "grep"
  | "find"
  | "ls"
  | "tree"
  | "build-output"
  | "dedup-log"
  | "smart-truncate"
  | "read-numbered"
  | "search-list";
