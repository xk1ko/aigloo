"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Icon, IconBadge } from "@/components/Icon";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Lamp } from "@/components/Lamp";
import { AuditLogPanel } from "@/components/AuditLogPanel";
import { fmt, Empty } from "@/components/ui";
import type { UsageLog } from "@/lib/gateway";

const LOG_COLORS: Record<string, string> = {
  LOG: "text-success",
  INFO: "text-info",
  WARN: "text-warning",
  ERROR: "text-danger",
  DEBUG: "text-text-subtle",
};

const LEVEL_BG: Record<string, string> = {
  LOG: "bg-success/15 text-success",
  INFO: "bg-info/15 text-info",
  WARN: "bg-warning/15 text-warning",
  ERROR: "bg-danger/15 text-danger",
  DEBUG: "bg-surface-3 text-text-subtle",
};

interface LogEntry {
  ts: number;
  level: string;
  message: string;
}

/** Compact last-N requests panel — the full filterable table lives on Usage. */
function RecentRequests() {
  const [logs, setLogs] = useState<UsageLog[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/gw/admin/logs?limit=8", { credentials: "same-origin" });
      if (!res.ok) {
        setLogs([]);
        return;
      }
      const data = (await res.json()) as { logs: UsageLog[] };
      setLogs(data.logs ?? []);
    } catch {
      setLogs([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="overflow-hidden rounded-brand-lg card">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconBadge name="bar_chart" tone="neutral" />
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-text">Recent requests</h2>
            <p className="text-[12px] text-text-muted">latest traffic through the gateway</p>
          </div>
        </div>
        <Link
          href="/usage"
          className="inline-flex items-center gap-1 rounded-brand px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-3 hover:text-text"
        >
          Open Usage <Icon name="arrow_forward" size={13} />
        </Link>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {logs === null ? (
          <Empty>Loading…</Empty>
        ) : logs.length === 0 ? (
          <Empty>No requests recorded yet.</Empty>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {logs.map((l, i) => (
              <li key={`${l.ts}-${i}`} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                <Badge tone={l.status < 400 ? "live" : "down"}>
                  <Lamp state={l.status < 400 ? "live" : "down"} />
                  {l.status}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text">
                  {l.alias || l.model}
                </span>
                <span className="flex-none text-[12px] text-text-muted">{l.provider}</span>
                <span className="flex-none tnum text-[11px] text-text-subtle">{fmt.int(l.latency_ms)}ms</span>
                <time className="flex-none tnum text-[11px] text-text-subtle" title={fmt.time(l.ts)}>
                  {fmt.ago(l.ts)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function ConsolePage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/gw/admin/console/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-300));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg as LogEntry];
          return next.length > 300 ? next.slice(-300) : next;
        });
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  useEffect(() => {
    if (autoScroll && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleClear = async () => {
    await fetch("/api/gw/admin/console", { method: "DELETE" });
    setLogs([]);
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">Server Console</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              autoScroll ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text"
            }`}
            title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
          >
            <Icon name={autoScroll ? "vertical_align_bottom" : "vertical_align_top"} size={12} />
            Auto-scroll
          </button>
          <span className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-success" : "text-danger"}`}>
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-success" : "bg-danger"}`} style={{ boxShadow: `0 0 4px 1px ${connected ? "var(--color-success)" : "var(--color-danger)"}` }} />
            {connected ? "Connected" : "Disconnected"}
          </span>
          <Button variant="ghost" onClick={handleClear}>
            <Icon name="delete" size={15} /> Clear
          </Button>
        </div>
      </div>

      {/* terminal */}
      <div className="overflow-hidden rounded-brand-lg card">
        {/* terminal chrome */}
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-danger/60" />
            <span className="h-3 w-3 rounded-full bg-warning/60" />
            <span className="h-3 w-3 rounded-full bg-success/60" />
          </div>
          <span className="ml-2 text-[11px] font-medium text-text-subtle">gateway — stdout</span>
          <span className="ml-auto tnum text-[11px] text-text-subtle">{logs.length} lines</span>
        </div>

        {/* log area */}
        <div
          ref={logRef}
          className="h-[min(52vh,460px)] overflow-y-auto bg-[#06070b] p-4 font-mono text-[12px]"
        >
          {logs.length === 0 ? (
            <span className="text-text-subtle">No logs yet…</span>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="flex items-start gap-2 whitespace-pre-wrap break-all py-0.5">
                <span className="flex-none text-text-subtle">{new Date(entry.ts).toLocaleTimeString("en-US", { hour12: false })}</span>
                <span className={`flex-none rounded px-1 text-[10px] font-semibold uppercase ${LEVEL_BG[entry.level] ?? "bg-surface-3 text-text"}`}>
                  {entry.level}
                </span>
                <span className={`${LOG_COLORS[entry.level] ?? "text-text"}`}>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* activity + recent traffic */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AuditLogPanel />
        <RecentRequests />
      </div>
    </div>
  );
}
