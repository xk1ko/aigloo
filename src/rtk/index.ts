/**
 * RTK token saver. Compresses tool-output text inside tool messages before the
 * request is sent upstream, trimming redundant bulk (long diffs, huge grep
 * dumps, directory listings) that inflates input tokens without adding signal.
 *
 * Operates on the canonical request, so it's format-agnostic: an Anthropic
 * tool_result and an OpenAI tool message both arrive here as role="tool".
 *
 * Fail-open + safety net: a filtered result is only used when it's non-empty AND
 * smaller than the original. A detector/filter that throws is swallowed and the
 * original text kept — RTK must never break a request.
 */
import type { CanonicalContentPart, CanonicalMessage } from "../core/canonical.js";
import { MIN_COMPRESS_SIZE, RAW_CAP } from "./constants.js";
import { autoDetectFilter } from "./autodetect.js";
import { safeApply } from "./applyFilter.js";

export interface RtkStats {
  /** number of tool outputs compressed */
  hits: number;
  bytesIn: number;
  bytesOut: number;
  shapes: string[];
}

function compressText(text: string, stats: RtkStats): string {
  const bytesIn = text.length;
  if (bytesIn < MIN_COMPRESS_SIZE || bytesIn > RAW_CAP) return text;

  try {
    const fn = autoDetectFilter(text);
    if (!fn) return text;
    const filtered = safeApply(fn, text);
    if (!filtered || filtered.length === 0 || filtered.length >= bytesIn) return text;

    stats.hits++;
    stats.bytesIn += bytesIn;
    stats.bytesOut += filtered.length;
    stats.shapes.push(fn.filterName || fn.name || "filter");
    return filtered;
  } catch {
    return text;
  }
}

function compressContent(
  content: string | CanonicalContentPart[] | null | undefined,
  stats: RtkStats,
): string | CanonicalContentPart[] | null | undefined {
  if (typeof content === "string") return compressText(content, stats);
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part && part.type === "text" && typeof part.text === "string") {
      return { ...part, text: compressText(part.text, stats) };
    }
    return part;
  });
}

/**
 * Compress tool-output content in place. Returns stats (hits=0 when nothing was
 * compressible). Touches role="tool" messages with string or text-part content.
 */
export function compressMessages(messages: CanonicalMessage[]): RtkStats {
  const stats: RtkStats = { hits: 0, bytesIn: 0, bytesOut: 0, shapes: [] };
  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    msg.content = compressContent(msg.content, stats) as CanonicalMessage["content"];
  }
  return stats;
}

export { detectShape } from "./autodetect.js";
export { applyFilter } from "./filters.js";
