"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "./Icon";

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { label: string; items: NavItem[] };

const ADMIN_NAV: NavGroup[] = [
  {
    label: "Gateway",
    items: [
      { href: "/", label: "Endpoint", icon: "api" },
      { href: "/providers", label: "Providers", icon: "dns" },
      { href: "/combos", label: "Combos", icon: "layers" },
    ],
  },
  {
    label: "Access",
    items: [
      { href: "/keys", label: "Access Keys", icon: "key" },
      { href: "/quota", label: "Budgets", icon: "data_usage" },
    ],
  },
  {
    label: "Observe",
    items: [
      { href: "/usage", label: "Usage", icon: "bar_chart" },
      { href: "/console", label: "Server Console", icon: "receipt_long" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/tools", label: "CLI Tools", icon: "terminal" },
      { href: "/config", label: "Settings", icon: "settings" },
    ],
  },
];

const MEMBER_NAV: NavGroup[] = [
  {
    label: "Member",
    items: [
      { href: "/usage", label: "Usage", icon: "bar_chart" },
      { href: "/tools", label: "CLI Tools", icon: "terminal" },
    ],
  },
];

function CommandPalette({ groups, onClose }: { groups: NavGroup[]; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(
    () => groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label }))),
    [groups],
  );
  const list = items.filter((i) => i.label.toLowerCase().includes(q.trim().toLowerCase()));
  const active = Math.min(sel, Math.max(0, list.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function go(href: string) {
    onClose();
    router.push(href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(list.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter" && list[active]) {
      go(list[active].href);
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex justify-center bg-black/60 p-6 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="h-fit w-full max-w-md overflow-hidden rounded-brand-lg glass-strong modal-card shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          placeholder="Jump to page…"
          className="w-full border-b border-border-subtle bg-transparent px-4 py-3.5 text-[14px] text-text placeholder:text-text-subtle focus:outline-none"
        />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {list.length === 0 ? (
            <p className="px-3 py-6 text-center text-[13px] text-text-muted">No matches.</p>
          ) : (
            list.map((i, idx) => (
              <button
                key={i.href}
                onClick={() => go(i.href)}
                onMouseEnter={() => setSel(idx)}
                className={`flex w-full items-center gap-2.5 rounded-brand px-2.5 py-2 text-left text-[13px] transition-colors ${
                  idx === active ? "bg-accent/15 text-accent" : "text-text-muted"
                }`}
              >
                <Icon name={i.icon} size={15} />
                {i.label}
                <span className="ml-auto text-[10px] uppercase tracking-wider text-text-subtle">{i.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const path = usePathname();
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  const [palette, setPalette] = useState(false);
  const [alive, setAlive] = useState<boolean | null>(null);
  const [host, setHost] = useState("");

  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role?: string } | null) => {
        if (d?.role === "member") setRole("member");
        else if (d?.role === "admin") setRole("admin");
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setHost(window.location.host);
    let stopped = false;
    const ping = () =>
      fetch("/health")
        .then((r) => {
          if (!stopped) setAlive(r.ok);
        })
        .catch(() => {
          if (!stopped) setAlive(false);
        });
    void ping();
    const t = setInterval(ping, 15000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((v) => !v);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  async function logout() {
    try {
      sessionStorage.removeItem("aigloo_member_key");
    } catch {
      /* ignore */
    }
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const isActive = (href: string) =>
    href === "/"
      ? path === "/" || path.startsWith("/endpoint")
      : path === href || path.startsWith(`${href}/`);

  const groups = role === "member" ? MEMBER_NAV : ADMIN_NAV;
  const homeHref = role === "member" ? "/usage" : "/";

  return (
    <>
      <aside className={`app-sidebar${open ? " open" : ""}`}>
        <Link href={homeHref} className="sb-brand" onClick={onClose}>
          <span className="sb-logo">
            <svg viewBox="0 0 512 512" width="20" height="20" fill="none" aria-hidden>
              <g transform="translate(60, 60) scale(14)" stroke="currentColor" strokeLinecap="round">
                <path d="M4 20C4 12.268 8.477 6 14 6C19.523 6 24 12.268 24 20" strokeWidth="2"/>
                <path d="M8 20C8 14.477 10.686 10 14 10C17.314 10 20 14.477 20 20" strokeWidth="1.5" opacity="0.5"/>
                <line x1="3" y1="20" x2="25" y2="20" strokeWidth="2"/>
              </g>
            </svg>
          </span>
          <span className="sb-word">aigloo</span>
        </Link>

        <button className="sb-search" onClick={() => setPalette(true)}>
          <Icon name="search" size={14} />
          <span>Search…</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="sb-nav">
          {groups.map((g) => (
            <div key={g.label} className="sb-group">
              <div className="sb-group-label">{g.label}</div>
              {g.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    className={`sb-item${active ? " sb-item-active" : ""}`}
                  >
                    <Icon name={item.icon} size={16} fill={active} />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sb-foot">
          <div className="sb-status">
            <span
              className={`lamp ${alive === null ? "lamp-idle" : alive ? "lamp-live" : "lamp-down"}`}
            />
            <div className="min-w-0">
              <div className="sb-status-label">
                {alive === null ? "Gateway" : alive ? "Gateway live" : "Gateway down"}
              </div>
              <div className="sb-status-addr">{host || "…"}</div>
            </div>
          </div>
          <button onClick={logout} className="sb-quit">
            <Icon name="logout" size={15} />
            Disconnect
          </button>
        </div>
      </aside>

      {palette && <CommandPalette groups={groups} onClose={() => setPalette(false)} />}
    </>
  );
}
