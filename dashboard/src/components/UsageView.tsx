"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { AreaChart, type SeriesPoint } from "@/components/AreaChart";
import { Icon } from "@/components/Icon";
import { fmt, Empty } from "@/components/ui";
import type { UsageSummary, SavingsSummary } from "@/lib/gateway";

const PAGE_SIZE = 8;

type Window = { label: string; key: "today" | "24h" | "7d" | "30d" | "60d"; bucketMs: number };

const WINDOWS: Window[] = [
  { label: "Today", key: "today", bucketMs: 15 * 60_000 },
  { label: "24H", key: "24h", bucketMs: 3600_000 },
  { label: "7D", key: "7d", bucketMs: 6 * 3600_000 },
  { label: "30D", key: "30d", bucketMs: 86400_000 },
  { label: "60D", key: "60d", bucketMs: 2 * 86400_000 },
];

function sinceFor(key: Window["key"]): number {
  const now = Date.now();
  switch (key) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    case "24h": return now - 24 * 3600_000;
    case "7d": return now - 7 * 86400_000;
    case "30d": return now - 30 * 86400_000;
    case "60d": return now - 60 * 86400_000;
  }
}

export function UsageView() {
  const [win, setWin] = useState<Window>(WINDOWS[0]!);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [savings, setSavings] = useState<SavingsSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (w: Window) => {
    setLoading(true);
    setError("");
    const since = sinceFor(w.key);
    const [sumRes, serRes, savRes] = await Promise.all([
      fetch(`/api/gw/admin/usage?since=${since}`),
      fetch(`/api/gw/admin/usage/series?since=${since}&bucket=${w.bucketMs}`),
      fetch(`/api/gw/admin/savings/summary?since=${since}`),
    ]);
    if (!sumRes.ok) {
      setError("could not load usage");
      setLoading(false);
      return;
    }
    setSummary((await sumRes.json()) as UsageSummary);
    const ser = serRes.ok ? ((await serRes.json()) as { series: SeriesPoint[] }) : { series: [] };
    setSeries(ser.series);
    setSavings(savRes.ok ? ((await savRes.json()) as SavingsSummary) : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(win);
  }, [win, load]);

  const total = summary?.total;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Usage</h1>
        </div>
        <div className="flex items-center gap-0.5 rounded-full bg-surface-2 p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.label}
              onClick={() => setWin(w)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                win.label === w.label ? "bg-accent text-accent-ink" : "text-text-muted hover:text-text"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <Empty>{error}</Empty>
      ) : (
        <>
          <div className="mb-4 overflow-hidden rounded-brand-lg glass-premium">
            <div className="grid sm:grid-cols-4">
              <div className="border-b border-border-subtle px-6 py-5 sm:border-b-0 sm:border-r">
                <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">Requests</div>
                <div className="mt-1 tnum text-[28px] font-bold tracking-tight text-text">{fmt.int(total?.requests ?? 0)}</div>
              </div>
              <div className="border-b border-border-subtle px-6 py-5 sm:border-b-0 sm:border-r">
                <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">Tokens In</div>
                <div className="mt-1 tnum text-[28px] font-bold tracking-tight text-text">{fmt.compact(total?.tokens_in ?? 0)}</div>
              </div>
              <div className="border-b border-border-subtle px-6 py-5 sm:border-b-0 sm:border-r">
                <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">Tokens Out</div>
                <div className="mt-1 tnum text-[28px] font-bold tracking-tight text-text">{fmt.compact(total?.tokens_out ?? 0)}</div>
              </div>
              <div className="px-6 py-5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">Cost</div>
                <div className="mt-1 heading-gradient tnum text-[40px] font-bold tracking-tight">{fmt.cost(total?.cost ?? 0)}</div>
              </div>
            </div>
          </div>

          {/* chart — AreaChart renders its own card + header */}
          <div className="mb-4">
            <AreaChart series={series} />
          </div>

          {/* breakdown — horizontal bars */}
          <div className="grid gap-3 lg:grid-cols-2">
            <BreakdownPanel
              title="By Provider"
              icon="dns"
              rows={summary?.by_provider.map((p) => ({ label: p.provider, requests: p.requests, tokens_in: p.tokens_in, tokens_out: p.tokens_out, cost: p.cost })) ?? []}
              loading={loading}
            />
            <BreakdownPanel
              title="By Model"
              icon="model_training"
              rows={summary?.by_model.map((m) => ({ label: m.alias, requests: m.requests, tokens_in: m.tokens_in, tokens_out: m.tokens_out, cost: m.cost })) ?? []}
              loading={loading}
            />
          </div>

          <div className="mt-3">
            <SavingsPanel savings={savings} loading={loading} />
          </div>
        </>
      )}
    </div>
  );
}

