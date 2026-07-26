"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Icon, IconBadge } from "@/components/Icon";
import { Empty, LoadingDots } from "@/components/ui";
import { PasswordEditor } from "@/components/PasswordEditor";
import { AutostartToggle } from "@/components/AutostartToggle";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { stringify } from "yaml";
import type { MaskedConfig } from "@/lib/gateway";

export function ConfigEditor() {
  const [text, setText] = useState("");
  const [original, setOriginal] = useState("");
  const [info, setInfo] = useState<MaskedConfig["server"] | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/gw/admin/config");
    if (!res.ok) {
      setError("could not reach the gateway");
      setLoading(false);
      return;
    }
    const cfg = (await res.json()) as MaskedConfig;
    const yaml = stringify(cfg);
    setText(yaml);
    setOriginal(yaml);
    setInfo(cfg.server);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const res = await fetch("/api/gw/admin/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setBusy(false);
    if (res.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await reload();
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "validation failed");
    }
  }

  const fileInput = useRef<HTMLInputElement>(null);

  function exportConfig() {
    const a = document.createElement("a");
    a.href = "/api/gw/admin/config/export";
    a.download = "aigloo-config.yaml";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function importFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setText(await file.text());
    setError("");
  }

  const dirty = text !== original;
  const keyCount = info?.api_keys.length ?? 0;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Settings</h1>
      </div>

      {/* 2-col layout */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* LEFT: instance + security */}
        <div className="space-y-4">
          {/* instance */}
          <div className="overflow-hidden rounded-brand-lg card">
            <div className="flex items-center gap-3 border-b border-border-subtle px-5 py-3">
              <IconBadge name="dns" tone="info" />
              <div>
                <h2 className="text-[14px] font-semibold text-text">Instance</h2>
                <p className="text-[12px] text-text-muted">read-only</p>
              </div>
            </div>
            <div className="space-y-2.5 px-5 py-4 text-[13px]">
              {info ? (
                <>
                  <Row label="Listen address">
                    <span className="tnum text-text">{info.host}:{info.port}</span>
                  </Row>
                  <Row label="Gateway auth">
                    <Badge tone={keyCount > 0 ? "live" : "warn"}>
                      {keyCount > 0 ? `${keyCount} key${keyCount > 1 ? "s" : ""}` : "disabled"}
                    </Badge>
                  </Row>
                  <Row label="Admin password">
                    <span className="text-text-subtle">seeded from env</span>
                  </Row>
                </>
              ) : (
                <LoadingDots />
              )}
            </div>
          </div>

          <PasswordEditor />
          <AutostartToggle />
          <AuditLogPanel />
        </div>

        {/* RIGHT: pricing + backup */}
        <div className="space-y-4">
          {/* pricing */}
          <div className="overflow-hidden rounded-brand-lg card">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge name="sell" tone="accent" />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-semibold text-text">Pricing</h2>
                  <p className="text-[12px] text-text-muted">per-model $/1M overrides</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/pricing" className="inline-flex items-center justify-center gap-1.5 rounded-brand px-3.5 py-2 text-[13px] font-medium transition-all duration-150 cursor-pointer glass text-text-muted border-transparent hover:text-text whitespace-nowrap">
                  <Icon name="arrow_forward" size={14} /> Configure
                </Link>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] text-text-muted">
                Override the auto-resolved rate per model, per provider — or set a global override across every provider.
              </p>
            </div>
          </div>

          {/* notifications */}
          <div className="overflow-hidden rounded-brand-lg card">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge name="notifications" tone="info" />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-semibold text-text">Alerts &amp; Notifications</h2>
                  <p className="text-[12px] text-text-muted">webhook · telegram · discord</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/notifications" className="inline-flex items-center justify-center gap-1.5 rounded-brand px-3.5 py-2 text-[13px] font-medium transition-all duration-150 cursor-pointer glass text-text-muted border-transparent hover:text-text whitespace-nowrap">
                  <Icon name="arrow_forward" size={14} /> Configure
                </Link>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] text-text-muted">
                Configure webhook, Telegram, or Discord notifications to get alerted when budgets hit their threshold or run out.
              </p>
            </div>
          </div>

          {/* backup */}
          <div className="overflow-hidden rounded-brand-lg card">
            <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <IconBadge name="backup" tone="success" />
                <div className="min-w-0">
                  <h2 className="text-[14px] font-semibold text-text">Backup</h2>
                  <p className="text-[12px] text-text-muted">full config including real keys</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileInput} type="file" accept=".yaml,.yml,.json,text/*" className="hidden" onChange={importFile} />
                <Button variant="ghost" disabled={busy} onClick={exportConfig} title="Download the full config (includes real keys)">
                  <Icon name="download" size={14} /> Export
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => fileInput.current?.click()} title="Load a backup file into the Advanced editor">
                  <Icon name="upload" size={14} /> Import
                </Button>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] text-text-muted">
                Export downloads the live config as YAML with unmasked keys — keep it safe. Import loads a file into
                the raw editor below for review; it only applies when you Save there.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced — full width below */}
      <details className="group mt-4 overflow-hidden rounded-brand-lg card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Advanced — raw config</h2>
            <p className="text-[12px] text-text-muted">YAML, validated + hot-reloaded on save</p>
          </div>
          <span className="flex items-center gap-2">
            {dirty && <span className="text-[12px] text-warning">unsaved changes</span>}
            {saved && (
              <span className="flex items-center gap-1 text-[12px] text-success">
                <Icon name="check" size={14} /> saved
              </span>
            )}
            <Icon name="expand_more" size={18} className="text-text-subtle transition-transform group-open:rotate-180" />
          </span>
        </summary>

        <div className="border-t border-border-subtle px-5 py-4">
          <div className="mb-3 flex items-center justify-end gap-2">
            <Button variant="ghost" disabled={!dirty || busy} onClick={() => setText(original)}>Revert</Button>
            <Button disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save & reload"}</Button>
          </div>
          {error && (
            <pre className="mb-3 overflow-x-auto whitespace-pre-wrap rounded-brand border border-danger/40 bg-danger/8 px-3 py-2 text-[12px] text-danger">
              {error}
            </pre>
          )}
          {loading ? (
            <LoadingDots />
          ) : (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              className="h-[55vh] w-full resize-none rounded-brand border border-border bg-bg p-4 font-mono text-[13px] leading-relaxed text-text focus:border-accent focus:outline-none"
            />
          )}
        </div>
      </details>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-text-subtle">{label}</span>
      {children}
    </div>
  );
}
