"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/Badge";
import { Icon } from "@/components/Icon";
import { Empty } from "@/components/ui";
import { CLI_TOOLS } from "@/lib/cliTools";
import type { EndpointPayload } from "@/lib/gateway";

type DetectState = "loading" | "detected" | "not-detected";

export function CliToolConfig() {
  const [port, setPort] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [detect, setDetect] = useState<Record<string, DetectState>>({});
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    void (async () => {
      const meRes = await fetch("/api/me", { credentials: "same-origin" });
      const me = meRes.ok ? ((await meRes.json()) as { role?: string; port?: number }) : null;
      if (me?.role === "member") {
        setIsMember(true);
        setPort(me.port ?? 18080);
      } else {
        const res = await fetch("/api/gw/admin/endpoint");
        if (!res.ok) {
          setError("could not reach the gateway");
          return;
        }
        setPort(((await res.json()) as EndpointPayload).port);
      }

      const results = await Promise.all(
        CLI_TOOLS.map(async (t) => {
          try {
            const r = await fetch(`/api/cli-detect/${t.id}`);
            const data = await r.json();
            return [t.id, data.installed ? "detected" : "not-detected"] as const;
          } catch {
            return [t.id, "not-detected"] as const;
          }
        }),
      );
      setDetect(Object.fromEntries(results));
    })();
  }, []);

  if (error) return <Empty>{error}</Empty>;

  const baseUrl = port ? `http://localhost:${port}` : "http://localhost:PORT";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[30px] font-bold tracking-tight heading-gradient heading-accent">CLI Tools</h1>
        {isMember && (
          <p className="mt-1 text-[13px] text-text-muted">
            Auto-config runs on <strong className="text-text">this aigloo host</strong> with your access key and allowed models only.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CLI_TOOLS.map((t) => {
          const st = detect[t.id] ?? "loading";
          return (
            <Link
              key={t.id}
              href={`/tools/${t.id}`}
              className={`group card flex flex-col overflow-hidden rounded-brand-lg transition-[box-shadow] duration-200 hover:shadow-lift`}
            >
              {/* icon + name + status */}
              <div className="flex-1 px-5 pt-4 pb-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 flex-none items-center justify-center rounded-brand bg-surface-2 text-text-muted transition-colors group-hover:text-accent">
                    <Icon name={t.icon} size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold text-text">{t.name}</div>
                    <div className="mt-0.5">
                      {st === "loading" ? (
                        <Badge tone="neutral">detecting…</Badge>
                      ) : st === "detected" ? (
                        <Badge tone="live">detected</Badge>
                      ) : (
                        <Badge tone="neutral">not detected</Badge>
                      )}
                    </div>
                  </div>
                  <Icon name="chevron_right" size={18} className="flex-none text-text-subtle transition-colors group-hover:text-text" />
                </div>

                <p className="mt-3 text-[12px] leading-relaxed text-text-muted">{t.blurb}</p>
              </div>

              {/* format badge */}
              <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-2.5">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${t.format === "openai" ? "bg-success/12 text-success" : "bg-warning/12 text-warning"}`}>
                  {t.format}
                </span>
                {t.autoConfig && (
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">auto-config</span>
                )}
                <span className="ml-auto text-[11px] text-text-subtle">{t.slots.length} model{t.slots.length > 1 ? "s" : ""}</span>
              </div>

              {/* config preview */}
              <div className="border-t border-border-subtle bg-bg/40 px-5 py-2.5">
                <code className="block truncate text-[11px] text-text-subtle">
                  {t.format === "anthropic" ? "ANTHROPIC_BASE_URL" : "OPENAI_BASE_URL"}={t.format === "openai" ? `${baseUrl}/v1` : baseUrl}
                </code>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
