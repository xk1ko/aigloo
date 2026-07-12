import { describe, it, expect } from "vitest";
import { detectShape } from "../src/rtk/detect.js";
import { applyFilter } from "../src/rtk/filters.js";
import { compressMessages } from "../src/rtk/index.js";
import { buildInjection, injectInto } from "../src/inject/index.js";
import { cavemanPrompt } from "../src/inject/caveman.js";
import { ponytailPrompt } from "../src/inject/ponytail.js";
import type { CanonicalMessage, CanonicalRequest } from "../src/core/canonical.js";

describe("RTK detectShape", () => {
  it("detects a unified git diff", () => {
    expect(detectShape("diff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n-old\n+new")).toBe("git-diff");
  });
  it("detects grep -n output", () => {
    expect(detectShape("src/a.ts:1:foo\nsrc/a.ts:2:bar\nsrc/b.ts:9:baz")).toBe("grep");
  });
  it("detects a tree listing", () => {
    expect(detectShape("root\n├── a\n└── b")).toBe("tree");
  });
  it("detects git status --porcelain", () => {
    expect(detectShape(" M src/a.ts\n?? new.ts\n M src/b.ts")).toBe("git-status");
  });
  it("detects git log before porcelain-like noise", () => {
    expect(detectShape("commit abcdef0123456789\nAuthor: x\nDate: y\n\n    subject")).toBe("git-log");
  });
  it("detects build output before porcelain mis-hit", () => {
    const cargo = "   Compiling foo v1.0.0\n   Compiling bar v1.0.0\n    Finished release";
    expect(detectShape(cargo)).toBe("build-output");
  });
  it("detects Windows path lists as find", () => {
    expect(
      detectShape("C:\\Users\\me\\a.ts\nC:\\Users\\me\\b.ts\nC:\\Users\\me\\c.ts"),
    ).toBe("find");
  });
  it("returns null for short prose", () => {
    expect(detectShape("This is just a normal sentence with no structure.")).toBeNull();
  });
  it("returns null for empty input", () => {
    expect(detectShape("")).toBeNull();
  });
});

