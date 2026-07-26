"use client";

import { useEffect, useState } from "react";
import { RichCard, CardTitle } from "@/components/RichCard";
import { IconBadge } from "@/components/Icon";
import { Badge } from "@/components/Badge";

export function AutostartToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/gw/admin/autostart")
      .then((r) => r.json())
      .then((d: { enabled: boolean }) => setEnabled(d.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function toggle() {
    if (enabled === null) return;
    setBusy(true);
    const res = await fetch("/api/gw/admin/autostart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    });
    if (res.ok) {
      const d = (await res.json()) as { enabled: boolean };
      setEnabled(d.enabled);
    }
    setBusy(false);
  }

  return (
    <RichCard header={<CardTitle icon={<IconBadge name="power_settings_new" tone="success" />} title="Startup" sub="run aigloo when your system boots" />}>
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="text-text-subtle">Auto-start on login</span>
            {enabled !== null && (
              <Badge tone={enabled ? "live" : "neutral"}>{enabled ? "enabled" : "disabled"}</Badge>
            )}
          </div>
          <p className="text-[11px] text-text-subtle">
            Registers aigloo to launch with system tray on OS startup (--tray --skip-update)
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={busy || enabled === null}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-border transition-colors ${
            enabled ? "bg-accent" : "bg-surface-2"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <span
            className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </RichCard>
  );
}