function SavingsPanel({ savings, loading }: { savings: SavingsSummary | null; loading: boolean }) {
  const rtkPct = savings && savings.rtk.bytes_in > 0
    ? Math.round((1 - savings.rtk.bytes_out / savings.rtk.bytes_in) * 100)
    : 0;
  const headroomPct = savings && savings.headroom.tokens_before > 0
    ? Math.round((1 - savings.headroom.tokens_after / savings.headroom.tokens_before) * 100)
    : 0;
  const levelRows = (rows: SavingsSummary["by_caveman_level"]) =>
    rows.filter((r) => r.requests > 0 && r.level !== "off");

  return (
    <div className={`overflow-hidden rounded-brand-lg card ${loading ? "opacity-50" : ""}`}>
      <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <Icon name="savings" size={15} className="text-text-subtle" />
        <h2 className="text-[13px] font-semibold text-text">Token Saver Savings</h2>
      </div>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">RTK</div>
          {savings && savings.rtk.hits > 0 ? (
            <div className="mt-1 text-[13px] text-text">
              <span className="font-bold text-accent">~{fmt.cost(savings.rtk.cost_saved)} saved</span> — {fmt.compact(savings.rtk.bytes_in - savings.rtk.bytes_out)} bytes trimmed ({rtkPct}%) across {fmt.int(savings.rtk.hits)} request(s)
            </div>
          ) : (
            <div className="mt-1 text-[13px] text-text-subtle">No compressible tool output in this window.</div>
          )}
          <div className="mt-4 text-[11px] font-medium uppercase tracking-wider text-text-subtle">Headroom</div>
          {savings && savings.headroom.hits > 0 ? (
            <div className="mt-1 text-[13px] text-text">
              <span className="font-bold text-accent">~{fmt.cost(savings.headroom.cost_saved)} saved</span> — {fmt.compact(savings.headroom.tokens_before - savings.headroom.tokens_after)} tokens trimmed ({headroomPct}%) across {fmt.int(savings.headroom.hits)} request(s)
            </div>
          ) : (
            <div className="mt-1 text-[13px] text-text-subtle">Not enabled, or no requests in this window.</div>
          )}
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-subtle">Avg output tokens by level</div>
          <div className="mt-1 space-y-1 text-[13px] text-text">
            {[...levelRows(savings?.by_caveman_level ?? []).map((r) => ({ ...r, saver: "Caveman" })),
              ...levelRows(savings?.by_ponytail_level ?? []).map((r) => ({ ...r, saver: "Ponytail" }))]
              .map((r) => (
                <div key={`${r.saver}-${r.level}`} className="flex items-center justify-between">
                  <span className="text-text-subtle">{r.saver} · {r.level}</span>
                  <span className="tnum">{fmt.compact(r.avg_tokens_out)} avg out ({fmt.int(r.requests)} req)</span>
                </div>
              ))}
            {levelRows(savings?.by_caveman_level ?? []).length === 0 && levelRows(savings?.by_ponytail_level ?? []).length === 0 && (
              <div className="text-text-subtle">Caveman/Ponytail off for all requests in this window.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function BreakdownPanel({
  title,
  icon,
  rows,
  loading,
}: {
  title: string;
  icon: string;
  rows: Array<{ label: string; requests: number; tokens_in: number; tokens_out: number; cost: number }>;
  loading: boolean;
}) {
  const [page, setPage] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [minH, setMinH] = useState(0);
  const totalPages = Math.ceil(rows.length / PAGE_SIZE);

  useEffect(() => { setPage(0); }, [rows.length]);

  const pageRows = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => {
    if (wrapRef.current && pageRows.length === PAGE_SIZE) {
      const h = wrapRef.current.offsetHeight;
      if (h > minH) setMinH(h);
    }
  }, [pageRows, minH]);

  return (
    <div className="flex flex-col overflow-hidden rounded-brand-lg card">
      <div className="flex items-center gap-2 border-b border-border-subtle px-5 py-3">
        <Icon name={icon} size={15} className="text-text-subtle" />
        <h2 className="text-[13px] font-semibold text-text">{title}</h2>
        <span className="ml-auto text-[11px] text-text-subtle">{rows.length} total</span>
      </div>
      <div
        ref={wrapRef}
        className={`flex-1 px-5 py-3 ${loading ? "opacity-50" : ""}`}
        style={minH ? { minHeight: minH } : undefined}
      >
        {rows.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-text-muted">No usage in this window.</div>
        ) : (
          <div className="space-y-2.5">
            {pageRows.map((r, i) => (
              <div key={`${r.label}-${page}-${i}`} className="group">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-text" title={r.label}>{r.label}</span>
                  <span className="tnum flex-none text-[13px] font-semibold text-text">{fmt.cost(r.cost)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 tnum text-[11px] text-text-subtle">
                  <span>{fmt.int(r.requests)} req</span>
                  <span>in {fmt.compact(r.tokens_in)}</span>
                  <span>out {fmt.compact(r.tokens_out)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <div className="flex items-center justify-between border-t border-border-subtle px-5 py-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || totalPages <= 1}
            className="text-text-subtle transition-colors hover:text-text disabled:opacity-30"
          >
            <Icon name="chevron_left" size={16} />
          </button>
          <span className="tnum text-[11px] text-text-subtle">{page + 1}/{Math.max(1, totalPages)}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page === totalPages - 1 || totalPages <= 1}
            className="text-text-subtle transition-colors hover:text-text disabled:opacity-30"
          >
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
