# Multi-stage build — produces the same standalone artifacts the npm-published
# package ships (dist/ + dashboard/.next/standalone), so the container behaves
# identically to `npm install -g aigloo && aigloo`. See src/cli.ts spawnDashboard()
# and package.json's prepublishOnly for the mechanics being mirrored here.

FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN npm ci --prefix dashboard

COPY . .

RUN npm run build
RUN npm run build --prefix dashboard

# Next's standalone output ships its own traced node_modules; cli.ts expects it
# renamed to vendor/ (NODE_PATH) and .next/static copied alongside server.js —
# same fixup prepublishOnly does for npm publishes. Using cpSync+rmSync instead
# of renameSync here (unlike prepublishOnly, which runs on a normal host FS):
# BuildKit's layered/overlay filesystem can put the source and dest on
# different devices, and a plain rename fails with EXDEV in that case.
RUN node -e "const{cpSync,rmSync,existsSync}=require('fs');const p='dashboard/.next/standalone/node_modules';if(existsSync(p)){cpSync(p,'dashboard/.next/standalone/vendor',{recursive:true});rmSync(p,{recursive:true,force:true});}cpSync('dashboard/.next/static','dashboard/.next/standalone/.next/static',{recursive:true})"

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# root deps for dist/cli.js (undici, yaml, zod) — the standalone dashboard build
# carries its own vendored deps separately, this is just the launcher's.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# cli.ts hard-requires dashboard/package.json to exist before it will start,
# even though the standalone server doesn't need dashboard/node_modules.
COPY --from=builder /app/dashboard/package.json ./dashboard/package.json
COPY --from=builder /app/dashboard/.next/standalone ./dashboard/.next/standalone
COPY --from=builder /app/dashboard/.next/static ./dashboard/.next/static
COPY net-preload.cjs ./net-preload.cjs
COPY config.example.yaml ./config.example.yaml

ENV AIGLOO_DATA_DIR=/data
VOLUME /data
EXPOSE 18080

# -y: skip the interactive terminal menu (no TTY in a container)
# -n: don't try to open a host browser
CMD ["node", "dist/cli.js", "-y", "-n"]
