# Parlay Projector by HyPz

A responsive multi-sport scheduling, live-score, sports analytics, and future
parlay projection web application.

## Overview

**Current status: frontend UI prototype.** No real sports data, predictions,
betting calculations, authentication, or backend functionality are implemented.
Every figure on screen is a placeholder.

| | |
|---|---|
| Framework | [vinext](https://github.com/cloudflare/vinext) — the Next.js App Router API running on Vite |
| UI | React 19, Tailwind CSS 4, lucide-react |
| Package manager | pnpm 11.19.0 (pinned via `packageManager`) |
| Node | 22.13+ |
| Lint / format | oxlint, oxfmt |
| Production output | self-contained Node bundle (`dist/standalone/`) |
| Container | `ghcr.io/j1-hypz/parlay-projector` |

### Routes

| Path | Description |
|---|---|
| `/` | Dashboard |
| `/schedule` | Seven-day schedule view |
| `/live` | Live scoreboard |
| `/parlays` | Projection workspace |
| `/profile` | Profile placeholder |
| `/health` | Liveness endpoint for the container health check |

---

## GitHub is the source of truth

```
Development machine
        │  git push
        ▼
GitHub repository ──────► GitHub Actions ──────► GitHub Container Registry
                                                          │
                                                          │ container image
                                                          ▼
                                                   TrueNAS SCALE
                                                          │
                                                          ▼
                                             Parlay Projector Custom App
```

The repository holds the application source, Dockerfile, compose templates,
workflows and deployment scripts. GHCR holds the built images. TrueNAS holds
only the running container and its deployment configuration.

**Do not edit application source on the TrueNAS server.** TrueNAS never builds
the app and must never become a second place where code lives. Every change
goes through GitHub, which produces the container that TrueNAS runs. Anything
edited directly on the NAS is lost on the next redeploy — and correctly so.

---

## Development

Requirements: Node.js 22.13+ and pnpm (via corepack).

```bash
git clone https://github.com/J1-HyPz/parlay-projector.git
cd parlay-projector
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:3000`. The dev server listens on `0.0.0.0`, so it is
also reachable from another device on the LAN at the dev machine's address.

Copy `.env.example` to `.env` to change ports or set `SITE_URL`. `.env*` files
are git-ignored.

### Scripts

| Command | Purpose |
|---|---|
| `pnpm dev` | Development server with HMR |
| `pnpm build` | Production build → `dist/standalone/` |
| `pnpm start` | Run the production bundle (`node dist/standalone/server.js`) |
| `pnpm lint` | oxlint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` | oxfmt (rewrites files) |
| `pnpm format:check` | oxfmt in check mode |

---

## Production build

```bash
pnpm build
pnpm start
```

`next.config.ts` sets `output: 'standalone'`, so `pnpm build` emits a
self-contained bundle:

```
dist/standalone/
├── server.js          entry point
├── dist/              compiled client + server output
├── public/            static assets
└── node_modules/      runtime dependencies only
```

That directory is the whole application. It needs no package manager, no dev
dependencies and no source checkout — which is exactly what the container ships.

The server reads `PORT` (default `3000`) and `HOST` (default `0.0.0.0`).

> **Note:** vinext uses `HOST`, not Next.js's `HOSTNAME`, to avoid colliding
> with the system-set `HOSTNAME` variable on Linux.

### Building for Cloudflare Workers instead

The original Workers build path is still available. Set `DEPLOY_TARGET`:

```bash
DEPLOY_TARGET=cloudflare pnpm build          # bash
$env:DEPLOY_TARGET='cloudflare'; pnpm build  # PowerShell
```

This re-enables the `@cloudflare/vite-plugin` in `vite.config.ts`. The default
(`node`) is what the container and TrueNAS use.

---

## Docker

Build and run locally:

```bash
docker build -t parlay-projector .
```

```bash
docker run --rm -p 3000:3000 parlay-projector
```

Or with Compose:

```bash
docker compose up --build
```

The image is a multi-stage build: a Node 22 Alpine build stage runs
`pnpm build`, and the runtime stage contains only Node, tini and
`dist/standalone/`. It runs as the unprivileged `node` user, listens on
`0.0.0.0:${PORT}`, forwards signals through tini for clean shutdown, and
carries a health check against `/health`.

The container is stateless and exposes one configurable HTTP port, which suits
a TrueNAS SCALE Custom App or a reverse proxy.

---

## GitHub deployment

### Build and Publish

[`.github/workflows/build-and-publish.yml`](.github/workflows/build-and-publish.yml)

| Trigger | Validate | Build image | Publish to GHCR |
|---|---|---|---|
| push to `main` | yes | yes | yes |
| pull request | yes | yes | no |
| other branches | yes | yes | no |
| manual dispatch | yes | yes | only from `main` |

Stages, in order — a failure at any stage stops the pipeline and leaves the
currently deployed version untouched:

```
Install dependencies → Lint → Type check → Production build
  → Verify dist/standalone/server.js → Docker build → Publish GHCR
```

Every successful build from `main` publishes two tags:

```
ghcr.io/j1-hypz/parlay-projector:latest
ghcr.io/j1-hypz/parlay-projector:<short-sha>
```

The SHA tag is what makes rollback possible; never rely on `latest` alone.

Authentication uses the built-in `GITHUB_TOKEN` with `packages: write`. No
personal access token is needed to publish.

---

## TrueNAS deployment

Full instructions: **[`deploy/truenas/README.md`](deploy/truenas/README.md)**

Short version:

1. Push to `main` and let **Build and Publish** finish.
2. Ensure the NAS can pull the image. The GHCR package is currently public,
   so no credentials are needed. See the deployment README if that changes.
3. TrueNAS → **Apps → Discover Apps → Custom App → Install via YAML**.
4. Paste [`deploy/truenas/compose.yaml`](deploy/truenas/compose.yaml).
5. Name the app `parlay-projector` — TrueNAS stores it as `parlayprojector`.
6. Open `http://<TRUENAS-IP>:3000`.

| | |
|---|---|
| TrueNAS app name | `parlayprojector` (hyphen stripped by TrueNAS) |
| Image | `ghcr.io/j1-hypz/parlay-projector:latest` |
| Port | `3000` |
| Storage | none — stateless ([layout for later](deploy/truenas/README.md#9-storage-for-future-phases)) |

### Two deployment modes

**Mode 1 — manual (start here).** Push, GitHub builds the image, then click
**Update** on the TrueNAS app to pull it. Use this until you have confirmed the
pipeline works end to end.

**Mode 2 — automatic.** Push, GitHub builds the image, and a self-hosted runner
on your LAN calls the TrueNAS API to redeploy. Requires a runner labelled
`self-hosted, linux, truenas-lan` and the repository secrets listed in the
deployment README.

Automatic deployment is **off by default**. Enable it with:

```bash
gh variable set ENABLE_TRUENAS_AUTO_DEPLOY --body true
```

You can always redeploy by hand from **Actions → Deploy TrueNAS → Run
workflow**, in either mode.

The TrueNAS management interface is never exposed to the internet. The runner
sits on the trusted LAN and reaches the API locally.

### Rollback

```yaml
image: ghcr.io/j1-hypz/parlay-projector:a38d21f   # instead of :latest
```

Edit the app's YAML on TrueNAS, save, redeploy. Details in the deployment
README.

---

## Updating the application

```bash
git pull
# edit files
git status
git add <files>
git commit -m "Describe change"
git push origin main
```

After the push:

1. **Validate** — dependencies, lint, type check, production build.
2. **Build Container** — Docker image built from the verified source.
3. **Publish GHCR** — pushed as `:latest` and `:<short-sha>`.
4. **Deploy TrueNAS** — automatic if enabled, otherwise redeploy on the NAS.

If any stage fails, nothing is published and the running app is unaffected.
Watch progress under the repository's **Actions** tab.

Never copy project files onto TrueNAS by hand.

---

## Environment variables

Application configuration — safe placeholders live in `.env.example`:

| Variable | Default | Purpose |
|---|---|---|
| `APP_PORT` | `3000` | Dev server port |
| `PORT` | `3000` | Production server port |
| `HOST` | `0.0.0.0` | Production bind address |
| `SITE_URL` | `http://localhost:3000` | Public origin for absolute metadata URLs |
| `DEPLOY_TARGET` | `node` | Build target: `node` or `cloudflare` |
| `SPORTS_API_URL` | *(blank)* | Reserved — unused |
| `SPORTS_API_KEY` | *(blank)* | Reserved — unused |
| `DATABASE_URL` | *(blank)* | Reserved — unused |

Deployment credentials are **not** application configuration. `TRUENAS_HOST`,
`TRUENAS_API_KEY`, `TRUENAS_USERNAME` and `TRUENAS_APP_NAME` are CI-only values
stored as GitHub repository secrets and consumed by the deploy workflow. They
must never appear in `.env`, `.env.example`, the compose files, the workflows,
or the container image.

Secrets of any kind — API keys, tokens, passwords, private keys — must never be
committed.

---

## Repository structure

```
parlay-projector/
├── app/                        routes (App Router)
│   ├── health/route.ts         liveness endpoint
│   ├── live/  parlays/  profile/  schedule/
│   ├── layout.tsx  page.tsx  globals.css
├── components/                 app shell + UI primitives
├── hooks/  lib/  public/
│
├── deploy/truenas/
│   ├── compose.yaml            TrueNAS Custom App YAML
│   └── README.md               TrueNAS installation guide
│
├── scripts/
│   ├── deploy-truenas.py       TrueNAS redeploy helper
│   └── requirements.txt
│
├── .github/workflows/
│   ├── build-and-publish.yml   validate → build → publish GHCR
│   └── deploy-truenas.yml      redeploy on TrueNAS (optional)
│
├── Dockerfile                  multi-stage production image
├── compose.yaml                local build-and-run
├── next.config.ts              output: 'standalone'
├── vite.config.ts              node (default) / cloudflare targets
└── .env.example
```

---

## Future development

The architecture is intended to accommodate — but does **not** currently
include — sports APIs, databases, backend services, prediction engines,
scheduled data collection, caching, authentication, a reverse proxy and HTTPS.

None of these are implemented. The container is stateless with a single HTTP
port, which keeps those options open.

When persistent data does arrive, keep the web container disposable and put the
data in ZFS datasets owned by the services that use it. The dataset layout,
recordsize tuning and container-UID ownership rules are documented in
[deploy/truenas/README.md § 9](deploy/truenas/README.md#9-storage-for-future-phases).
