"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Button, Input, Field } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { ModelPicker, type ModelGroup } from "@/components/ModelPicker";
import type { BudgetStatus, ModelsPayload } from "@/lib/gateway";

const WINDOWS = ["5h", "24h", "7day", "30day", "lifetime"] as const;
const WINDOW_LABELS: Record<string, string> = {
  "5h": "5H",
  "24h": "24H",
  "7day": "7D",
  "30day": "30D",
  lifetime: "Lifetime",
};
type ScopeType = "global" | "provider" | "model";

/** Segment-pill button style — selected = accent, matches the Unit toggle. */
const pill = (active: boolean): string =>
  `rounded-brand px-3 py-1.5 text-[13px] font-medium transition-colors ${
    active ? "bg-accent/12 text-accent" : "bg-surface-2 text-text-muted hover:text-text"
  }`;

/**
 * A labelled field group for BUTTON controls. Unlike `Field` (a <label>, which
 * forwards a pointer click to its first control and would swallow pill clicks),
 * this is a plain <div> so each pill button receives its own click.
 */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">{label}</span>
      {children}
    </div>
  );
}

const SCOPES: { id: ScopeType; icon: string; label: string; hint: string }[] = [
  { id: "global", icon: "public", label: "Global", hint: "Cap total spend across the whole gateway." },
  { id: "provider", icon: "dns", label: "Per provider", hint: "Cap one provider's spend." },
  { id: "model", icon: "neurology", label: "Per model", hint: "Cap one upstream model's spend." },
];

/**
 * Inline Add / Edit panel for a scoped budget — same shape as the "Add a
 * provider" flow: step 1 picks the scope (card grid, add only), step 2 is the
 * field set. Editing jumps straight to step 2 with the scope locked (the scope
 * is the budget's identity); every other field stays editable.
 */
