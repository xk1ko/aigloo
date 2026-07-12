"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { CooldownTimer } from "@/components/CooldownTimer";
import { fmt } from "@/components/ui";
import type { MemberMeResponse } from "@/app/api/me/route";

function formatBudgetAmount(n: number, unit: "usd" | "tokens"): string {
  if (unit === "usd") return fmt.cost(n);
  return fmt.compact(n);
}

/** Human window: "1day" → "every day", "lifetime" → never refills. */
function windowPeriod(w: string, lifetime?: boolean): string {
  if (lifetime || w === "lifetime") return "lifetime (never refills)";
  const m = /^(\d+)(h|day)$/.exec(w);
  if (!m) return w;
  const n = Number(m[1]);
  if (m[2] === "h") return n === 1 ? "every hour" : `every ${n} hours`;
  if (n === 1) return "every day";
  return `every ${n} days`;
}

function windowChip(w: string, lifetime?: boolean): string {
  if (lifetime || w === "lifetime") return "lifetime";
  const m = /^(\d+)(h|day)$/.exec(w);
  if (!m) return w;
  const n = Number(m[1]);
  if (m[2] === "h") return `${n}h`;
  return n === 1 ? "1 day" : `${n} days`;
}

/**
 * Self-service access summary for access-key (member) sessions.
 * Budget windows refill unless lifetime; key expiry is separate.
 */
export function MemberAccessCard() {
  const [me, setMe] = useState<MemberMeResponse | null>(null);

  useEffect(() => {
    void fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MemberMeResponse | { role?: string } | null) => {
        if (d && d.role === "member") setMe(d as MemberMeResponse);
      })
      .catch(() => {});
  }, []);

  if (!me) return null;

  const b = me.budget;
  const lifetime = !!b?.lifetime || b?.window === "lifetime";
  const budgetTone = !b
    ? "text-text-muted"
    : b.exhausted
      ? "text-danger"
      : b.alert
        ? "text-warning"
        : "text-success";

  return (
    <div className="mb-4 space-y-3">
      {me.blocks.length > 0 && (
        <div className="rounded-brand-lg border border-danger/30 bg-danger/8 px-4 py-3 text-[13px] text-danger">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <Icon name="warning" size={16} />
            Limited or blocked
          </div>
          <ul className="list-inside list-disc space-y-0.5 text-danger/90">
            {me.blocks.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-hidden rounded-brand-lg glass-premium">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 flex-none rounded-full ${me.expired ? "bg-danger" : "bg-success"}`}
              style={{ boxShadow: me.expired ? "none" : "0 0 6px 1px var(--color-success)" }}
            />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text">{me.name}</div>
              <div className="truncate text-[12px] text-text-muted">
                Access key · <span className="tnum font-mono">{me.masked}</span>
                <span className="text-text-subtle"> · {me.fingerprint}</span>
              </div>
            </div>
          </div>
          <span
            className={`flex-none text-[11px] font-semibold uppercase tracking-wider ${
              me.expired ? "text-danger" : "text-success"
            }`}
          >
            {me.expired ? "Expired" : "Active"}
          </span>
        </div>

        <div className="grid sm:grid-cols-3">
          <div className="border-b border-border-subtle px-5 py-4 sm:border-b-0 sm:border-r">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
              <Icon name="payments" size={14} />
              Budget left
            </div>
            {b ? (
              <>
                <div className={`mt-1 tnum text-[22px] font-bold tracking-tight ${budgetTone}`}>
                  {formatBudgetAmount(b.remaining, b.unit)}
                  <span className="ml-1 text-[13px] font-medium text-text-muted">
                    left of {formatBudgetAmount(b.limit, b.unit)}
                  </span>
                </div>
                <div className="mt-1 text-[13px] font-medium text-text">
                  {formatBudgetAmount(b.limit, b.unit)}{" "}
                  <span className="font-normal text-text-muted">{windowPeriod(b.window, lifetime)}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full rounded-full ${
                      b.exhausted ? "bg-danger" : b.alert ? "bg-warning" : "bg-success"
                    }`}
                    style={{ width: `${Math.min(100, Math.round(b.pct * 100))}%` }}
                  />
                </div>
                <div className="mt-1.5 space-y-0.5 text-[12px] text-text-muted">
                  <div>
                    {formatBudgetAmount(b.spent, b.unit)} used
                    {lifetime ? " (all time)" : ` this ${windowChip(b.window, lifetime)} window`}
                    {b.exhausted && <span className="text-danger"> · exhausted</span>}
                  </div>
                  {lifetime ? (
                    <div className="flex items-center gap-1 text-[11px] text-text-subtle">
                      <Icon name="block" size={13} />
                      One-shot cap — does not refill
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      <Icon name="restart_alt" size={13} className="text-text-subtle" />
                      <span>Refills {windowPeriod(b.window)}</span>
                      {b.reset_in_ms > 0 && (
                        <>
                          <span className="text-text-subtle">·</span>
                          <span>next in</span>
                          <CooldownTimer ms={b.reset_in_ms} tone="muted" icon="timer" keepZero />
                        </>
                      )}
                    </div>
                  )}
                  <div className="text-[11px] text-text-subtle">
                    Separate from key expiry below.
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 text-[22px] font-bold tracking-tight text-text">Unlimited</div>
                <div className="mt-1 text-[12px] text-text-muted">No key budget set by admin</div>
              </>
            )}
          </div>

          <div className="border-b border-border-subtle px-5 py-4 sm:border-b-0 sm:border-r">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
              <Icon name="model_training" size={14} />
              Models
            </div>
            {me.models && me.models.length > 0 ? (
              <>
                <div className="mt-1 text-[22px] font-bold tracking-tight text-text">
                  {me.models.length}
                  <span className="ml-1 text-[13px] font-medium text-text-muted">allowed</span>
                </div>
                <div className="mt-2 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
                  {me.models.map((m) => (
                    <span
                      key={m}
                      className="rounded-brand bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-text"
                      title={m}
                    >
                      {m}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 text-[22px] font-bold tracking-tight text-text">All models</div>
                <div className="mt-1 text-[12px] text-text-muted">No model allowlist on this key</div>
              </>
            )}
          </div>

          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-subtle">
              <Icon name="event" size={14} />
              Key expires
            </div>
            {me.expires ? (
              <>
                <div
                  className={`mt-1 text-[22px] font-bold tracking-tight ${
                    me.expired ? "text-danger" : "text-text"
                  }`}
                >
                  {fmt.date(me.expires)}
                </div>
                <div className="mt-1 text-[12px] text-text-muted">
                  {me.expired ? (
                    <span className="text-danger">Key has expired — login and API rejected</span>
                  ) : (
                    <>
                      {new Date(me.expires).toLocaleString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      <span className="text-text-subtle"> · in {fmt.duration(me.expires - Date.now())}</span>
                    </>
                  )}
                </div>
                <div className="mt-1.5 text-[11px] text-text-subtle">
                  After this date the key dies. Budget rules still apply until then.
                </div>
              </>
            ) : (
              <>
                <div className="mt-1 text-[22px] font-bold tracking-tight text-text">Never</div>
                <div className="mt-1 text-[12px] text-text-muted">No key expiry set by admin</div>
              </>
            )}
            {me.rpm != null && (
              <div className="mt-3 flex items-center gap-1.5 text-[12px] text-text-muted">
                <Icon name="speed" size={14} />
                Rate limit: <span className="font-medium text-text">{me.rpm}/min</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
