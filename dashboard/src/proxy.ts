import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSession, memberPathAllowed, SESSION_COOKIE } from "@/lib/session";
import { AuthStore } from "@/gw/core/authStore.js";
import { getDataDir, getConfigPath } from "@/gw/appDirs.js";
import { loadConfig } from "@/gw/config.js";
import { clientKeyFingerprint } from "@/gw/middleware/auth.js";

/**
 * Gate every page and admin-proxy route behind a valid session.
 * Members (access-key login) only reach Usage + related read APIs.
 */
const OPEN = ["/login", "/api/login", "/api/logout", "/api/me", "/health", "/v1", "/admin"];

function validFingerprints(): string[] {
  try {
    return (loadConfig(getConfigPath()).server.api_keys ?? []).map(clientKeyFingerprint);
  } catch {
    return [];
  }
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (OPEN.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = parseSession(token, {
    currentAdminVersion: AuthStore.currentVersion(getDataDir()),
    validFingerprints: validFingerprints(),
  });

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
  }

  if (session.role === "member") {
    // Members land on Usage, not the full console home
    if (pathname === "/" || pathname === "/endpoint") {
      const url = req.nextUrl.clone();
      url.pathname = "/usage";
      return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
    }
    if (!memberPathAllowed(pathname)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "forbidden — access key sessions can only view their own usage" },
          { status: 403, headers: { "Cache-Control": "no-store" } },
        );
      }
      const url = req.nextUrl.clone();
      url.pathname = "/usage";
      return NextResponse.redirect(url, { headers: { "Cache-Control": "no-store" } });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