export function BudgetForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: BudgetStatus | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = initial !== null;
  const [scopeType, setScopeType] = useState<ScopeType | null>(
    initial && initial.scope.type !== "key" ? initial.scope.type : null,
  );
  const [scopeId, setScopeId] = useState(
    initial && initial.scope.type !== "global" && initial.scope.type !== "key" ? initial.scope.id : "",
  );
  const [catalog, setCatalog] = useState<ModelsPayload | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unit, setUnit] = useState<"usd" | "tokens">(initial?.unit ?? "usd");
  const [limit, setLimit] = useState(String(initial?.limit ?? ""));
  const [window, setWindow] = useState<string>(initial?.window ?? "30day");
  const [customWindow, setCustomWindow] = useState("");
  const [alertAt, setAlertAt] = useState(initial ? String(Math.round(initial.alert_at * 100)) : "80");
  const [note, setNote] = useState(initial?.note ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void adminApi.models().then((r) => { if (r.ok && r.data) setCatalog(r.data); });
  }, []);

  const providerGroups: ModelGroup[] = catalog?.providers.length
    ? [{ label: "Providers", items: catalog.providers.map((p) => ({ value: p.id, label: p.id })) }]
    : [];
  // one entry per distinct upstream model id (a budget keys on usage.model), grouped by provider.
  const modelGroups: ModelGroup[] = (catalog?.providers ?? [])
    .filter((p) => p.models.length > 0)
    .map((p) => ({ label: p.id, items: p.models.map((m) => ({ value: m.id, label: m.id })) }));
  const scopeIdLabel = scopeId;

  async function save() {
    const limitNum = Number(limit);
    if (!Number.isFinite(limitNum) || limitNum <= 0) return setError("limit must be a positive number");
    const alertPct = Number(alertAt);
    if (!Number.isFinite(alertPct) || alertPct <= 0 || alertPct > 100) return setError("alert % must be 1–100");
    if (scopeType !== "global" && !scopeId.trim()) return setError(`pick a ${scopeType}`);
    const scope =
      scopeType === "global" ? { type: "global" as const } : { type: scopeType!, id: scopeId.trim() };
    setSaving(true);
    setError("");
    try {
      const r = await adminApi.setBudget({ scope, unit, limit: limitNum, window: customWindow || window, alert_at: alertPct / 100, note: note.trim() || undefined });
      if (!r.ok) return setError(r.error ?? "could not save budget");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const panel = "mb-5 rounded-brand-lg card p-5";

  // step 1 (add only): pick the scope.
  if (scopeType === null) {
    return (
      <div className={panel}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold text-text">Add a budget</h2>
            <p className="mt-0.5 text-[13px] text-text-muted">Pick what this budget caps — the rest is one short form.</p>
          </div>
          <button type="button" onClick={onCancel} className="flex-none text-text-subtle hover:text-text" aria-label="Cancel">
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => { setScopeType(s.id); setScopeId(""); }}
              className="group flex items-start gap-3 rounded-brand-lg border border-border bg-bg p-4 text-left transition-colors hover:border-accent hover:bg-accent-soft"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-brand bg-surface-2 text-text-muted group-hover:text-accent">
                <Icon name={s.icon} size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-text">{s.label}</span>
                <span className="mt-1 block text-[12px] text-text-muted">{s.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  const scopeMeta = SCOPES.find((s) => s.id === scopeType)!;

  // step 2: the field set.
  return (
    <div className={panel}>
      <div className="mb-4 flex items-center gap-2.5 border-b border-border-subtle pb-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-brand bg-surface-2 text-text-muted">
          <Icon name={scopeMeta.icon} size={17} />
        </span>
        <div>
          <div className="text-[14px] font-semibold text-text">{editing ? "Edit budget" : scopeMeta.label}</div>
          <div className="tnum text-[11px] text-text-subtle">
            {scopeType === "global" ? "whole gateway" : `${scopeType} · ${editing ? initial!.label : scopeIdLabel || "—"}`}
          </div>
        </div>
        {editing ? null : (
          <button
            type="button"
            onClick={() => { setScopeType(null); setError(""); }}
            className="ml-auto inline-flex items-center gap-1 rounded-brand border border-border bg-surface-2 px-2.5 py-1 text-[12px] font-medium text-text-muted transition-colors hover:border-text-subtle hover:bg-surface-3 hover:text-text"
          >
            <Icon name="arrow_back" size={14} /> change scope
          </button>
        )}
      </div>

      <div className="space-y-3">
        {/* scope target — only when adding; editing locks the scope (shown in the header) */}
        {!editing && scopeType !== "global" && (
          <Group label={scopeType === "provider" ? "Provider" : scopeType === "model" ? "Model" : "API key"}>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex w-full items-center justify-between rounded-brand border border-border bg-bg px-3 py-2 text-left text-[13px] transition-colors hover:border-accent"
            >
              <span className={scopeId ? "text-text" : "text-text-subtle"}>
                {scopeId ? scopeIdLabel : scopeType === "provider" ? "Choose a provider…" : scopeType === "model" ? "Choose a model…" : "Choose an API key…"}
              </span>
              <Icon name="search" size={15} className="text-text-subtle" />
            </button>
          </Group>
        )}

        <Group label="Unit">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setUnit("usd")} className={pill(unit === "usd")}>USD</button>
            <button type="button" onClick={() => setUnit("tokens")} className={pill(unit === "tokens")}>Tokens</button>
          </div>
        </Group>
        <Field label="Limit" hint={unit === "usd" ? "$" : "tokens"}>
          <Input value={limit} onChange={(e) => setLimit(e.target.value)} inputMode="decimal" placeholder={unit === "usd" ? "50.00" : "1000000"} />
        </Field>
        <Group label="Window">
          <div className="flex flex-wrap items-center gap-2">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => { setWindow(w); setCustomWindow(""); }}
                className={pill(window === w && !customWindow)}
                title={w === "lifetime" ? "One-shot total — never refills" : undefined}
              >
                {WINDOW_LABELS[w]}
              </button>
            ))}
            <input
              value={customWindow}
              onChange={(e) => setCustomWindow(e.target.value)}
              placeholder="custom"
              className="w-20 rounded-brand border border-border bg-bg px-2 py-1.5 text-[13px] text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
            />
            <span className="text-[11px] text-text-subtle">e.g. 1h, 12h, 90day</span>
          </div>
        </Group>
        <Group label="Alert at">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.max(0, Math.min(100, Number(alertAt) || 0))}
              onChange={(e) => setAlertAt(e.target.value)}
              className="range-accent flex-1"
              style={{
                background: `linear-gradient(to right, var(--color-accent) ${Math.max(0, Math.min(100, Number(alertAt) || 0))}%, var(--color-surface-2) ${Math.max(0, Math.min(100, Number(alertAt) || 0))}%)`,
              }}
              aria-label="Alert threshold percent"
            />
            <div className="relative w-16 flex-none">
              <Input
                value={alertAt}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d]/g, "");
                  if (v === "") return setAlertAt("");
                  setAlertAt(String(Math.max(0, Math.min(100, Number(v)))));
                }}
                inputMode="numeric"
                className="pr-5 text-center tnum"
                aria-label="Alert threshold percent (type)"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-text-subtle">%</span>
            </div>
          </div>
          <p className="text-[11px] text-text-subtle">Warn once spend crosses this share of the limit.</p>
        </Group>
        <Field label="Note" hint="optional">
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. client X cap" />
        </Field>
      </div>

      {error && <div className="mt-2 text-[12px] text-danger">{error}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={saving} onClick={save}>{saving ? "Saving…" : editing ? "Save changes" : "Add budget"}</Button>
      </div>

      {pickerOpen && scopeType !== "global" && (
        <ModelPicker
          title={scopeType === "provider" ? "Select a provider" : "Select a model"}
          note={`Click a ${scopeType} to scope this budget to it.`}
          searchPlaceholder={scopeType === "provider" ? "Search providers…" : "Search models…"}
          groups={scopeType === "provider" ? providerGroups : modelGroups}
          selected={scopeId ? [scopeId] : []}
          onToggle={(v) => { setScopeId(v); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
          singleSelect
        />
      )}
    </div>
  );
}
