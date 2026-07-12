import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { modalitiesForModel, DEFAULT_CAPABILITIES, type CapsTables } from "@/lib/capabilities";
import { gateway } from "@/lib/gateway";
import { isOnPath } from "@/gw/platform/resolveBin.js";
import { parseSession, SESSION_COOKIE } from "@/lib/session";
import { gw } from "@/lib/gw";
import { clientKeyFingerprint } from "@/gw/middleware/auth.js";

/**
 * Local CLI-tool detection + auto-config. These run in the Next.js server (which,
 * like the gateway, lives on the operator's machine), so they can read/write the
 * tool's own config files — the trick behind aigloo's "it just detects and
 * configures itself". Session-gated by middleware like every other /api route.
 *
 * Only claude-code + opencode auto-configure (the two with a stable local config
 * file we can safely merge into). Others report installed:false → the UI falls
 * back to the manual env block.
 *
 * PATH probes use no-shell filesystem walks (platform/resolveBin) — never
 * `where`/`which`, so Windows does not flash a console.
 */

type Json = Record<string, unknown>;

function onPath(bin: string): boolean {
  // Prefer %APPDATA%\npm on Windows so global npm shims (claude.cmd, etc.) resolve
  // even when the tray/service PATH is thin.
  const extra =
    os.platform() === "win32" && process.env.APPDATA
      ? [path.join(process.env.APPDATA, "npm")]
      : undefined;
  return isOnPath(bin, { extraDirs: extra });
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// tolerate JSONC (trailing commas) and unparseable files (treat as "no config").
function readJson(content: string): Json | null {
  try {
    return JSON.parse(content.replace(/,(\s*[}\]])/g, "$1")) as Json;
  } catch {
    return null;
  }
}

// ─── Claude Code: ~/.claude/settings.json env block ─────────────────────────
const claudePath = () => path.join(os.homedir(), ".claude", "settings.json");
const CLAUDE_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "API_TIMEOUT_MS",
];

async function claudeStatus() {
  const installed = onPath("claude") || (await fileExists(claudePath()));
  if (!installed) return { installed: false as const };
  let settings: Json | null = null;
  try {
    settings = readJson(await fs.readFile(claudePath(), "utf-8"));
  } catch {
    settings = null;
  }
  const env = (settings?.env as Json | undefined) ?? {};
  return {
    installed: true as const,
    configured: typeof env.ANTHROPIC_BASE_URL === "string",
    path: claudePath(),
    baseUrl: (env.ANTHROPIC_BASE_URL as string) ?? null,
    modelSlots: {
      opus: (env.ANTHROPIC_DEFAULT_OPUS_MODEL as string) ?? null,
      sonnet: (env.ANTHROPIC_DEFAULT_SONNET_MODEL as string) ?? null,
      haiku: (env.ANTHROPIC_DEFAULT_HAIKU_MODEL as string) ?? null,
    },
  };
}

async function claudeApply(body: { base?: string; key?: string; models?: Record<string, string> }) {
  if (!body.base) return { error: "base is required" };
  const p = claudePath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  let cur: Json = {};
  try {
    cur = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    cur = {};
  }
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: body.base,
  };
  if (body.key) env.ANTHROPIC_AUTH_TOKEN = body.key;
  if (body.models?.opus) env.ANTHROPIC_DEFAULT_OPUS_MODEL = body.models.opus;
  if (body.models?.sonnet) env.ANTHROPIC_DEFAULT_SONNET_MODEL = body.models.sonnet;
  if (body.models?.haiku) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = body.models.haiku;
  const next = { ...cur, hasCompletedOnboarding: true, env: { ...((cur.env as Json) ?? {}), ...env } };
  await fs.writeFile(p, JSON.stringify(next, null, 2));
  return { success: true, path: p };
}

async function claudeReset() {
  const p = claudePath();
  let cur: Json;
  try {
    cur = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    return { success: true };
  }
  const env = cur.env as Json | undefined;
  if (env) {
    for (const k of CLAUDE_KEYS) delete env[k];
    if (Object.keys(env).length === 0) delete cur.env;
  }
  await fs.writeFile(p, JSON.stringify(cur, null, 2));
  return { success: true };
}

// ─── opencode: ~/.config/opencode/opencode.json provider entry ──────────────
const OC_PROVIDER = "aigloo";
const ocDir = () => path.join(os.homedir(), ".config", "opencode");
const ocPath = () => path.join(ocDir(), "opencode.json");

async function opencodeStatus() {
  const installed = onPath("opencode") || (await fileExists(ocPath()));
  if (!installed) return { installed: false as const };
  let cfg: Json | null = null;
  try {
    cfg = readJson(await fs.readFile(ocPath(), "utf-8"));
  } catch {
    cfg = null;
  }
  const providers = (cfg?.provider as Json | undefined) ?? {};
  const prov = providers[OC_PROVIDER] as Json | undefined;
  const models = prov?.models ? Object.keys(prov.models as Json) : [];
  const active = typeof cfg?.model === "string" && cfg.model.startsWith(`${OC_PROVIDER}/`)
    ? cfg.model.split("/").slice(1).join("/")
    : null;
  return {
    installed: true as const,
    configured: !!prov,
    path: ocPath(),
    models,
    activeModel: active,
    baseUrl: ((prov?.options as Json | undefined)?.baseURL as string) ?? null,
  };
}

