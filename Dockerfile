# syntax=docker/dockerfile:1.7
# Multi-stage build — produces the same standalone artifacts the npm-published
# package ships (dist/ + dashboard/.next/standalone), so the container behaves
# identically to `npm install -g aigloo && aigloo`. See src/cli.ts spawnDashboard()
# and package.json's prepublishOnly for the mechanics being mirrored here.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN --mount=type=cache,target=/root/.npm npm ci --prefix dashboard

COPY . .

RUN npm run build
RUN npm run build --prefix dashboard

# Next's standalone output ships traced deps under node_modules; npm pack strips
# every dir named node_modules, so rename → vendor (same as prepublishOnly /
# scripts/prepare-standalone.mjs). Use cp+rm instead of rename: BuildKit overlay
# FS can put source/dest on different devices (EXDEV).
RUN node scripts/prepare-standalone.mjs

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# root deps for dist/cli.js (undici, yaml, zod) — the standalone dashboard build
# carries its own vendored deps separately, this is just the launcher's.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY --from=builder /app/dist ./dist
# cli.ts hard-requires dashboard/package.json to exist before it will start,
# even though the standalone server doesn't need dashboard/node_modules.
COPY --from=builder /app/dashboard/package.json ./dashboard/package.json
COPY --from=builder /app/dashboard/.next/standalone ./dashboard/.next/standalone
COPY --from=builder /app/dashboard/.next/static ./dashboard/.next/static
COPY net-preload.cjs ./net-preload.cjs
COPY config.example.yaml ./config.example.yaml
COPY docker-entrypoint.sh /docker-entrypoint.sh

ENV AIGLOO_DATA_DIR=/data
VOLUME /data
EXPOSE 18080

# su-exec drops from root to the built-in `node` user after the entrypoint
# chowns the (possibly root-owned, freshly-mounted) volume. node:22-alpine
# already has a `node` user (uid 1000).
RUN apk add --no-cache su-exec && \
  mkdir -p /data && chown -R node:node /app /data && \
  chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
# -y: skip the interactive terminal menu (no TTY in a container)
# -n: don't try to open a host browser
CMD ["node", "dist/cli.js", "-y", "-n"]
