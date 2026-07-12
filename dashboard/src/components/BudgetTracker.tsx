"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/client";
import { Badge } from "@/components/Badge";
import { CooldownTimer } from "@/components/CooldownTimer";
import { fmt, Empty, LoadingDots } from "@/components/ui";
import { BudgetForm } from "@/components/BudgetForm";
import { ConfirmModal } from "@/components/ConfirmModal";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import type { BudgetStatus, KeyUsageRow } from "@/lib/gateway";

const WINDOW_LABELS: Record<string, string> = {
  "5h": "5H",
  "24h": "24H",
  "7day": "7D",
  "30day": "30D",
  lifetime: "lifetime",
};

function windowLabel(w: string): string {
  return WINDOW_LABELS[w] ?? w.replace("day", "D").replace("h", "H");
}

function budgetColor(b: { exhausted: boolean; alert: boolean }): string {
  return b.exhausted ? "var(--color-danger)" : b.alert ? "var(--color-warning)" : "var(--color-accent)";
}

export function BudgetTracker() {
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [keys, setKeys] = useState<KeyUsageRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState<{ open: boolean; initial: BudgetStatus | null }>({ open: false, initial: null });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = () => {
    void adminApi.budgets().then((r) => {
      if (!r.ok) setError(r.error ?? "could not reach the gateway");
      else { setBudgets(r.data?.budgets ?? []); }
      setLoaded(true);
    });
    void adminApi.keysUsage().then((r) => { if (r.ok) setKeys(r.data?.keys ?? []); });
  };

  useEffect(() => { refresh(); }, []);

  if (error) return <Empty>{error}</Empty>;
  if (!loaded) return <LoadingDots />;

  const overall = budgets.filter((b) => b.scope.type !== "key");
  const totalSpend = overall.reduce((s, b) => s + b.spent, 0);
  const totalLimit = overall.reduce((s, b) => s + b.limit, 0);
  const alerts = overall.filter((b) => b.alert || b.exhausted).length;
  const trackedKeys = keys.filter((k) => k.budget).length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Budgets</h1>
        </div>
        {!form.open && (
          <Button onClick={() => setForm({ open: true, initial: null })}>
            <Icon name="add" size={16} /> Add budget
          </Button>
        )}
      </div>

      {/* stat strip */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBlock label="Budgets" value={String(overall.length)} icon="savings" />
        <StatBlock label="Total Spend" value={fmt.cost(totalSpend)} icon="payments" accent />
        <StatBlock label="Total Limit" value={fmt.cost(totalLimit)} icon="account_balance" />
        <StatBlock label="Alerts" value={String(alerts)} icon="warning" tone={alerts > 0 ? "danger" : "neutral"} />
      </div>

      {/* add/edit form */}
      {form.open && (
        <div className="mb-5 overflow-hidden rounded-brand-lg card">
          <div className="border-b border-border-subtle px-5 py-3">
            <h2 className="text-[14px] font-semibold text-text">{form.initial ? "Edit budget" : "New budget"}</h2>
          </div>
          <div className="px-5 py-4">
            <BudgetForm
              key={form.initial?.key ?? "new"}
              initial={form.initial}
              onSaved={() => { setForm({ open: false, initial: null }); refresh(); }}
              onCancel={() => setForm({ open: false, initial: null })}
            />
          </div>
        </div>
      )}

      {/* overall budgets */}
      <div className="mb-2 flex items-center gap-2">
        <Icon name="public" size={16} className="text-text-subtle" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">Overall Budgets</h2>
        <div className="ml-2 h-px flex-1 bg-border-subtle" />
      </div>
      {overall.length === 0 && !form.open ? (
        <div className="mb-5 rounded-brand-lg card px-5 py-10 text-center text-[13px] text-text-muted">
          No budgets yet. Add one to cap spend globally, per provider, or per model.
        </div>
      ) : (
        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          {overall.map((b) => {
            const color = budgetColor(b);
            const pct = Math.min(100, Math.round(b.pct * 100));
            return (
              <div key={b.key} className="group card overflow-hidden rounded-brand-lg">
                {/* status strip */}
                <div className="h-1 w-full" style={{ background: color, opacity: 0.8 }} />

                <div className="px-5 pt-4 pb-3">
                  {/* header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[16px] font-bold text-text">{b.label}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                          {b.scope.type}
                        </span>
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">
                          {windowLabel(b.window)}
                        </span>
                        {b.unit === "usd" ? (
                          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">USD</span>
                        ) : (
                          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-subtle">Tokens</span>
                        )}
                      </div>
                    </div>
                    {b.exhausted ? (
                      <Badge tone="down">exhausted</Badge>
                    ) : b.alert ? (
                      <Badge tone="warn">alert</Badge>
                    ) : null}
                  </div>

                  {/* spent / limit */}
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="tnum text-[26px] font-bold tracking-tight text-text">
                      {b.unit === "usd" ? `$${b.spent.toFixed(2)}` : fmt.compact(b.spent)}
                    </span>
                    <span className="text-[14px] text-text-subtle">/</span>
                    <span className="tnum text-[14px] text-text-muted">
                      {b.unit === "usd" ? `$${b.limit.toFixed(2)}` : `${fmt.compact(b.limit)} tok`}
                    </span>
                    <span className="ml-auto tnum text-[13px] font-semibold" style={{ color }}>
                      {pct}%
                    </span>
                  </div>

                  {/* progress bar */}
                  <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: color }}
                    />
                  </div>
                </div>

                {/* footer: reset + actions */}
                <div className="flex items-center justify-between border-t border-border-subtle px-5 py-2.5">
                  <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                    <Icon name="restart_alt" size={13} className="text-text-subtle" />
                    <CooldownTimer ms={b.reset_in_ms} tone="muted" keepZero />
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setForm({ open: true, initial: b })} className="flex h-7 w-7 items-center justify-center rounded-brand text-text-subtle transition-colors hover:bg-surface-3 hover:text-text" title="Edit">
                      <Icon name="edit" size={15} />
                    </button>
                    <button onClick={() => setConfirmRemove(b.key)} className="flex h-7 w-7 items-center justify-center rounded-brand text-text-subtle transition-colors hover:bg-danger/10 hover:text-danger" title="Remove">
                      <Icon name="delete" size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* key budgets */}
      <div className="mb-2 mt-6 flex items-center gap-2">
        <Icon name="key" size={16} className="text-text-subtle" />
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-subtle">Key Budgets</h2>
        <span className="text-[11px] text-text-muted">{trackedKeys} tracked / {keys.length} total</span>
        <div className="ml-2 h-px flex-1 bg-border-subtle" />
      </div>
      {keys.length === 0 ? (
        <div className="rounded-brand-lg card px-5 py-8 text-center text-[13px] text-text-muted">No gateway keys yet. Add one on the Access Keys page.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {keys.map((k) => {
            const expired = !!(k.expires && Date.now() > k.expires);
            const b = k.budget;
            const color = b ? budgetColor(b) : "var(--color-success)";
            const pct = b ? Math.min(100, Math.round(b.pct * 100)) : 0;
            return (
              <div key={k.fingerprint} className={`card overflow-hidden rounded-brand-lg ${expired ? "opacity-50" : ""}`}>
                {/* status strip */}
                <div className="h-0.5 w-full" style={{ background: b ? color : "var(--color-success)", opacity: b ? 1 : 0.3 }} />

                <div className="px-4 pt-3 pb-3">
                  {/* name + status dot */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 flex-none rounded-full ${expired || b?.exhausted ? "bg-danger" : "bg-success"}`}
                      style={{ boxShadow: expired || b?.exhausted ? "none" : "0 0 6px 1px var(--color-success)" }}
                    />
                    <span className="truncate text-[14px] font-bold text-text">{k.name}</span>
                  </div>

                  {/* spent / limit */}
                  <div className="mt-2.5 flex items-baseline gap-1.5">
                    {b ? (
                      <>
                        <span className="tnum text-[22px] font-bold tracking-tight text-text">
                          {b.unit === "usd" ? `$${b.spent.toFixed(2)}` : fmt.compact(b.spent)}
                        </span>
                        <span className="text-[12px] text-text-subtle">/</span>
                        <span className="tnum text-[12px] text-text-muted">
                          {b.unit === "usd" ? `$${b.limit.toFixed(2)}` : `${fmt.compact(b.limit)}`}
                        </span>
                      </>
                    ) : (
                      <span className="tnum text-[20px] font-bold text-text">${k.spent.toFixed(2)}</span>
                    )}
                  </div>

                  {/* progress bar or no-limit */}
                  {b ? (
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-3">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  ) : (
                    <div className="mt-2 text-[12px] text-text-subtle">no limit set</div>
                  )}

                  {/* footer: expiry + reset */}
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[11px] text-text-subtle">
                      {k.expires ? (expired ? "expired" : `exp ${fmt.date(k.expires)}`) : "no expiry"}
                    </span>
                    {b && (
                      <span className="flex items-center gap-1 text-[11px] text-text-muted">
                        <Icon name="restart_alt" size={11} className="text-text-subtle" />
                        <CooldownTimer ms={b.reset_in_ms} tone="muted" keepZero />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Remove budget"
          message="This will stop tracking spend for this scope. Continue?"
          confirmLabel="Remove"
          onConfirm={async () => {
            const r = await adminApi.clearBudget(confirmRemove);
            if (!r.ok) setError(r.error ?? "could not remove budget");
            setConfirmRemove(null);
            refresh();
          }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

function StatBlock({ label, value, icon, accent, tone }: { label: string; value: string; icon: string; accent?: boolean; tone?: "danger" | "neutral" }) {
  const color = tone === "danger" ? "var(--color-danger)" : accent ? "var(--color-accent)" : "var(--color-text)";
  return (
    <div className={`card rounded-brand-lg px-5 py-3.5 ${accent ? "ring-1 ring-accent/20" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">{label}</div>
        <Icon name={icon} size={16} className="text-text-subtle" />
      </div>
      <div className="mt-0.5 tnum text-[24px] font-bold tracking-tight" style={{ color }}>{value}</div>
    </div>
  );
}
