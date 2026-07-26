"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon, IconBadge } from "@/components/Icon";
import { fmt, Empty, LoadingDots } from "@/components/ui";

type AuditEvent = {
  id: number;
  ts: number;
  action: string;
  actor: string;
  detail: string;
};

const ACTION_LABEL: Record<string, string> = {
  "login.admin": "Admin login",
  "login.member": "Member login",
  "login.fail": "Login failed",
  "key.add": "Access key created",
  "key.remove": "Access key removed",
  "key.rename": "Access key renamed",
  "key.scope": "Access key scope updated",
  "password.change": "Admin password changed",
};

export function AuditLogPanel() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    const res = await fetch("/api/gw/admin/audit?limit=80", { credentials: "same-origin" });
    if (!res.ok) {
      setError("could not load activity");
      setEvents([]);
      return;
    }
    const body = (await res.json()) as { events?: AuditEvent[] };
    setEvents(body.events ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="overflow-hidden rounded-brand-lg card">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <IconBadge name="history" tone="neutral" />
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-text">Activity</h2>
            <p className="text-[12px] text-text-muted">logins · keys · password changes</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-brand px-2.5 py-1.5 text-[12px] text-text-muted hover:bg-surface-3 hover:text-text"
        >
          <Icon name="refresh" size={14} /> Refresh
        </button>
      </div>
      <div className="max-h-72 overflow-y-auto">
        {error ? (
          <Empty>{error}</Empty>
        ) : events === null ? (
          <div className="py-8">
            <LoadingDots />
          </div>
        ) : events.length === 0 ? (
          <Empty>No activity yet. Logins and key changes show up here.</Empty>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {events.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-5 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text">
                    {ACTION_LABEL[e.action] ?? e.action}
                    {e.detail ? (
                      <span className="font-normal text-text-muted"> · {e.detail}</span>
                    ) : null}
                  </div>
                  <div className="text-[11px] text-text-subtle">
                    {e.actor || "—"}
                  </div>
                </div>
                <time className="flex-none tnum text-[11px] text-text-subtle" title={fmt.time(e.ts)}>
                  {fmt.ago(e.ts)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
