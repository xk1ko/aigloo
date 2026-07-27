"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import { useTheme } from "./ThemeProvider";
import { ConfirmModal } from "./ConfirmModal";
import { ChangelogModal } from "./ChangelogModal";
import { adminApi } from "@/lib/client";

const LABELS: Record<string, string> = {
  "": "Endpoint",
  endpoint: "Endpoint",
  keys: "Access Keys",
  providers: "Providers",
  combos: "Combos",
  usage: "Usage",
  quota: "Budgets",
  tools: "CLI Tools",
  console: "Server Console",
  config: "Settings",
  notifications: "Notifications",
  pricing: "Pricing",
};

const CMD = "npm i -g aigloo@latest --prefer-online";

function UpdateModal({
  current,
  latest,
  onClose,
  onShutdown,
}: {
  current: string;
  latest: string;
  onClose: () => void;
  onShutdown: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(CMD).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-brand-lg glass-strong modal-card p-5 shadow-elevated"
        style={{ boxShadow: "var(--shadow-elevated), 0 0 0 1px var(--color-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-warning/10 text-warning">
              <Icon name="arrow_upward" size={19} />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold text-text">Update available</h2>
              <p className="text-[12px] text-text-muted">
                v{current} → <span className="text-warning font-medium">v{latest}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-text-subtle hover:text-text">
            <Icon name="close" size={17} />
          </button>
        </div>

        <p className="mb-3 text-[13px] text-text-muted">
          Run this command in your terminal to update:
        </p>

        <div className="flex items-center gap-2 rounded-brand bg-bg px-3 py-2">
          <code className="flex-1 text-[12px] text-text">{CMD}</code>
          <button
            onClick={copy}
            className="flex-none text-text-subtle transition-colors hover:text-text"
            title="Copy command"
          >
            <Icon name={copied ? "check" : "content_copy"} size={14} />
          </button>
        </div>

        <p className="mt-3 text-[11.5px] text-text-subtle">
          Shut down the gateway first, then run the command above, then restart.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => { copy(); onShutdown(); }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-brand border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] font-medium text-warning transition-colors hover:bg-warning/20"
          >
            <Icon name="content_copy" size={14} />
            Copy &amp; Shut down
          </button>
          <button
            onClick={onClose}
            className="rounded-brand border border-border px-3 py-2 text-[13px] text-text-muted transition-colors hover:text-text"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export function TopBar({ onMenu }: { onMenu?: () => void }) {
  const path = usePathname();
  const { theme, toggle } = useTheme();
  const seg = path === "/" ? "" : (path.split("/")[1] ?? "");
  const current = LABELS[seg] ?? seg;

  const [version, setVersion] = useState<{ current: string; latest: string | null; updateAvailable: boolean } | null>(null);
  const [showUpdate, setShowUpdate] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    // Members cannot call admin version/shutdown APIs
    void fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role?: string } | null) => {
        if (d?.role === "member") {
          setIsMember(true);
          return;
        }
        void adminApi.version().then((r) => {
          if (r.ok && r.data) setVersion(r.data);
        });
      })
      .catch(() => {});
  }, []);

  async function doShutdown() {
    setBusy(true);
    await adminApi.shutdown();
    setStopped(true);
    setConfirmShutdown(false);
    setShowUpdate(false);
    setBusy(false);
  }

  return (
    <header className="app-topbar">
      <button className="sb-burger" onClick={onMenu} aria-label="Toggle navigation">
        <Icon name="menu" size={20} />
      </button>
      <div className="flex items-center gap-2 text-[14px]">
        <span className="text-text-subtle">aigloo</span>
        <span className="text-text-subtle">/</span>
        <span className="font-semibold text-text">{current}</span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {version && (
          <>
            <button
              onClick={() => setShowChangelog(true)}
              className="rounded-full px-2.5 py-1 text-[11px] text-text-subtle transition-colors hover:text-text hover:bg-surface-2"
              title="View changelog"
            >
              v{version.current}
            </button>
            {version.updateAvailable && (
              <button
                onClick={() => setShowUpdate(true)}
                className="flex items-center gap-1.5 rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-[11px] font-medium text-warning transition-colors hover:bg-warning/20"
              >
                <Icon name="arrow_upward" size={12} />
                → {version.latest}
              </button>
            )}
          </>
        )}

        <button
          onClick={toggle}
          className={`group relative flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-text hover:bg-surface-2 ${theme === "dark" ? "hover:animate-[shake_0.4s_ease-in-out]" : ""}`}
          aria-label="Toggle theme"
          title={theme === "dark" ? "FLASHBANG OUT!" : "Switch to dark mode"}
        >
          {theme === "dark" && (
            <span className="pointer-events-none absolute inset-0 rounded-full opacity-0 group-hover:animate-[flash_0.3s_ease-out] group-hover:opacity-100 bg-white/80" />
          )}
          {theme === "dark" ? (
            <svg viewBox="0 -1 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9.5" y="3.5" width="5" height="3.5" rx="1"/>
              <path d="M12 3.5V2.5"/>
              <path d="M10.5 3.5c0-1 3-1 3 0"/>
              <circle cx="14.5" cy="2.8" r="0.8"/>
              <rect x="8.5" y="7" width="7" height="10.5" rx="1.5"/>
              <line x1="8.5" y1="12.25" x2="15.5" y2="12.25"/>
              <line x1="6.5" y1="12.25" x2="4.5" y2="12.25"/>
              <line x1="17.5" y1="12.25" x2="19.5" y2="12.25"/>
              <line x1="6.8" y1="9.8" x2="5.2" y2="8.8"/>
              <line x1="17.2" y1="9.8" x2="18.8" y2="8.8"/>
              <line x1="6.8" y1="14.7" x2="5.2" y2="15.7"/>
              <line x1="17.2" y1="14.7" x2="18.8" y2="15.7"/>
            </svg>
          ) : (
            <Icon name="dark_mode" size={18} />
          )}
        </button>

        {!isMember && (
          <button
            onClick={() => setConfirmShutdown(true)}
            className="flex h-8 w-8 items-center justify-center rounded-full text-text-subtle transition-colors hover:text-danger hover:bg-danger/10"
            aria-label="Shut down gateway"
            title="Shut down the gateway"
          >
            <Icon name="power_settings_new" size={18} />
          </button>
        )}

        <div className="glass flex items-center gap-2 rounded-full py-1 pl-1 pr-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
            <svg viewBox="0 0 512 512" width="16" height="16" fill="none">
              <g transform="translate(60, 60) scale(14)" stroke="#08090d" strokeLinecap="round">
                <path d="M4 20C4 12.268 8.477 6 14 6C19.523 6 24 12.268 24 20" strokeWidth="2"/>
                <path d="M8 20C8 14.477 10.686 10 14 10C17.314 10 20 14.477 20 20" strokeWidth="1.5" opacity="0.5"/>
                <line x1="3" y1="20" x2="25" y2="20" strokeWidth="2"/>
              </g>
            </svg>
          </span>
          <span className="text-[12px] font-medium text-text-muted">aigloo</span>
        </div>
      </div>

      {showUpdate && version?.updateAvailable && (
        <UpdateModal
          current={version.current}
          latest={version.latest!}
          onClose={() => setShowUpdate(false)}
          onShutdown={doShutdown}
        />
      )}

      {showChangelog && (
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      )}

      {confirmShutdown && (
        <ConfirmModal
          title="Shut down gateway?"
          message="The gateway process will stop and all requests will fail until you restart it. The dashboard stays up but can't reach the gateway."
          confirmLabel="Shut down"
          busy={busy}
          onConfirm={doShutdown}
          onCancel={() => setConfirmShutdown(false)}
        />
      )}

      {stopped && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-brand-lg glass-strong modal-card p-5 text-center shadow-elevated">
            <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-danger/10 text-danger">
              <Icon name="power_settings_new" size={20} />
            </span>
            <h2 className="text-[15px] font-semibold text-text">Gateway stopped</h2>
            <p className="mt-1 text-[13px] text-text-muted">
              Run <code className="rounded bg-surface-2 px-1">{CMD}</code> then restart with <code className="rounded bg-surface-2 px-1">aigloo</code>.
            </p>
          </div>
        </div>
      )}
    </header>
  );
}
