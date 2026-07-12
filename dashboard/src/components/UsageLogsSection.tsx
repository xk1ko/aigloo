"use client";

import { useEffect, useState } from "react";
import { LogTable } from "@/components/LogTable";
import { Empty } from "@/components/ui";

/** Request log is admin-only; members only see their usage summary. */
export function UsageLogsSection() {
  const [role, setRole] = useState<"admin" | "member" | "unknown">("unknown");
  const [logs, setLogs] = useState<import("@/lib/gateway").UsageLog[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const me = await fetch("/api/me", { credentials: "same-origin" });
      if (!me.ok) {
        setRole("unknown");
        return;
      }
      const body = (await me.json()) as { role?: string };
      if (body.role === "member") {
        setRole("member");
        return;
      }
      setRole("admin");
      const res = await fetch("/api/gw/admin/logs?limit=200", { credentials: "same-origin" });
      if (!res.ok) {
        setError("could not load request log");
        setLogs([]);
        return;
      }
      const data = (await res.json()) as { logs: import("@/lib/gateway").UsageLog[] };
      setLogs(data.logs ?? []);
    })();
  }, []);

  if (role === "member" || role === "unknown") return null;

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-semibold text-text">Requests</h2>
      {error ? (
        <Empty>{error}</Empty>
      ) : logs === null ? (
        <Empty>Loading…</Empty>
      ) : (
        <LogTable logs={logs} />
      )}
    </div>
  );
}