async function opencodeApply(body: { base?: string; key?: string; models?: string[]; active?: string; modalities?: Record<string, { input: string[]; output: string[] }> }) {
  const models = (body.models ?? []).filter(Boolean);
  if (!body.base || models.length === 0) return { error: "base and at least one model are required" };
  const p = ocPath();
  await fs.mkdir(ocDir(), { recursive: true });
  let cfg: Json = {};
  try {
    cfg = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    cfg = {};
  }
  const baseURL = body.base.endsWith("/v1") ? body.base : `${body.base}/v1`;
  const provider = (cfg.provider as Json | undefined) ?? {};
  const existing = (provider[OC_PROVIDER] as Json | undefined) ?? {
    npm: "@ai-sdk/openai-compatible",
    options: {},
    models: {},
  };
  existing.options = { ...((existing.options as Json) ?? {}), baseURL, apiKey: body.key || "aigloo" };
  const capsRes = await gateway.capabilities();
  const capsTables: CapsTables = capsRes.ok && capsRes.data
    ? capsRes.data
    : { default: DEFAULT_CAPABILITIES, model: {}, provider: {}, pattern: [] };
  const modelMap: Json = {};
  for (const m of models) modelMap[m] = { name: m, modalities: body.modalities?.[m] ?? modalitiesForModel(m, capsTables) };
  existing.models = modelMap;
  provider[OC_PROVIDER] = existing;
  cfg.provider = provider;
  const active = body.active && models.includes(body.active) ? body.active : models[0];
  cfg.model = `${OC_PROVIDER}/${active}`;
  await fs.writeFile(p, JSON.stringify(cfg, null, 2));
  return { success: true, path: p };
}

async function opencodeReset() {
  const p = ocPath();
  let cfg: Json;
  try {
    cfg = readJson(await fs.readFile(p, "utf-8")) ?? {};
  } catch {
    return { success: true };
  }
  const provider = cfg.provider as Json | undefined;
  if (provider) {
    delete provider[OC_PROVIDER];
  }
  const model = cfg.model as string | undefined;
  if (typeof model === "string" && model.startsWith(`${OC_PROVIDER}/`)) {
    delete cfg.model;
  }
  await fs.writeFile(p, JSON.stringify(cfg, null, 2));
  return { success: true };
}

type ApplyBody = { base?: string; key?: string; models?: string[] | Record<string, string>; active?: string; modalities?: Record<string, { input: string[]; output: string[] }> };
const HANDLERS: Record<
  string,
  { status: () => Promise<unknown>; apply: (b: ApplyBody) => Promise<unknown>; reset: () => Promise<unknown> }
> = {
  "claude-code": {
    status: claudeStatus,
    apply: (b) => claudeApply(b as { base?: string; key?: string; models?: Record<string, string> }),
    reset: claudeReset,
  },
  opencode: {
    status: opencodeStatus,
    apply: (b) => opencodeApply(b as { base?: string; key?: string; models?: string[]; active?: string }),
    reset: opencodeReset,
  },
};

type Ctx = { params: Promise<{ tool: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { tool } = await ctx.params;
  const h = HANDLERS[tool];
  if (!h) return NextResponse.json({ installed: false, auto: false });
  try {
    return NextResponse.json({ auto: true, ...(await h.status() as object) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** If the caller is a member session, fill in their gateway key when missing. */
function memberKeyFromSession(req: NextRequest): string | undefined {
  try {
    const g = gw();
    const keys: string[] = g.state.config.raw.server.api_keys ?? [];
    const session = parseSession(req.cookies.get(SESSION_COOKIE)?.value, {
      currentAdminVersion: g.auth.version,
      validFingerprints: keys.map((k) => clientKeyFingerprint(k)),
    });
    if (session?.role !== "member") return undefined;
    return keys.find((k) => clientKeyFingerprint(k) === session.fingerprint);
  } catch {
    return undefined;
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { tool } = await ctx.params;
  const h = HANDLERS[tool];
  if (!h) return NextResponse.json({ error: "tool does not support auto-config" }, { status: 400 });
  try {
    const body = (await req.json()) as ApplyBody;
    // Members: inject their access key so Apply works without re-pasting.
    if (!body.key?.trim()) {
      const mk = memberKeyFromSession(req);
      if (mk) body.key = mk;
    }
    const res = (await h.apply(body)) as { error?: string };
    if (res.error) return NextResponse.json(res, { status: 400 });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { tool } = await ctx.params;
  const h = HANDLERS[tool];
  if (!h) return NextResponse.json({ error: "tool does not support auto-config" }, { status: 400 });
  try {
    return NextResponse.json(await h.reset() as object);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
