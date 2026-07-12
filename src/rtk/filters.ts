/**
 * Back-compat: apply a filter by shape name.
 * Prefer autodetect + safeApply for new code.
 */
import type { ToolOutputShape } from "./constants.js";
import { filterForShape } from "./registry.js";

export type { ToolOutputShape };

export function applyFilter(shape: ToolOutputShape, text: string): string {
  return filterForShape(shape)(text);
}
