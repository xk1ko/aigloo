"use client";

import { Button } from "./Button";
import { Icon } from "./Icon";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    // Hard navigation — see login/page.tsx for why router.replace()/
    // refresh() isn't enough (stale Router Cache entries from every page
    // visited while authenticated would keep serving without re-checking
    // the session).
    window.location.href = "/login";
  }
  return (
    <Button variant="ghost" onClick={logout} className="w-full">
      <Icon name="logout" size={17} />
      Disconnect
    </Button>
  );
}
