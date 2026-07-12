"use client";

import { useState, useEffect } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ModelPicker, type ModelGroup } from "@/components/ModelPicker";
import { fmt } from "@/components/ui";
import type { EndpointPayload } from "@/lib/gateway";

type ServerKey = EndpointPayload["keys"][number];

const DAY_MS = 86_400_000;
const EXPIRY_MS: Record<"24h" | "7day" | "30day", number> = {
  "24h": DAY_MS,
  "7day": 7 * DAY_MS,
  "30day": 30 * DAY_MS,
};

const pill = (active: boolean) =>
  `rounded-brand px-3 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "bg-accent/12 text-accent" : "bg-surface-2 text-text-muted hover:text-text"
  }`;

export interface KeyScopeModalProps {
  keyIndex: number;
  k: ServerKey;
  fingerprint: string;
  groups: ModelGroup[];
  keyBudget: { limit: number; window: string } | undefined;
  onClose: () => void;
  onSave: () => void;
}

export function KeyScopeModal({ keyIndex, k, fingerprint, groups, keyBudget, onClose, onSave }: KeyScopeModalProps) {
  const [keyName, setKeyName] = useState(k.name ?? "");
  const [scopeModels, setScopeModels] = useState<string[]>(k.models ?? []);
  const [scopeRpm, setScopeRpm] = useState(k.rpm ? String(k.rpm) : "");
  const [scopeExpiry, setScopeExpiry] = useState<"keep" | "never" | "24h" | "7day" | "30day" | "custom">(k.expires ? "keep" : "never");
  const [scopeCustomDays, setScopeCustomDays] = useState("");
  const [scopeLimit, setScopeLimit] = useState(keyBudget ? String(keyBudget.limit) : "");
  const [scopeWindow, setScopeWindow] = useState<string>(keyBudget?.window ?? "30day");
  const [scopeCustomWindow, setScopeCustomWindow] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!keyBudget && (scopeExpiry === "24h" || scopeExpiry === "7day" || scopeExpiry === "30day")) {
      setScopeWindow(scopeExpiry);
    }
  }, [scopeExpiry, keyBudget]);

  async function save() {
    setBusy(true);
    setError("");
    const trimmedName = keyName.trim();
    if (trimmedName !== (k.name ?? "")) {
      const rn = await adminApi.editServerKey(keyIndex, trimmedName);
      if (!rn.ok) { setError(rn.error ?? "rename failed"); setBusy(false); return; }
    }
    const expires =
      scopeExpiry === "keep" ? undefined
      : scopeExpiry === "never" ? null
      : scopeExpiry === "custom" ? (scopeCustomDays ? Date.now() + Number(scopeCustomDays) * DAY_MS : null)
      : Date.now() + EXPIRY_MS[scopeExpiry];
    const r = await adminApi.setServerKeyScope(keyIndex, {
      models: scopeModels,
      rpm: scopeRpm ? Number(scopeRpm) : null,
      expires,
    });
    if (!r.ok) { setError(r.error ?? "save failed"); setBusy(false); return; }
    const limit = scopeLimit ? Number(scopeLimit) : 0;
    if (limit > 0) {
      await adminApi.setBudget({ scope: { type: "key", id: fingerprint }, unit: "usd", limit, window: scopeCustomWindow || scopeWindow });
    } else if (keyBudget) {
      await adminApi.clearBudget(`key:${fingerprint}`);
    }
    setBusy(false);
    onSave();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-brand-lg glass-strong modal-card p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Edit key scope</h2>
            <p className="text-[12px] text-text-subtle font-mono mt-0.5">{k.name ? `${k.name} · ` : ""}{k.key}</p>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text"><Icon name="close" size={17} /></button>
        </div>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Key name</div>
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Unnamed key" />
          </div>

          {/* Model allowlist */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Allowed models</div>
            <div className="flex flex-wrap items-center gap-1.5">
              {scopeModels.length === 0 ? (
                <span className="text-[12px] text-text-subtle">All models (unrestricted)</span>
              ) : (
                scopeModels.map((m) => (
                  <span key={m} className="inline-flex items-center gap-1 rounded border border-accent bg-accent-soft px-2 py-0.5 text-[12px] text-accent">
                    <span className="tnum">{m}</span>
                    <button onClick={() => setScopeModels((s) => s.filter((x) => x !== m))} className="hover:text-danger"><Icon name="close" size={12} /></button>
                  </span>
                ))
              )}
            </div>
            <Button type="button" variant="ghost" className="mt-1.5" onClick={() => setPickerOpen(true)}>
              <Icon name="add" size={15} /> Pick models
            </Button>
          </div>

          {/* Rate limit */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Rate limit</div>
            <div className="flex items-center gap-2">
              <Input inputMode="numeric" value={scopeRpm} onChange={(e) => setScopeRpm(e.target.value.replace(/[^\d]/g, ""))} placeholder="req/min (blank = unlimited)" className="flex-1" />
            </div>
          </div>

          {/* Expiry */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Access expiry</div>
            {k.expires && (
              <div className="mb-1.5 text-[11px] text-text-subtle">
                currently {Date.now() > k.expires ? <span className="text-danger">expired</span> : `expires ${fmt.date(k.expires)}`}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {(k.expires
                ? (["keep", "never", "24h", "7day", "30day", "custom"] as const)
                : (["never", "24h", "7day", "30day", "custom"] as const)
              ).map((opt) => (
                <button key={opt} type="button" onClick={() => setScopeExpiry(opt)} className={pill(scopeExpiry === opt)}>
                  {opt === "never" ? "no expiry" : opt}
                </button>
              ))}
            </div>
            {scopeExpiry === "custom" && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <Input inputMode="numeric" value={scopeCustomDays} onChange={(e) => setScopeCustomDays(e.target.value.replace(/[^\d]/g, ""))} placeholder="days" className="w-24" />
                <span className="text-[11px] text-text-subtle">days from now</span>
              </div>
            )}
          </div>

          {/* Budget */}
          <div>
            <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Spend cap (USD)</div>
            <Input inputMode="decimal" value={scopeLimit} onChange={(e) => setScopeLimit(e.target.value.replace(/[^\d.]/g, ""))} placeholder="USD (blank = no cap)" />
            {scopeLimit && (
              <div className="mt-1.5 space-y-1.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-text-subtle">window</span>
                  {(["5h", "24h", "7day", "30day", "lifetime"] as const).map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => { setScopeWindow(w); setScopeCustomWindow(""); }}
                      className={pill(scopeWindow === w && !scopeCustomWindow)}
                      title={w === "lifetime" ? "One-shot total — never refills" : `Resets every ${w}`}
                    >
                      {w === "lifetime" ? "never refills" : w}
                    </button>
                  ))}
                  <input
                    value={scopeCustomWindow}
                    onChange={(e) => { setScopeCustomWindow(e.target.value); setScopeWindow(""); }}
                    placeholder="custom"
                    className="w-16 rounded-brand border border-border bg-bg px-2 py-1 text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                  />
                </div>
                {scopeWindow === "lifetime" && !scopeCustomWindow && (
                  <p className="text-[11px] text-text-subtle">Lifetime cap: all-time spend until the key is removed or the cap is raised.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {error && <p className="mt-3 text-[12px] text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          <Button variant="ghost" onClick={onClose} className="flex-none">Cancel</Button>
          <Button disabled={busy} onClick={save} className="flex-1">{busy ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      {pickerOpen && (
        <ModelPicker
          groups={groups}
          selected={scopeModels}
          onToggle={(m) => { setScopeModels((s) => s.includes(m) ? s.filter((x) => x !== m) : [...s, m]); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
