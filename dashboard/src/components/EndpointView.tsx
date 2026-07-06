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
  const [hr, setHr] = useState<HeadroomStatusReply | null>(null);

  const reload = useCallback(async () => {
    const r = await adminApi.endpoint();
    if (!r.ok) {
      setError(r.error ?? "could not reach the gateway");
      return;
    }
    setError("");
    setEp(r.data);
  }, []);

  const reloadHr = useCallback(async () => {
    const r = await adminApi.headroomStatus();
    if (r.ok) setHr(r.data);
  }, []);

  useEffect(() => {
    void reload();
    void reloadHr();
  }, [reload, reloadHr]);

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

        {/* Headroom */}
        <HeadroomCard
          ep={ep}
          hr={hr}
          refresh={async () => {
            await reload();
            await reloadHr();
          }}
        />
      </div>
    </div>
  );
}

function HeadroomCard({
  ep,
  hr,
  refresh,
}: {
  ep: EndpointPayload;
  hr: HeadroomStatusReply | null;
  refresh: () => Promise<void>;
}) {
  const h = ep.headroom;
  const [url, setUrl] = useState(h.url);
  const [localBusy, setLocalBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setUrl(h.url), [h.url]);

  async function act(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setLocalBusy(label);
    setMsg("");
    setCheck(null);
    const r = await fn();
    setLocalBusy("");
    if (!r.ok) setMsg(r.error ?? "action failed");
    await refresh();
  }

  async function checkProxy() {
    setLocalBusy("check");
    setMsg("");
    setCheck(null);
    const r = await adminApi.headroomStatus();
    setLocalBusy("");
    await refresh();
    if (!r.ok || !r.data) {
      setCheck({ ok: false, text: r.error ?? "could not reach the gateway" });
      return;
    }
    setCheck(
      r.data.running
        ? { ok: true, text: `proxy is up at ${r.data.url}` }
        : { ok: false, text: `no proxy responding at ${r.data.url}` },
    );
  }

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
        {/* left: status + toggles */}
        <div className="border-b border-border-subtle px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <Pill $tone={hr?.installed ? "live" : "neutral"}>{hr?.installed ? "installed" : "not installed"}</Pill>
            <Pill $tone={hr?.running ? "live" : "warn"}>{hr?.running ? "running" : "down"}</Pill>
            <Pill $tone={hr?.python ? "info" : "neutral"}>{hr?.python ? `py ${hr.python}` : "no py ≥3.10"}</Pill>
            {hr?.managedPid ? <span className="tnum text-text-subtle">pid {hr.managedPid}</span> : null}
          </div>

          <div className="mt-4 space-y-3">
            {hr && !hr.running && (
              <div className="flex items-center gap-2 rounded-brand border border-accent/20 bg-accent/5 px-3 py-2 text-[12px] text-text-subtle">
                <Icon name="info" size={14} className="flex-none text-accent" />
                <span>Start the proxy first, then enable compression.</span>
              </div>
            )}
            <ToggleRow
              label="Enable"
              desc="Compress context through proxy before each request."
              on={h.enabled}
              busy={localBusy === "enable"}
              disabled={!hr?.running && !h.enabled}
              onChange={(v) => act("enable", () => adminApi.setHeadroom({ enabled: v }))}
            />
            <div className="h-px bg-border-subtle" />
            <ToggleRow
              label="Compress user msgs"
              desc="Also squeeze user turns, not just tool/assistant context."
              on={h.compress_user_messages}
              busy={localBusy === "cum"}
              disabled={!hr?.running && !h.enabled}
              onChange={(v) => act("cum", () => adminApi.setHeadroom({ compress_user_messages: v }))}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              disabled={!hr?.canStart || hr?.running || !!localBusy}
              onClick={async () => {
                await act("start", () => adminApi.headroomStart());
                await checkProxy();
              }}
            >
              <Icon name={localBusy === "start" ? "sync" : "play_arrow"} size={16} className={localBusy === "start" ? "animate-spin" : ""} />
              {localBusy === "start" ? "Starting…" : "Start"}
            </Button>
            <Button
              variant="danger"
              disabled={!hr?.managedPid || localBusy === "stop"}
              onClick={() => act("stop", () => adminApi.headroomStop())}
            >
              <Icon name="stop" size={16} /> Stop
            </Button>
            <Button variant="ghost" disabled={localBusy === "check"} onClick={checkProxy}>
              <Icon name="sync" size={16} /> {localBusy === "check" ? "Checking…" : "Check"}
            </Button>
          </div>

          {hr && !hr.installed && (
            <p className="mt-3 text-[11px] text-text-subtle">
              Get it from{" "}
              <a href="https://github.com/chopratejas/headroom" target="_blank" rel="noreferrer" className="text-accent hover:underline">
                chopratejas/headroom
              </a>{" "}
              (Python ≥ 3.10):{" "}
              <code className="rounded bg-surface-2 px-1">pipx install git+https://github.com/chopratejas/headroom</code>
            </p>
          )}
          {hr?.installed && !hr.localUrl && (
            <p className="mt-3 text-[11px] text-text-subtle">URL isn't loopback — start that proxy yourself.</p>
          )}

          {msg && <p className="mt-2 text-[12px] text-danger">{msg}</p>}
          {check && (
            <p className={`mt-2 flex items-center gap-1 text-[12px] ${check.ok ? "text-success" : "text-danger"}`}>
              <Icon name={check.ok ? "check_circle" : "error"} size={14} /> {check.text}
            </p>
          )}
        </div>

        {/* right: URL input */}
        <div className="px-5 py-4">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Proxy URL</div>
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:8787" className="font-mono text-[13px]" />
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              disabled={url.trim() === h.url || localBusy === "url"}
              onClick={() => act("url", () => adminApi.setHeadroom({ url: url.trim() }))}
            >
              Save URL
            </Button>
          </div>
        </div>
      </div>
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
