"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";

type NavItem = { href: string; label: string; icon: string };

const MAIN: NavItem[] = [
  { href: "/", label: "Endpoint", icon: "api" },
  { href: "/keys", label: "Access Keys", icon: "key" },
  { href: "/providers", label: "Providers", icon: "dns" },
  { href: "/combos", label: "Combos", icon: "layers" },
  { href: "/usage", label: "Usage", icon: "bar_chart" },
  { href: "/quota", label: "Budgets", icon: "data_usage" },
  { href: "/tools", label: "CLI Tools", icon: "terminal" },
];

const SYSTEM: NavItem[] = [
  { href: "/console", label: "Server Console", icon: "receipt_long" },
  { href: "/config", label: "Settings", icon: "settings" },
];

const MEMBER_NAV: NavItem[] = [
  { href: "/usage", label: "Usage", icon: "bar_chart" },
  { href: "/tools", label: "CLI Tools", icon: "terminal" },
];

export function Sidebar() {
  const path = usePathname();
  const [role, setRole] = useState<"admin" | "member" | null>(null);

  useEffect(() => {
    fetch("/api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { role?: string } | null) => {
        if (d?.role === "member") setRole("member");
        else if (d?.role === "admin") setRole("admin");
      })
      .catch(() => {});
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

  const link = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`nav-isle${active ? " nav-isle-active" : ""}`}
        data-label={item.label}
      >
        <Icon name={item.icon} size={20} fill={active} />
      </Link>
    );
  };

  const mainNav = role === "member" ? MEMBER_NAV : MAIN;
  const systemNav = role === "member" ? [] : SYSTEM;
  const homeHref = role === "member" ? "/usage" : "/";

  return (
    <aside className="app-sidebar">
      <Link href={homeHref} className="brand-isle" data-label="aigloo">
        <svg viewBox="0 0 512 512" width="26" height="26" fill="none" aria-hidden>
          <g transform="translate(60, 60) scale(14)" stroke="currentColor" strokeLinecap="round">
            <path d="M4 20C4 12.268 8.477 6 14 6C19.523 6 24 12.268 24 20" strokeWidth="2"/>
            <path d="M8 20C8 14.477 10.686 10 14 10C17.314 10 20 14.477 20 20" strokeWidth="1.5" opacity="0.5"/>
            <line x1="3" y1="20" x2="25" y2="20" strokeWidth="2"/>
          </g>
        </svg>
      </Link>

      <div className="nav-isle-divider nav-isle-divider-brand" />

      <nav className="flex flex-col items-center gap-4">
        {mainNav.map(link)}
        {systemNav.length > 0 && (
          <>
            <div className="nav-isle-divider" />
            {systemNav.map(link)}
          </>
        )}
      </nav>

      {/* Separate disconnect from nav — mt-auto is a no-op on the short floating rail */}
      <div className="nav-isle-divider nav-isle-divider-logout" />
      <button onClick={logout} className="nav-isle" data-label="Disconnect">
        <Icon name="logout" size={19} />
      </button>
    </aside>
  );
}