describe("RTK applyFilter", () => {
  it("caps matches per file in grep output", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 30; i++) lines.push(`src/a.ts:${i}:match ${i}`);
    const out = applyFilter("grep", lines.join("\n"));
    expect(out).toMatch(/\+|matches|elided/i);
    expect(out.length).toBeLessThan(lines.join("\n").length);
  });

  it("groups find listings", () => {
    const lines: string[] = [];
    for (let i = 0; i < 50; i++) lines.push(`./path/to/file_${i}.ts`);
    const out = applyFilter("find", lines.join("\n"));
    expect(out).toContain("files in");
    expect(out.length).toBeLessThan(lines.join("\n").length);
  });

  it("truncates long diff hunks but keeps structure", () => {
    const lines = ["diff --git a/x b/x", "@@ -1,200 +1,200 @@"];
    for (let i = 0; i < 200; i++) lines.push(`+line ${i}`);
    const out = applyFilter("git-diff", lines.join("\n"));
    expect(out).toContain("x");
    expect(out.length).toBeLessThan(lines.join("\n").length);
  });

  it("compresses build output progress noise", () => {
    const lines = [
      "npm warn deprecated foo@1",
      "added 200 packages in 3s",
    ];
    for (let i = 0; i < 40; i++) lines.splice(1, 0, `   Compiling pkg${i} v1.0.0`);
    const raw = lines.join("\n");
    const out = applyFilter("build-output", raw);
    expect(out).toContain("Compiled");
    expect(out.length).toBeLessThan(raw.length);
  });

  it("smart-truncates huge blobs", () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line ${i}`);
    const out = applyFilter("smart-truncate", lines.join("\n"));
    expect(out).toContain("truncated");
    expect(out.split("\n").length).toBeLessThan(400);
  });
});

describe("RTK compressMessages", () => {
  function toolMsg(content: string | { type: "text"; text: string }[]): CanonicalMessage {
    return { role: "tool", tool_call_id: "c1", content: content as CanonicalMessage["content"] };
  }

  it("compresses a large grep tool result and reports stats", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++) lines.push(`src/a.ts:${i}:hit ${i}`);
    // pad to clear MIN_COMPRESS_SIZE
    const body = lines.join("\n") + "\n" + "x".repeat(400);
    const msgs: CanonicalMessage[] = [{ role: "user", content: "find foo" }, toolMsg(body)];
    const stats = compressMessages(msgs);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    expect(stats.bytesOut).toBeLessThan(stats.bytesIn);
    expect(stats.shapes.length).toBeGreaterThan(0);
    expect(typeof msgs[1]!.content).toBe("string");
    expect((msgs[1]!.content as string).length).toBeLessThan(body.length);
  });

  it("compresses text parts inside tool content arrays", () => {
    const lines: string[] = [];
    for (let i = 1; i <= 40; i++) lines.push(`src/a.ts:${i}:hit ${i}`);
    const text = lines.join("\n") + "\n" + "y".repeat(400);
    const msgs: CanonicalMessage[] = [toolMsg([{ type: "text", text }])];
    const stats = compressMessages(msgs);
    expect(stats.hits).toBeGreaterThanOrEqual(1);
    const parts = msgs[0]!.content as { type: string; text: string }[];
    expect(parts[0]!.text.length).toBeLessThan(text.length);
  });

  it("leaves non-tool messages and prose untouched (no hits)", () => {
    const msgs: CanonicalMessage[] = [
      { role: "user", content: "diff --git a/x b/x\n@@ @@\n+lots" },
      { role: "tool", tool_call_id: "c", content: "short answer, not a recognizable shape" },
    ];
    const before = JSON.stringify(msgs);
    const stats = compressMessages(msgs);
    expect(stats.hits).toBe(0);
    expect(JSON.stringify(msgs)).toBe(before);
  });

  it("never grows content (safety net): tiny matched output is kept as-is", () => {
    const msgs: CanonicalMessage[] = [{ role: "tool", tool_call_id: "c", content: "a.ts:1:x" }];
    const original = msgs[0]!.content;
    compressMessages(msgs);
    expect(msgs[0]!.content).toBe(original);
  });
});

describe("inject — prompts per level", () => {
  it("returns null for off, text otherwise", () => {
    expect(cavemanPrompt("off")).toBeNull();
    expect(ponytailPrompt("off")).toBeNull();
    expect(cavemanPrompt("full")).toBeTruthy();
    expect(ponytailPrompt("ultra")).toBeTruthy();
  });

  it("levels differ and full includes shared boundaries", () => {
    expect(cavemanPrompt("lite")).not.toBe(cavemanPrompt("full"));
    expect(cavemanPrompt("full")).not.toBe(cavemanPrompt("ultra"));
    expect(cavemanPrompt("full")).toContain("Auto-Clarity");
    expect(cavemanPrompt("full")).toContain("ACTIVE EVERY RESPONSE");
    expect(ponytailPrompt("full")).toContain("lazy senior");
    expect(ponytailPrompt("full")).toContain("YAGNI");
  });

  it("buildInjection stacks both, injectInto prepends system", () => {
    expect(buildInjection({ caveman: "off", ponytail: "off" })).toBeNull();
    const text = buildInjection({ caveman: "full", ponytail: "full" })!;
    expect(text).toContain(cavemanPrompt("full")!);
    expect(text).toContain(ponytailPrompt("full")!);

    const req: CanonicalRequest = {
      model: "m",
      messages: [{ role: "user", content: "hi" }],
    };
    expect(injectInto(req, { caveman: "lite", ponytail: "off" })).toBe(true);
    expect(req.messages[0]!.role).toBe("system");
    expect(req.messages[0]!.content).toBe(cavemanPrompt("lite"));
  });
});
