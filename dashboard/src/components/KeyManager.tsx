"use client";

import { useEffect, useState, useCallback } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { Empty, LoadingDots } from "@/components/ui";
import { ConfirmModal } from "@/components/ConfirmModal";
import { KeyScopeModal } from "@/components/KeyScopeModal";
import type { EndpointPayload, MaskedConfig } from "@/lib/gateway";
import type { ModelGroup } from "@/components/ModelPicker";

function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `aig-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function KeyManager() {
  const [ep, setEp] = useState<EndpointPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [keyName, setKeyName] = useState("");
  const [created, setCreated] = useState<{ key: string; name: string } | null>(null);
  const [pendingDel, setPendingDel] = useState<{ i: number; label: string } | null>(null);
  const [scopeKey, setScopeKey] = useState<number | null>(null);
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [keyBudgets, setKeyBudgets] = useState<Record<string, { limit: number; window: string }>>({});

  const reload = useCallback(async () => {
    const [r, br] = await Promise.all([
      adminApi.endpoint(),
      adminApi.budgets(),
    ]);
    if (!r.ok) { setError(r.error ?? "could not reach gateway"); return; }
    setError("");
    setEp(r.data);
    if (br.ok && br.data) {
      const map: Record<string, { limit: number; window: string }> = {};
      for (const b of br.data.budgets) {
        if (b.scope.type === "key") map[b.scope.id] = { limit: b.limit, window: b.window };
      }
      setKeyBudgets(map);
    }
  }, []);

  useEffect(() => {
    void reload();
    void (async () => {
      try {
        const res = await fetch("/api/gw/admin/config");
        if (!res.ok) return;
        const cfg = (await res.json()) as MaskedConfig;
        const grps: ModelGroup[] = [];
        if (cfg.models.length) grps.push({ label: "Combos", items: cfg.models.map((m) => ({ value: m.alias, label: m.alias })) });
        for (const p of cfg.providers) {
          if (p.models.length) grps.push({ label: p.id, items: p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.id}/${m.id}` })) });
        }
        setGroups(grps);
      } catch { /* non-critical */ }
    })();
  }, [reload]);

  async function run(label: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(label);
    const r = await fn();
    setBusy("");
    if (!r.ok) setError(r.error ?? "action failed");
    else { setError(""); await reload(); }
  }

  async function addKey(label: string, rawKey: string) {
    const name = label.trim();
    if (name && ep && ep.keys.some((k) => k.name === name)) {
      setError(`Key name "${name}" already exists`);
      return;
    }
    setBusy("genkey");
    const r = await adminApi.addServerKey(rawKey, name || undefined);
    setBusy("");
    if (!r.ok) { setError(r.error ?? "could not add key"); return; }
    setError("");
    setKeyName("");
    setCreated({ key: rawKey, name });
    await reload();
  }

  if (!ep) return <LoadingDots />;

  const activeKey = scopeKey !== null ? ep.keys[scopeKey] : null;
  const filtered = ep.keys.filter((k) => {
    if (!keyName) return true;
    return (k.name ?? "").toLowerCase().includes(keyName.toLowerCase()) || k.key.toLowerCase().includes(keyName.toLowerCase());
  });

  const activeCount = ep.keys.filter((k) => !k.expires || Date.now() < k.expires).length;
  const expiredCount = ep.keys.length - activeCount;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Access Keys</h1>
        </div>
        <div className="flex items-center gap-2">
          <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Search or name new key…" className="w-52" />
          <Button disabled={busy === "genkey"} onClick={() => addKey(keyName, generateKey())} className="whitespace-nowrap">
            <Icon name="add" size={16} />{busy === "genkey" ? "Adding…" : "Add key"}
          </Button>
        </div>
      </div>

      {/* stats strip */}
      {ep.keys.length > 0 && (
        <div className="mb-5 grid grid-cols-3 gap-3">
          <StatBlock label="Total" value={ep.keys.length} icon="key" />
          <StatBlock label="Active" value={activeCount} icon="check_circle" tone="success" />
          <StatBlock label="Expired" value={expiredCount} icon="schedule" tone={expiredCount > 0 ? "danger" : "neutral"} />
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-center justify-between gap-2 rounded-brand border border-danger/30 bg-danger/8 px-4 py-2.5 text-[13px] text-danger">
          <span>{error}</span>
          <button onClick={() => setError("")} className="hover:text-text"><Icon name="close" size={15} /></button>
        </div>
      )}

      {ep.keys.length === 0 ? (
        <Empty>No keys — auth is DISABLED (localhost only). Add one above.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {filtered.length === 0 ? (
            <div className="col-span-full px-1 py-8 text-center text-[13px] text-text-muted">No keys match "{keyName}"</div>
          ) : (
            filtered.map((k) => {
              const i = ep.keys.indexOf(k);
              const expired = !!k.expires && Date.now() > k.expires;
              const budget = keyBudgets[k.fingerprint];
              return (
                <div
                  key={i}
                  className={`group card rounded-brand-lg p-0 overflow-hidden transition-[box-shadow,opacity] duration-150 ${expired ? "opacity-60" : ""}`}
                >
                  {/* top: name + status */}
                  <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 flex-none rounded-full ${expired ? "bg-danger" : "bg-success"}`}
                        style={{ boxShadow: expired ? "none" : "0 0 6px 1px var(--color-success)" }}
                      />
                      <span className="truncate text-[16px] font-bold text-text">{k.name || "Unnamed key"}</span>
                    </div>
                    <span className={`flex-none text-[11px] font-semibold uppercase tracking-wider ${expired ? "text-danger" : "text-success"}`}>
                      {expired ? "Expired" : "Active"}
                    </span>
                  </div>

                  {/* key reveal */}
                  <div className="px-5 pb-3">
                    <KeyRevealInline
                      masked={k.key}
                      reveal={async () => { const r = await adminApi.revealServerKey(i); return r.ok ? r.data?.key ?? null : null; }}
                    />
                  </div>

                  {/* meta badges */}
                  <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                    <MetaChip icon="layers" label={k.models?.length ? `${k.models.length} models` : "all models"} />
                    {k.rpm && <MetaChip icon="speed" label={`${k.rpm}/min`} />}
                    {budget && (
                      <MetaChip
                        icon="payments"
                        label={
                          budget.window === "lifetime"
                            ? `$${budget.limit} lifetime`
                            : `$${budget.limit}/${budget.window.replace("day", "D").replace("h", "H")}`
                        }
                        accent
                      />
                    )}
                    {k.expires && <MetaChip icon="event" label={`exp ${new Date(k.expires).toLocaleDateString("en-GB")}`} />}
                  </div>

                  {/* actions */}
                  <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-2.5">
                    <button
                      onClick={() => setScopeKey(i)}
                      className="inline-flex items-center gap-1.5 rounded-brand px-3 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-surface-3 hover:text-text"
                    >
                      <Icon name="edit" size={14} /> Edit scope
                    </button>
                    <button
                      onClick={() => setPendingDel({ i, label: k.name || k.key })}
                      className="inline-flex items-center gap-1.5 rounded-brand px-3 py-1.5 text-[12px] font-medium text-text-muted transition-colors hover:bg-danger/10 hover:text-danger ml-auto"
                    >
                      <Icon name="delete" size={14} /> Remove
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {scopeKey !== null && activeKey && (
        <KeyScopeModal
          keyIndex={scopeKey}
          k={activeKey}
          fingerprint={activeKey.fingerprint}
          groups={groups}
          keyBudget={keyBudgets[activeKey.fingerprint]}
          onClose={() => setScopeKey(null)}
          onSave={() => { setScopeKey(null); void reload(); }}
        />
      )}

      {created && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={() => setCreated(null)}>
          <div className="w-full max-w-lg rounded-brand-lg glass-strong modal-card p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-2 text-[14px] font-semibold text-text">Key created — copy it now</h2>
            <p className="mb-3 text-[12px] text-text-muted">Copy your key now. You can reveal it later, but storing it saves time.</p>
            <div className="flex items-center gap-2 rounded-brand bg-bg px-3 py-2">
              <code className="flex-1 truncate text-[12px] text-text">{created.key}</code>
              <button onClick={() => void navigator.clipboard.writeText(created.key)} className="text-text-subtle hover:text-text"><Icon name="content_copy" size={14} /></button>
            </div>
            <Button className="mt-4 w-full" onClick={() => setCreated(null)}>Done</Button>
          </div>
        </div>
      )}

      {pendingDel && (
        <ConfirmModal
          title="Remove key?"
          message={`"${pendingDel.label}" will stop working immediately.`}
          confirmLabel="Remove"
          busy={busy === `delkey${pendingDel.i}`}
          onConfirm={() => run(`delkey${pendingDel.i}`, async () => { const r = await adminApi.removeServerKey(pendingDel.i); if (r.ok) setPendingDel(null); return r; })}
          onCancel={() => setPendingDel(null)}
        />
      )}
    </div>
  );
}

function StatBlock({ label, value, icon, tone }: { label: string; value: number; icon: string; tone?: "success" | "danger" | "neutral" }) {
  const color = tone === "success" ? "var(--color-success)" : tone === "danger" ? "var(--color-danger)" : "var(--color-accent)";
  return (
    <div className="card rounded-brand-lg px-5 py-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">{label}</div>
        <Icon name={icon} size={16} className="text-text-subtle" />
      </div>
      <div className="mt-0.5 tnum text-[24px] font-bold tracking-tight" style={{ color: value > 0 ? color : "var(--color-text)" }}>{value}</div>
    </div>
  );
}

function MetaChip({ icon, label, accent }: { icon: string; label: string; accent?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${accent ? "bg-accent-soft text-accent" : "bg-surface-2 text-text-muted"}`}>
      <Icon name={icon} size={12} />
      {label}
    </span>
  );
}

function KeyRevealInline({ masked, reveal }: { masked: string; reveal: () => Promise<string | null> }) {
  const [real, setReal] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function toggle() {
    if (shown) { setShown(false); return; }
    if (real === null) {
      setLoading(true);
      const k = await reveal();
      setLoading(false);
      if (k === null) return;
      setReal(k);
    }
    setShown(true);
  }

  return (
    <div className="flex items-center gap-2 rounded-brand border border-border-subtle bg-bg/50 px-3 py-2">
      <button
        onClick={toggle}
        disabled={loading}
        className="flex flex-none items-center justify-center text-text-muted transition-colors hover:text-accent disabled:opacity-40"
        aria-label={shown ? "Hide key" : "Show key"}
        title={shown ? "Hide key" : "Show key"}
      >
        <Icon name={loading ? "hourglass_empty" : shown ? "visibility_off" : "visibility"} size={16} />
      </button>
      <code className={`flex-1 truncate tnum text-[13px] ${shown ? "text-text break-all" : "text-text-subtle"}`}>
        {shown && real ? real : masked}
      </code>
      {shown && real && (
        <button
          onClick={() => { void navigator.clipboard.writeText(real); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
          className="flex-none text-text-subtle transition-colors hover:text-text"
          title="Copy"
        >
          <Icon name={copied ? "check" : "content_copy"} size={14} />
        </button>
      )}
    </div>
  );
}
