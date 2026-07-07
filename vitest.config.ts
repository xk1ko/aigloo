import { defineConfig } from "vitest/config";

// Without this, vitest's default discovery also picks up dashboard/**/*.test.ts —
// those need dashboard/vitest.config.ts's @/ and @/gw/* alias resolution and
// must run via `cd dashboard && npm test` instead. Also exclude .worktrees/**
// so a nested git worktree checked out during development doesn't get its
// own tests/dashboard tests double-discovered from the main repo root.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "dashboard/**", ".worktrees/**"],
  },
});
