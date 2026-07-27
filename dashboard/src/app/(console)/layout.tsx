"use client";

import { useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const [sbOpen, setSbOpen] = useState(false);

  return (
    <div className="app-shell">
      <Sidebar open={sbOpen} onClose={() => setSbOpen(false)} />
      {sbOpen && <button className="sb-backdrop" onClick={() => setSbOpen(false)} aria-label="Close navigation" />}
      <div className="app-main">
        <TopBar onMenu={() => setSbOpen((v) => !v)} />
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
