/** Catch filter panics; never throw into the request path. */
export function safeApply(fn: (text: string) => string, text: string): string {
  try {
    const out = fn(text);
    if (typeof out !== "string") return text;
    return out;
  } catch (err) {
    const name = (fn as { filterName?: string }).filterName || fn.name || "anonymous";
    console.warn(
      `[rtk] warning: filter '${name}' failed — passing through raw output: ${(err as Error)?.message || err}`,
    );
    return text;
  }
}
