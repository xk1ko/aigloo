<p align="center">
  <img src="./assets/wordmark.png" width="420" alt="aigloo">
</p>

<p align="center">
  <strong>Self-hosted AI gateway</strong><br>
  One endpoint · format translation · fallback routing · token saving · spend control · access keys
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/aigloo"><img src="https://img.shields.io/npm/v/aigloo.svg" alt="npm"></a>
  <a href="https://www.npmjs.com/package/aigloo"><img src="https://img.shields.io/npm/dm/aigloo.svg" alt="npm downloads"></a>
  <a href="https://hub.docker.com/r/xk1ko/aigloo"><img src="https://img.shields.io/docker/pulls/xk1ko/aigloo.svg?logo=docker&label=Docker%20pulls" alt="Docker Pulls"></a>
  <a href="https://github.com/xk1ko/aigloo/pkgs/container/aigloo"><img src="https://img.shields.io/badge/GHCR-xk1ko%2Faigloo-blue?logo=github" alt="GHCR"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.5-brightgreen.svg" alt="Node ≥22.5">
</p>

<p align="center">
  <a href="#features">Features</a> · <a href="#getting-started">Quick Start</a> · <a href="#token-savers">Token Savers</a> · <a href="#configuration">Config</a> · <a href="#supported-cli-tools">CLI Tools</a>
</p>

---

## Why aigloo?

Every AI app speaks a different API format. Every provider has different keys, models, and rate limits. You juggle configs, hit quota walls mid-session, and lose track of spend.

**aigloo fixes this.** One local endpoint, one key. Point any app at it — Claude Code, opencode, Cursor, Codex, or anything that supports a custom base URL. It translates formats, routes across providers with automatic fallback, compresses token-heavy context, and tracks every cent.

```bash
npm install -g aigloo && aigloo
```

First run bootstraps everything. Subsequent runs start instantly.

---

## How it works

```
  Your tools              aigloo                      Providers
  ──────────        ────────────────────         ──────────────
  Claude Code  ──┐                           ┌──► Anthropic
  opencode     ──┤  format translation       ├──► OpenAI
  Cursor       ──┼─► routing & fallback ─────┼──► OpenRouter
  Codex        ──┤  token compression        ├──► Gemini
  any app*     ──┘  spend tracking            └──► Ollama / custom
                     ▲
                     │
                one endpoint
                one API key

  * any app that supports a custom base URL + API key
```

1. **Add providers** — paste your API keys, pick models. Use `provider/model` directly (key round-robin) or define combo aliases for multi-provider fallback chains
2. **Point your tools** at `http://localhost:18080` with a gateway key
3. **Track everything** — per-request cost, token usage, budgets, alerts

---

## Features

