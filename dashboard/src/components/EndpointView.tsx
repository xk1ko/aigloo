"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty, LoadingDots } from "@/components/ui";
import type { EndpointPayload, HeadroomStatusReply, InjectLevel } from "@/lib/gateway";

const LEVELS: InjectLevel[] = ["off", "lite", "full", "ultra"];

export function EndpointView() {
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const reload = useCallback(async () => {
    const r = await adminApi.endpoint();
    if (!r.ok) {
      setError(r.error ?? "could not reach the gateway");
      return;
    }
    setError("");
    setEp(r.data);
  }, []);

  // Config only — do NOT probe headroom on mount (Windows shells `where`/`python`
  // and flashes a console). Detection runs on Check / Start / Stop only.
  useEffect(() => {
    void reload();
  }, [reload]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy("");
    if (!r.ok) setError(r.error ?? "action failed");
    else {
      setError("");
      await reload();
    }
  }

  if (error) return <Empty>{error}</Empty>;
  if (!ep) return <LoadingDots />;

  const baseUrl = `http://localhost:${ep.port}`;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Endpoint</h1>
      </div>

      {/* Hero URL — full-width prominent bar */}
      <div className="mb-5 overflow-hidden rounded-brand-lg glass-premium">
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="flex flex-none items-center gap-2">
            <span className={`h-3 w-3 rounded-full ${ep.port ? "bg-success" : "bg-danger"}`} style={{ boxShadow: `0 0 12px 2px ${ep.port ? "var(--color-success)" : "var(--color-danger)"}` }} />
            <span className="text-[12px] font-semibold uppercase tracking-wider text-text-subtle">Live</span>
          </div>
          <button
            onClick={() => { void navigator.clipboard.writeText(baseUrl); }}
            className="flex flex-1 items-center gap-3 rounded-brand border border-border-subtle bg-bg/60 px-4 py-2 transition-all hover:border-accent/40"
          >
            <code className="tnum text-[14px] font-medium text-text">{baseUrl}</code>
            <Icon name="content_copy" size={16} className="ml-auto flex-none text-text-subtle" />
          </button>
        </div>
        <div className="border-t border-border-subtle px-5 py-3">
          <TunnelRow />
        </div>
      </div>

      {/* Token Savers + Headroom — side by side */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Token Savers — single card, 3 stacked rows */}
        <div className="overflow-hidden rounded-brand-lg card">
          <div className="border-b border-border-subtle px-5 py-3">
            <div className="flex items-center gap-2">
              <Icon name="tune" size={16} className="text-text-subtle" />
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">Token Savers</h2>
            </div>
            <p className="mt-0.5 text-[12px] text-text-muted">Applied to every request before routing.</p>
          </div>
          <div className="divide-y divide-border-subtle">
            {/* RTK */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-text">RTK</span>
                <ToggleSwitch on={ep.rtk} busy={busy === "rtk"} onChange={(v) => run("rtk", () => adminApi.setRtk(v))} />
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                Compress bulky tool_result blocks (diffs, grep, listings) in the request.
              </p>
            </div>

            {/* Caveman */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-text">Caveman</span>
                {ep.caveman !== "off" && <span className="rounded-full bg-info/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info">{ep.caveman}</span>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                Terse model output — drops filler, keeps substance.
              </p>
              <div className="mt-2 flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
                {LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    disabled={busy === "caveman"}
                    onClick={() => run("caveman", () => adminApi.setCaveman(lvl))}
                    className={`flex-1 rounded-full py-1 text-[12px] font-medium transition-colors ${
                      ep.caveman === lvl ? "bg-accent text-accent-ink" : "text-text-muted hover:text-text"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            {/* Ponytail */}
            <div className="px-5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-bold text-text">Ponytail</span>
                {ep.ponytail !== "off" && <span className="rounded-full bg-info/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info">{ep.ponytail}</span>}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-text-muted">
                Minimal, YAGNI code style — deletion over addition.
              </p>
              <div className="mt-2 flex items-center gap-0.5 rounded-full bg-surface-2 p-0.5">
                {LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    disabled={busy === "ponytail"}
                    onClick={() => run("ponytail", () => adminApi.setPonytail(lvl))}
                    className={`flex-1 rounded-full py-1 text-[12px] font-medium transition-colors ${
                      ep.ponytail === lvl ? "bg-accent text-accent-ink" : "text-text-muted hover:text-text"
                    }`}
                  >
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <HeadroomCard ep={ep} reloadConfig={reload} />
      </div>
    </div>
  );
}

const HEADROOM_INSTALL_CMD = "pipx install git+https://github.com/chopratejas/headroom";

/** Coarse setup ladder for the Headroom card (checked only after Check / Start / Stop). */
type HeadroomPhase =
  | "unknown"
  | "no_python"
  | "not_installed"
  | "external"
  | "down"
  | "up_off"
  | "active"
  | "enabled_down";

function headroomPhase(hr: HeadroomStatusReply | null, enabled: boolean): HeadroomPhase {
  if (!hr) return "unknown";
  if (hr.running && enabled) return "active";
  if (hr.running && !enabled) return "up_off";
  if (enabled && !hr.running) return "enabled_down";
  if (!hr.python && !hr.installed) return "no_python";
  if (!hr.installed) return "not_installed";
  if (!hr.localUrl) return "external";
  return "down";
}

function HeadroomCard({
  ep,
  reloadConfig,
}: {
  ep: EndpointPayload;
  reloadConfig: () => Promise<void>;
}) {
  const h = ep.headroom;
  const [hr, setHr] = useState<HeadroomStatusReply | null>(null);
  const [url, setUrl] = useState(h.url);
  const [localBusy, setLocalBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [logText, setLogText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(h.url), [h.url]);

  const phase = headroomPhase(hr, h.enabled);

  /** Shells out on the server — only from Check / Start / Stop (no mount probe). */
  async function probeStatus(): Promise<HeadroomStatusReply | null> {
    const r = await adminApi.headroomStatus();
    if (r.ok && r.data) {
      setHr(r.data);
      return r.data;
    }
    return null;
  }

  async function loadLog(): Promise<string> {
    const r = await adminApi.headroomLog();
    const text = r.ok && r.data ? (r.data.log || "(empty log)") : (r.error ?? "could not load log");
    setLogText(text);
    return text;
  }

  async function actConfig(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setLocalBusy(label);
    setMsg("");
    setCheck(null);
    const r = await fn();
    setLocalBusy("");
    if (!r.ok) setMsg(r.error ?? "action failed");
    await reloadConfig();
  }

  async function checkProxy() {
    setLocalBusy("check");
    setMsg("");
    setCheck(null);
    const data = await probeStatus();
    setLocalBusy("");
    if (!data) {
      setCheck({ ok: false, text: "could not reach the gateway" });
      return;
    }
    setCheck(
      data.running
        ? { ok: true, text: `proxy is up at ${data.url}` }
        : { ok: false, text: `no proxy responding at ${data.url}` },
    );
  }

  async function startProxy(alsoEnable: boolean) {
    setLocalBusy(alsoEnable ? "start-enable" : "start");
    setMsg("");
    setCheck(null);
    const r = await adminApi.headroomStart();
    if (!r.ok) {
      setLocalBusy("");
      setMsg(r.error ?? "start failed");
      await probeStatus();
      setLogOpen(true);
      await loadLog();
      return;
    }
    let data = await probeStatus();
    // Brief wait if spawn succeeded but /health not ready yet
    if (data && !data.running) {
      await new Promise((res) => setTimeout(res, 600));
      data = await probeStatus();
    }
    if (alsoEnable && data?.running && !h.enabled) {
      const en = await adminApi.setHeadroom({ enabled: true });
      if (!en.ok) setMsg(en.error ?? "proxy up but enable failed");
      await reloadConfig();
      data = await probeStatus();
    } else if (alsoEnable && data?.running) {
      await reloadConfig();
    }
    setLocalBusy("");
    setCheck(
      data?.running
        ? {
            ok: true,
            text: alsoEnable
              ? `proxy up and compression on at ${data.url}`
              : `proxy is up at ${data.url}`,
          }
        : { ok: false, text: data ? `started but no proxy at ${data.url} yet` : "start finished; status unknown" },
    );
    if (!data?.running) {
      setLogOpen(true);
      await loadLog();
    }
  }

  async function stopProxy() {
    setLocalBusy("stop");
    setMsg("");
    setCheck(null);
    const r = await adminApi.headroomStop();
    setLocalBusy("");
    if (!r.ok) setMsg(r.error ?? "stop failed");
    await probeStatus();
  }

  async function toggleLog() {
    if (logOpen) {
      setLogOpen(false);
      return;
    }
    setLogOpen(true);
    setLocalBusy("log");
    await loadLog();
    setLocalBusy("");
  }

  function copyInstall() {
    void navigator.clipboard.writeText(HEADROOM_INSTALL_CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const startDisabled =
    !!localBusy ||
    !!hr?.running ||
    (hr !== null && !hr.canStart);

  const canStartEnable =
    !localBusy &&
    hr !== null &&
    hr.canStart &&
    !hr.running;

  return (
    <div className="overflow-hidden rounded-brand-lg card">
      <div className="border-b border-border-subtle px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon name="compress" size={16} className="text-text-subtle" />
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">Headroom</h2>
        </div>
        <p className="mt-0.5 text-[12px] text-text-muted">External context-compression proxy.</p>
      </div>
      <div>
        <div className="border-b border-border-subtle px-5 py-4">
          {/* Primary status + detail pills */}
          <div className="flex flex-wrap items-center gap-2">
            <HeadroomPhasePill phase={phase} />
            {hr && (
              <>
                {hr.python ? (
                  <Pill $tone="info">py {hr.python}</Pill>
                ) : hr.installed ? null : (
                  <Pill $tone="neutral">no py ≥3.10</Pill>
                )}
                {hr.managedPid ? <span className="tnum text-[11px] text-text-subtle">pid {hr.managedPid}</span> : null}
              </>
            )}
          </div>

          <div className="mt-3">
            <HeadroomGuidance phase={phase} url={hr?.url ?? h.url} path={hr?.path ?? null} />
          </div>

          {/* Install command when needed */}
          {(phase === "not_installed" || phase === "no_python") && (
            <div className="mt-3 space-y-2">
              {phase === "no_python" && (
                <p className="text-[11px] text-text-subtle">
                  Install{" "}
                  <a href="https://www.python.org/downloads/" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Python ≥ 3.10
                  </a>
                  , then install the CLI:
                </p>
              )}
              <div className="flex items-center gap-2 rounded-brand border border-border-subtle bg-surface-2/50 px-2.5 py-1.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text">{HEADROOM_INSTALL_CMD}</code>
                <button
                  type="button"
                  onClick={copyInstall}
                  className="flex flex-none items-center gap-1 rounded-brand px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <Icon name="content_copy" size={13} />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[11px] text-text-subtle">
                From{" "}
                <a href="https://github.com/chopratejas/headroom" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  chopratejas/headroom
                </a>
                . Then click Check.
              </p>
            </div>
          )}

          <div className="mt-4 space-y-3">
            <ToggleRow
              label="Enable"
              desc="Compress context through proxy before each request."
              on={h.enabled}
              busy={localBusy === "enable"}
              disabled={!hr?.running && !h.enabled}
              onChange={(v) => actConfig("enable", () => adminApi.setHeadroom({ enabled: v }))}
            />
            <div className="h-px bg-border-subtle" />
            <ToggleRow
              label="Compress user msgs"
              desc="Also squeeze user turns, not just tool/assistant context."
              on={h.compress_user_messages}
              busy={localBusy === "cum"}
              disabled={!hr?.running && !h.enabled}
              onChange={(v) => actConfig("cum", () => adminApi.setHeadroom({ compress_user_messages: v }))}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canStartEnable && !h.enabled && (
              <Button disabled={!!localBusy} onClick={() => void startProxy(true)}>
                <Icon
                  name={localBusy === "start-enable" ? "sync" : "bolt"}
                  size={16}
                  className={localBusy === "start-enable" ? "animate-spin" : ""}
                />
                {localBusy === "start-enable" ? "Starting…" : "Start & enable"}
              </Button>
            )}
            <Button disabled={startDisabled} onClick={() => void startProxy(false)} variant={canStartEnable && !h.enabled ? "ghost" : "primary"}>
              <Icon name={localBusy === "start" ? "sync" : "play_arrow"} size={16} className={localBusy === "start" ? "animate-spin" : ""} />
              {localBusy === "start" ? "Starting…" : "Start"}
            </Button>
            <Button
              variant="danger"
              disabled={!hr?.managedPid || !!localBusy}
              onClick={() => void stopProxy()}
            >
              <Icon name="stop" size={16} /> Stop
            </Button>
            <Button variant="ghost" disabled={!!localBusy} onClick={() => void checkProxy()}>
              <Icon name="sync" size={16} className={localBusy === "check" ? "animate-spin" : ""} />
              {localBusy === "check" ? "Checking…" : "Check"}
            </Button>
            <Button variant="ghost" disabled={!!localBusy && localBusy !== "log"} onClick={() => void toggleLog()}>
              <Icon name="article" size={16} className={localBusy === "log" ? "animate-spin" : ""} />
              {logOpen ? "Hide log" : "View log"}
            </Button>
          </div>

          {msg && <p className="mt-2 text-[12px] text-danger">{msg}</p>}
          {check && (
            <p className={`mt-2 flex items-center gap-1 text-[12px] ${check.ok ? "text-success" : "text-danger"}`}>
              <Icon name={check.ok ? "check_circle" : "error"} size={14} /> {check.text}
            </p>
          )}

          {logOpen && (
            <div className="mt-3 overflow-hidden rounded-brand border border-border-subtle bg-bg">
              <div className="flex items-center justify-between border-b border-border-subtle px-3 py-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">proxy.log</span>
                <button
                  type="button"
                  disabled={!!localBusy}
                  onClick={() => {
                    setLocalBusy("log");
                    void loadLog().finally(() => setLocalBusy(""));
                  }}
                  className="text-[11px] font-medium text-text-muted hover:text-text"
                >
                  Refresh
                </button>
              </div>
              <pre className="max-h-40 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-text-muted whitespace-pre-wrap break-all">
                {logText === null ? "Loading…" : logText || "(empty log)"}
              </pre>
            </div>
          )}
        </div>

        <div className="px-5 py-4">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Proxy URL</div>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8787" className="font-mono text-[13px]" />
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              disabled={url.trim() === h.url || localBusy === "url"}
              onClick={() => actConfig("url", () => adminApi.setHeadroom({ url: url.trim() }))}
            >
              Save URL
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeadroomPhasePill({ phase }: { phase: HeadroomPhase }) {
  const map: Record<HeadroomPhase, { tone: Tone; label: string }> = {
    unknown: { tone: "neutral", label: "not checked" },
    no_python: { tone: "warn", label: "need Python ≥3.10" },
    not_installed: { tone: "warn", label: "CLI not installed" },
    external: { tone: "info", label: "external URL" },
    down: { tone: "warn", label: "proxy down" },
    up_off: { tone: "info", label: "proxy up · off" },
    active: { tone: "live", label: "active" },
    enabled_down: { tone: "down", label: "enabled · not running" },
  };
  const { tone, label } = map[phase];
  return <Pill $tone={tone}>{label}</Pill>;
}

function HeadroomGuidance({
  phase,
  url,
  path,
}: {
  phase: HeadroomPhase;
  url: string;
  path: string | null;
}) {
  const items: Record<HeadroomPhase, { tone: "neutral" | "accent" | "warn" | "danger" | "success"; icon: string; text: string }> = {
    unknown: {
      tone: "neutral",
      icon: "info",
      text: "Click Check (or Start) to detect the headroom CLI — avoids probing on every page visit.",
    },
    no_python: {
      tone: "warn",
      icon: "warning",
      text: "Python ≥ 3.10 not found on PATH. Install Python, then the headroom CLI.",
    },
    not_installed: {
      tone: "warn",
      icon: "warning",
      text: "Headroom CLI not on PATH. Install it, then Check again.",
    },
    external: {
      tone: "accent",
      icon: "info",
      text: `URL isn’t loopback (${url}) — start that proxy yourself; aigloo won’t manage it.`,
    },
    down: {
      tone: "accent",
      icon: "info",
      text: path
        ? `CLI found (${path}). Start the proxy, then enable compression — or use Start & enable.`
        : "Start the proxy first, then enable compression.",
    },
    up_off: {
      tone: "accent",
      icon: "info",
      text: `Proxy is healthy at ${url}. Turn on Enable to compress requests.`,
    },
    active: {
      tone: "success",
      icon: "check_circle",
      text: `Compressing through ${url}.`,
    },
    enabled_down: {
      tone: "danger",
      icon: "error",
      text: `Compression is ON but nothing is healthy at ${url} — requests are not being compressed. Start the proxy or turn Enable off.`,
    },
  };
  const g = items[phase];
  const box =
    g.tone === "danger"
      ? "border-danger/30 bg-danger/5 text-danger"
      : g.tone === "warn"
        ? "border-warning/30 bg-warning/5 text-warning"
        : g.tone === "success"
          ? "border-success/30 bg-success/5 text-success"
          : g.tone === "accent"
            ? "border-accent/20 bg-accent/5 text-text-subtle"
            : "border-border-subtle bg-surface-2/50 text-text-subtle";
  const iconClass =
    g.tone === "danger"
      ? "text-danger"
      : g.tone === "warn"
        ? "text-warning"
        : g.tone === "success"
          ? "text-success"
          : g.tone === "accent"
            ? "text-accent"
            : "text-text-subtle";
  return (
    <div className={`flex items-start gap-2 rounded-brand border px-3 py-2 text-[12px] ${box}`}>
      <Icon name={g.icon} size={14} className={`mt-0.5 flex-none ${iconClass}`} />
      <span className="leading-relaxed">{g.text}</span>
    </div>
  );
}

function ToggleSwitch({ on, busy, disabled, onChange }: { on: boolean; busy: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const off = busy || disabled;
  return (
    <button
      disabled={off}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 flex-none rounded-full transition-colors ${on ? "bg-accent" : "bg-danger/30"} ${off ? "opacity-40" : ""}`}
      style={on ? { boxShadow: "0 0 10px -1px var(--color-accent-glow)" } : undefined}
      aria-pressed={on}
    >
      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-bg shadow-sm transition-transform ${on ? "translate-x-[16px]" : "translate-x-0"}`} />
    </button>
  );
}

function ToggleRow({ label, desc, on, busy, disabled, onChange }: { label: string; desc: string; on: boolean; busy: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  const off = busy || disabled;
  return (
    <div className={`flex items-center justify-between gap-4 ${off ? "opacity-40" : ""}`}>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-text">{label}</div>
        <div className="text-[12px] text-text-muted">{desc}</div>
      </div>
      <ToggleSwitch on={on} busy={busy} disabled={disabled} onChange={onChange} />
    </div>
  );
}

type Tone = "live" | "down" | "warn" | "info" | "neutral";

const PILL_TONES: Record<Tone, string> = {
  live: "bg-success/12 text-success",
  down: "bg-danger/12 text-danger",
  warn: "bg-warning/12 text-warning",
  info: "bg-info/12 text-info",
  neutral: "bg-surface-2 text-text-muted",
};

function Pill({ $tone = "neutral", children }: { $tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONES[$tone]}`}>
      {children}
    </span>
  );
}

function TunnelRow() {
  const [status, setStatus] = useState<{ enabled: boolean; url: string | null; hasAuth?: boolean; isDefaultPassword?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("tunnel-warning-dismissed") === "1";
  });

  useEffect(() => {
    void fetch("/api/gw/admin/tunnel").then(async (r) => {
      if (r.ok) setStatus(await r.json());
    });
  }, []);

  async function toggle() {
    setBusy(true);
    setErr("");
    const method = status?.enabled ? "DELETE" : "POST";
    const r = await fetch("/api/gw/admin/tunnel", { method });
    if (r.ok) {
      setStatus(await r.json());
    } else {
      const body = await r.json().catch(() => ({ error: "failed" }));
      setErr(body.error ?? "failed");
    }
    setBusy(false);
  }

  function dismiss() {
    setDismissed(true);
    localStorage.setItem("tunnel-warning-dismissed", "1");
  }

  const isUnsafe = status && !status.enabled && (!status.hasAuth || status.isDefaultPassword);
  const showWarning = isUnsafe && !dismissed;

  return (
    <div className="space-y-2">
      <div className="text-[11px] text-text-subtle">Expose gateway over the internet via a secure Cloudflare tunnel.</div>
      <div className="flex items-center gap-3">
        {status?.enabled ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-info/10 px-2.5 py-0.5 text-[11px] font-medium text-info">
            <span className="h-1.5 w-1.5 rounded-full bg-info" />
            Tunnel
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-text-muted" />
            Tunnel
          </span>
        )}
        {busy ? (
          <span className="flex items-center gap-2 text-[12px] text-text-muted">
            <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            {status?.enabled ? "Disconnecting…" : "Starting tunnel…"}
          </span>
        ) : status?.enabled && status.url ? (
          <button
            onClick={() => void navigator.clipboard.writeText(status.url!)}
            className="flex items-center gap-1.5 rounded-brand border border-border-subtle px-2.5 py-1 tnum text-[13px] text-text hover:border-text-subtle"
          >
            {status.url}
            <Icon name="content_copy" size={13} />
          </button>
        ) : null}
        {!busy && (
          <Button
            variant={status?.enabled ? "ghost" : "primary"}
            disabled={busy}
            onClick={toggle}
            className="!px-2.5 !py-1 !text-[11.5px]"
          >
            <Icon name={status?.enabled ? "link_off" : "link"} size={12} />
            {status?.enabled ? "Disconnect" : "Connect"}
          </Button>
        )}
      </div>
      {showWarning && (
        <div className="flex items-start gap-2 rounded-brand border border-warning/30 bg-warning/5 px-3 py-2 text-[12px] text-warning">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 space-y-0.5">
            {!status?.hasAuth && (
              <p>No API keys — <a href="/keys" className="font-medium underline underline-offset-2">add in Access Keys</a> before enabling tunnel.</p>
            )}
            {status?.isDefaultPassword && (
              <p>Default password — <a href="/config" className="font-medium underline underline-offset-2">change in Settings</a> before enabling tunnel.</p>
            )}
          </div>
          <button onClick={dismiss} className="shrink-0 p-0.5 rounded hover:bg-warning/10 text-warning/60 hover:text-warning">
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-[11px] text-danger">{err}</p>}
    </div>
  );
}
