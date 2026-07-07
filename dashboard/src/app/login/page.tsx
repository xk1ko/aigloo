"use client";

import { useState, useEffect } from "react";
import { Button, Input, Field } from "@/components/Button";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then((d: { isDefault?: boolean }) => setIsDefault(!!d.isDefault))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      // Hard navigation, not router.replace()/router.refresh() — the App
      // Router's client-side cache holds stale redirect-to-login RSC
      // payloads for every page visited pre-login, and refresh() only
      // busts the cache for the current route. A full navigation clears
      // it all, so subsequent Link clicks don't bounce back to /login.
      window.location.href = "/";
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "login failed");
      setBusy(false);
    }
  }

  return (
    <div className="login-split">
      {/* Left: gradient art panel */}
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

      {/* Right: form */}
      <div className="grid place-items-center p-6">
        <form
          onSubmit={submit}
          className="glass-strong w-full max-w-[400px] rounded-brand-xl p-8 shadow-elevated"
        >
          <h1 className="text-[22px] font-bold tracking-tight text-text">Welcome back</h1>
          <p className="mb-6 mt-1 text-[13px] text-text-muted">Enter the admin password to continue.</p>

          <Field label="Password">
            <Input type="password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
          </Field>

          {isDefault && (
            <div className="mt-2.5 text-[12px] text-text-subtle">
              Default password is <code className="text-text">123456</code> — change it in Settings after logging in.
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
