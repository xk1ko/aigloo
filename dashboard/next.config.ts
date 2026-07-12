import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // Dashboard serves static assets / SVG icons — no runtime image optimizer.
  // Keeps the npm pack free of platform-native `sharp` binaries.
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  serverExternalPackages: ["undici", "yaml", "zod", "sql.js", "node:sqlite"],
  outputFileTracingIncludes: {
    "/": ["./node_modules/sql.js/**/*"],
  },
  // Prefer excluding sharp from file tracing when present; prepare-standalone
  // also strips any that still land in the standalone tree.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/sharp/**/*",
      "node_modules/@img/**/*",
      "node_modules/detect-libc/**/*",
    ],
  },
  // Ordinary page/asset responses (login, providers, budgets…) previously shipped
  // with none of these — only the hand-built /admin, /v1, /api/gw route handlers
  // set them (see dashboard/src/lib/http.ts). next.config.ts runs in a config-time
  // context that can't import app source, so this is intentionally its own copy.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "0" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  turbopack: {
    root,
    resolveAlias: {
      "@/gw": resolve(root, "../dist"),
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@/gw": resolve(root, "../dist"),
    };
    return config;
  },
};

export default nextConfig;