- **Format translation** — OpenAI ↔ Anthropic on the fly, streaming included
- **Routing & fallback** — use `provider/model` directly (key round-robin) or define combo aliases for multi-provider fallback chains; auto-rotates keys on 429/5xx/timeout
- **Pricing** — per-model cost tracking with auto-fetched rates from [models.dev](https://models.dev) (4000+ models) and [LiteLLM](https://github.com/BerriAI/litellm) as backup; manual overrides always win
- **Token savers** — RTK compresses tool results, caveman trims prose, ponytail nudges minimal code, headroom compresses context — with per-request $ savings tracked on the Usage page
- **Access keys** — share gateway keys with model allowlist, rate limit, spend cap, and expiry
- **Budgets** — rolling spend caps (global/provider/model/key) with live countdown and per-token-type cost tracking
- **Alert notifications** — webhook, Telegram, or Discord alerts when budgets hit their threshold or run out. Deduped per budget window
- **Dashboard** — glassmorphic aigloo design: providers, combos, usage, budgets, CLI tools, live console, settings — all drag-to-reorder
- **Deploy anywhere** — npm global install, from source, or Docker (Docker Hub + GHCR, multi-platform)

<p align="center">
  <img src="./assets/screenshot-endpoint.png" width="860" alt="Endpoint page">
  <br><sub>Endpoint page — token saver toggles & endpoint config</sub>
</p>
<p align="center">
  <img src="./assets/screenshot-accesskey.png" width="860" alt="Access Keys page">
  <br><sub>Access Keys — model allowlist, rate limit, spend cap per key</sub>
</p>
<p align="center">
  <img src="./assets/screenshot-budgets.png" width="860" alt="Budgets page">
  <br><sub>Budgets — rolling spend caps with live countdown</sub>
</p>

---

## Getting started

### Quick start

```bash
npm install -g aigloo
aigloo
```

The CLI seeds `config.yaml`, builds the dashboard, opens your browser. One URL serves everything — dashboard, API, and admin: `http://localhost:18080`.

A terminal menu offers: **Web UI** / **Terminal** (logs) / **Hide to Tray** (macOS · Linux · Windows) / **Exit**.
Flags: `-p/--port`, `-n/--no-browser`, `-y/--yes`, `-t/--tray`.

### From source

```bash
git clone https://github.com/xk1ko/aigloo.git
cd aigloo && npm install
cp config.example.yaml config.yaml   # add providers + a server key
npm install --prefix dashboard
./run.sh                              # Ctrl-C to stop
```

### Docker

```bash
docker run -d -p 18080:18080 -v "$HOME/.aigloo:/data" --name aigloo xk1ko/aigloo:latest
```

Serves the same `http://localhost:18080` — dashboard, API, and admin. See [DOCKER.md](./DOCKER.md) for `docker compose`, env vars, and update instructions.

### Connect your tools

```bash
# Claude Code (Anthropic format)
export ANTHROPIC_BASE_URL=http://localhost:18080
export ANTHROPIC_API_KEY=my-key

# opencode / Cursor / Cline / Codex (OpenAI format)
export OPENAI_BASE_URL=http://localhost:18080/v1
export OPENAI_API_KEY=my-key
```

The dashboard's **CLI Tools** page detects installed tools and writes configs for you.

**Model resolution** (in order): combo alias → `provider/model`.

Any app that supports a custom base URL + API key can use aigloo — just set the model to `provider/model`.

---

## Supported CLI tools

Claude Code · opencode · Cursor · Codex · Cline · Continue · Roo · Aider · Gemini CLI · Qwen Code · Kilo Code · Crush · Droid · Copilot

Any app that supports a custom base URL + API key works — just set the model to `provider/model`.

---

## Configuration

**Everything is configurable from the dashboard** — providers, combos, budgets, token savers, access keys, and settings. No need to edit files manually.

Under the hood, `config.yaml` is the source of truth and **hot-reloads** — any change made in the dashboard writes to this file instantly. You can also edit it by hand if you prefer; changes apply without restart.

<details>
<summary><strong>config.yaml reference (click to expand)</strong></summary>

```yaml
server:
  host: 0.0.0.0
  port: 18080
  api_keys: [my-key]        # empty = auth OFF (localhost only)

endpoint:
  rtk: true                 # compress tool_result blocks
  caveman: full             # off | lite | full | ultra
  ponytail: lite            # off | lite | full | ultra
  headroom: { enabled: false }  # requires external headroom proxy running — see Token savers below

providers:
  - id: anthropic
    format: anthropic
    base_url: https://api.anthropic.com/v1
    api_keys: [sk-ant-xxx]
  - id: opencode-free
    format: openai
    base_url: https://opencode.ai/zen/v1
    free: true
    # auto_models: false    # fetch provider's /v1/models catalog (manual)

models:
  - alias: claude-sonnet-4-6
    target: [anthropic, opencode-free]   # fallback order
    model: [claude-sonnet-4-6, claude-sonnet-4-5]
    price_in: 3             # USD per 1M tokens
    price_out: 15

budgets:
  - scope: { type: global }
    unit: usd
    limit: 50
    window: 30day
```

</details>

A **combo** is a `models` entry — an alias routed to a provider chain. Strategies: `fallback` (default, sequential) or `round-robin` (spread load).

---

## Token savers

| Saver | What it does | Source | Install |
|-------|-------------|--------|---------|
| **RTK** | Compresses bulky `tool_result` blocks (git/grep/ls) | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | built-in |
| **Caveman** | Terse system prompt — cuts output prose | [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman) | built-in |
| **Ponytail** | Nudges minimal code (YAGNI, deletion) | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | built-in |
| **Headroom** | Pipes context through `/v1/compress` | [chopratejas/headroom](https://github.com/chopratejas/headroom) | **external** |

Headroom is the only external dependency — install from [chopratejas/headroom](https://github.com/chopratejas/headroom) (Python ≥ 3.10), run `headroom proxy`. Without it the toggle stays off; everything else works.

---

## Environment variables

| Variable | Purpose |
|----------|---------|
| `AIGLOO_CONFIG` | Config file path |
| `AIGLOO_DATA_DIR` | Usage DB directory |
| `AIGLOO_ADMIN_PASSWORD` | Admin password — seeds on first boot, then stored as scrypt hash in `auth.json`. Default `123456` |
| `AIGLOO_PORT` | Listen port (default 18080) |
| `SESSION_SECRET` | Dashboard session cookie signing key. Auto-generated and persisted if unset |
| `AIGLOO_PRICING_SYNC_ENABLED` | Auto-fetch model pricing from models.dev + LiteLLM (default `true`). Set `false` to disable |
| `AIGLOO_PRICING_SYNC_INTERVAL` | Pricing sync interval in seconds (default `86400` = 24h) |

Admin password and provider keys never reach the browser — the dashboard proxies `/admin/*` server-side.

---

## Data location

| OS | Path |
|----|------|
| macOS / Linux | `~/.aigloo/` |
| Windows | `C:\Users\<name>\.aigloo\` (`%USERPROFILE%\.aigloo`) |

Same folder name on every OS. Contains `config.yaml` and `usage.sqlite`. Delete the folder to reset everything.

---

## Development

```bash
npm run typecheck       # tsc, no emit
npm test                # vitest (unit + synthetic E2E)
npm run build           # compile to dist/
```

---

## ⭐ Star this repo

If aigloo helps you, consider giving it a star — it helps others discover it.

---

## Acknowledgements

Inspired by [9router](https://github.com/decolua/9router) — its feature set and dashboard shaped much of this project's direction.

## License

[MIT](./LICENSE) © xk1ko

## Contributing

Issues and ideas welcome: <https://github.com/xk1ko/aigloo/issues>
