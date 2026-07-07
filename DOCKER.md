# Docker

Run aigloo in a container. Published image: [`xk1ko/aigloo`](https://hub.docker.com/r/xk1ko/aigloo) — multi-platform `linux/amd64` + `linux/arm64`.

---

# 👤 For Users

## Quick start

```bash
docker run -d \
  -p 18080:18080 \
  -v "$HOME/.aigloo:/data" \
  --name aigloo \
  xk1ko/aigloo:latest
```

Open: http://localhost:18080 — default password `123456` (change it in Settings after logging in).

Or with compose:

```bash
docker compose up -d
```

## Manage container

```bash
docker logs -f aigloo        # view logs
docker stop aigloo           # stop
docker start aigloo          # start again
docker rm -f aigloo          # remove
```

## Data persistence

```bash
-v "$HOME/.aigloo:/data"
```

Without a mount, data lives inside the container and is lost on `docker rm`. Data layout under `/data`:

```text
/data/
├── config.yaml       # providers, combos, endpoint settings
├── auth.json          # admin password hash
├── session-secret      # random, generated on first boot — do not hardcode
└── usage.sqlite        # usage/quota/savings history
```

## Optional env vars

```bash
docker run -d \
  -p 18080:18080 \
  -v "$HOME/.aigloo:/data" \
  -e AIGLOO_ADMIN_PASSWORD=your-password \
  -e AIGLOO_PORT=18080 \
  --name aigloo \
  xk1ko/aigloo:latest
```

`SESSION_SECRET` is optional — leave it unset and the container generates and persists a random one to `/data/session-secret` on first boot. Only set it explicitly if you need the same secret across a fleet of instances.

## Update to latest

```bash
docker pull xk1ko/aigloo:latest
docker rm -f aigloo
# re-run the quick start command
```

---

# 🛠 For Developers

## Build image locally (test)

```bash
docker build -t aigloo .

docker run --rm -p 18080:18080 \
  -v "$HOME/.aigloo:/data" \
  aigloo
```

## Publish (automatic via CI)

Push a git tag `v*` → GitHub Actions builds multi-platform (amd64+arm64) and pushes to:
- `ghcr.io/xk1ko/aigloo:{version}` + `:latest`
- `xk1ko/aigloo:{version}` + `:latest`

Note the image tag drops the `v` prefix (`docker pull xk1ko/aigloo:1.1.5`, not `:v1.1.5`) — that's `docker/metadata-action`'s `type=semver` behavior, same convention 9router uses.

```bash
git tag v1.1.5 && git push origin v1.1.5
```

Requires repo secrets `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN` (a Docker Hub access token, not your account password) to be set under Settings → Secrets and variables → Actions.

Workflow: `.github/workflows/docker-publish.yml`
