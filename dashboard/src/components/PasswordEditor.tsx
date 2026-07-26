"use client";

import { useState } from "react";
import { RichCard, CardTitle } from "@/components/RichCard";
import { Button } from "@/components/Button";
import { Icon, IconBadge } from "@/components/Icon";
import { account } from "@/lib/client";

export function PasswordEditor() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    setErr("");
    setMsg("");
    if (next !== confirm) {
      setErr("new password and confirmation don't match");
      return;
    }
    if (next.length < 4) {
      setErr("new password must be at least 4 characters");
      return;
    }
    setBusy(true);
    const r = await account.changePassword(current, next);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error ?? "could not change password");
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setMsg("Password changed ✓ — it's active now.");
  }

  const field = "w-full max-w-[280px] rounded-brand border border-border bg-bg px-2.5 py-1.5 text-[13px] text-text focus:border-accent focus:outline-none";

  return (
    <RichCard header={<CardTitle icon={<IconBadge name="lock" tone="warning" />} title="Admin password" sub="for the dashboard login + the gateway admin API" />}>
      <div className="space-y-2.5">
        <div className="flex items-start gap-2 rounded-brand border border-warning/30 bg-warning/10 px-3 py-2">
          <Icon name="warning" size={16} className="mt-0.5 shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-text-muted">
            Seeded from <span className="tnum">AIGLOO_ADMIN_PASSWORD</span> (default <span className="tnum">123456</span>) on first boot, then stored as a scrypt hash in <span className="tnum">auth.json</span>. The env var is ignored after first run. Change it below to secure your instance.
          </p>
        </div>
        <Row label="Current">
          <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} autoComplete="current-password" />
        </Row>
        <Row label="New">
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={field} autoComplete="new-password" />
        </Row>
        <Row label="Confirm">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={field} autoComplete="new-password" />
        </Row>
        <div className="flex items-center gap-2 pt-1">
          <Button disabled={busy || !current || !next} onClick={save}>
            {busy ? "Saving…" : "Change password"}
          </Button>
          {msg && (
            <span className="flex items-center gap-1 text-[12px] text-success">
              <Icon name="check" size={14} /> {msg}
            </span>
          )}
          {err && <span className="text-[12px] text-danger">{err}</span>}
        </div>
      </div>
    </RichCard>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] font-medium text-text-subtle">{label}</span>
      {children}
    </div>
  );
}
