"use client";

import { useState, useEffect } from "react";
import { Button, Input, Field } from "@/components/Button";

type LoginMode = "admin" | "key";

export default function LoginPage() {
  const [mode, setMode] = useState<LoginMode>("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [memberLogin, setMemberLogin] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then((d: { isDefault?: boolean; memberLogin?: boolean }) => {
        setIsDefault(!!d.isDefault);
        setMemberLogin(!!d.memberLogin);
      })
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ password }),
        signal: ctrl.signal,
      });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { role?: string };
        // Prefer the role the server issued — admin password always wins if it matches.
        if (mode === "key" && body.role === "admin") {
          setError("That looks like the admin password. Switch to Admin, or use a gateway access key.");
          setBusy(false);
          return;
        }
        if (mode === "admin" && body.role === "member") {
          setError("That is an access key. Switch to Access key for usage-only login.");
          setBusy(false);
          return;
        }
        // Keep the key in this browser only so CLI Tools can auto-apply without re-paste.
        try {
          if (body.role === "member") sessionStorage.setItem("aigloo_member_key", password);
          else sessionStorage.removeItem("aigloo_member_key");
        } catch {
          /* private mode */
        }
        window.location.replace(body.role === "member" ? "/usage" : "/");
        return;
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          body.error ??
            (mode === "key" ? "invalid access key" : "wrong password") +
              ` (${res.status})`,
        );
        setBusy(false);
      }
    } catch {
      setError("server not responding — aigloo may have crashed. restart it and try again.");
      setBusy(false);
    } finally {
      clearTimeout(timer);
    }
  }

  const tab = (id: LoginMode, label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(id);
        setError("");
        setPassword("");
      }}
      className={`flex-1 rounded-brand px-3 py-2 text-[13px] font-medium transition-colors ${
        mode === id ? "bg-accent text-accent-ink" : "text-text-muted hover:text-text"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="login-split">
      <div className="login-art">
        <div className="max-w-md">
          <div className="mb-8 flex items-center gap-3">
            <span className="flex h-12 w-12 flex-none items-center justify-center rounded-brand-xl bg-accent shadow-warm">
              <svg viewBox="0 0 512 512" width="28" height="28" fill="none">
                <g transform="translate(60, 60) scale(14)" stroke="#08090d" strokeLinecap="round">
                  <path d="M4 20C4 12.268 8.477 6 14 6C19.523 6 24 12.268 24 20" strokeWidth="2"/>
                  <path d="M8 20C8 14.477 10.686 10 14 10C17.314 10 20 14.477 20 20" strokeWidth="1.5" opacity="0.5"/>
                  <line x1="3" y1="20" x2="25" y2="20" strokeWidth="2"/>
                </g>
              </svg>
            </span>
            <span className="text-[24px] font-bold tracking-tight text-text">aigloo</span>
          </div>
          <h2 className="text-[28px] font-bold leading-tight tracking-tight text-text">
            All your AI,<br/>in one place.
          </h2>
          <p className="mt-4 text-[14px] leading-relaxed text-text-muted">
            Route, translate, and track requests across every provider. One endpoint, total visibility.
          </p>
        </div>
      </div>

      <div className="grid place-items-center p-6">
        <form
          onSubmit={submit}
          className="glass-strong w-full max-w-[400px] rounded-brand-xl p-8 shadow-elevated"
        >
          <h1 className="text-[22px] font-bold tracking-tight text-text">Welcome back</h1>
          <p className="mb-4 mt-1 text-[13px] text-text-muted">
            {mode === "admin"
              ? "Full console — providers, keys, budgets, settings."
              : "Usage only — your spend and limits for the key you were given."}
          </p>

          {memberLogin && (
            <div className="mb-5 flex gap-1 rounded-full bg-surface-2 p-1">
              {tab("admin", "Admin")}
              {tab("key", "Access key")}
            </div>
          )}

          <Field label={mode === "key" ? "Access key" : "Password"}>
            <Input
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "key" ? "off" : "current-password"}
              placeholder={mode === "key" ? "aig-…" : undefined}
            />
          </Field>

          {mode === "admin" && isDefault && (
            <div className="mt-2.5 text-[12px] text-text-subtle">
              Default admin password is <code className="text-text">123456</code>
              {" — change it in Settings after logging in."}
            </div>
          )}
          {mode === "key" && (
            <div className="mt-2.5 text-[12px] text-text-subtle">
              Paste the gateway key from your admin. Same key you use in Claude Code / Cursor.
            </div>
          )}

          {error && <div className="mt-2.5 text-[12px] text-danger">{error}</div>}

          <Button type="submit" disabled={busy} className="mt-6 w-full">
            {busy ? "Connecting…" : "Connect"}
          </Button>
        </form>
      </div>
    </div>
  );
}
