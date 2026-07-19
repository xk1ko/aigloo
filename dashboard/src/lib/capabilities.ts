/**
 * Capability resolver — data fetched from backend `GET /admin/capabilities`.
 * Backend (`src/providers/capabilities.ts`) is single source of truth.
 */

export interface Caps {
  vision: boolean;
  pdf: boolean;
  audioInput: boolean;
  videoInput: boolean;
  imageOutput: boolean;
  audioOutput: boolean;
  search: boolean;
  tools: boolean;
  reasoning: boolean;
  thinkingFormat: string | null;
  thinkingCanDisable: boolean;
  thinkingRange: { min: number; max: number } | null;
  contextWindow: number;
  maxOutput: number;
}

export interface CapsTables {
  default: Caps;
  model: Record<string, Partial<Caps>>;
  provider: Record<string, Record<string, Partial<Caps>>>;
  pattern: Array<{ pattern: string; caps: Partial<Caps> }>;
}

/** Glob (* = wildcard) match, anchored + case-insensitive. */
export function matchPattern(pattern: string, model: string): boolean {
  const regex = new RegExp(
    "^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$",
    "i",
  );
  return regex.test(model);
}

export const DEFAULT_CAPABILITIES: Caps = {
  vision: false,
  pdf: false,
  audioInput: false,
  videoInput: false,
  imageOutput: false,
  audioOutput: false,
  search: false,
  tools: true,
  reasoning: false,
  thinkingFormat: null,
  thinkingCanDisable: true,
  thinkingRange: null,
  contextWindow: 200000,
  maxOutput: 64000,
};

/**
 * Resolve capabilities for a model using the 4-step fallback chain,
 * merged over DEFAULT_CAPABILITIES so the result is always complete.
 */
export function getCapabilitiesForModel(
  provider: string | null,
  model: string,
  tables: CapsTables,
): Caps {
  if (!model) return { ...tables.default };

  // 1. Provider-specific override
  if (provider && tables.provider[provider]?.[model]) {
    return { ...tables.default, ...tables.provider[provider][model] };
  }

  // 2. Canonical exact (strip vendor prefix: "anthropic/claude-opus-4.7" -> "claude-opus-4.7")
  const baseModel = (model.includes("/") ? model.split("/").pop() : model) ?? model;
  if (tables.model[baseModel]) return { ...tables.default, ...tables.model[baseModel] };
  if (tables.model[model]) return { ...tables.default, ...tables.model[model] };

  // 3. Pattern match (first match wins)
  for (const { pattern, caps } of tables.pattern) {
    if (matchPattern(pattern, baseModel) || matchPattern(pattern, model)) {
      return { ...tables.default, ...caps };
    }
  }

  // 4. Floor
  return { ...tables.default };
}

/**
 * models.dev-style modalities for a model ref, derived from its capabilities.
 * Ref may be a `provider/model` (vendor prefix tolerated) or a bare combo alias.
 */
export function modalitiesForModel(
  ref: string,
  tables: CapsTables,
): { input: string[]; output: string[] } {
  const slash = ref.indexOf("/");
  const provider = slash > 0 ? ref.slice(0, slash) : null;
  const model = slash > 0 ? ref.slice(slash + 1) : ref;
  const c = getCapabilitiesForModel(provider, model, tables);
  const input = ["text"];
  if (c.vision) input.push("image");
  if (c.pdf) input.push("pdf");
  if (c.audioInput) input.push("audio");
  if (c.videoInput) input.push("video");
  const output = ["text"];
  if (c.imageOutput) output.push("image");
  if (c.audioOutput) output.push("audio");
  return { input, output };
}
