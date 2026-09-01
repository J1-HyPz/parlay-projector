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
| `/games/:gameId` | Individual game detail ([docs](#game-detail-api)) |
| `/health` | Liveness endpoint for the container health check |
| `/api/home` | Aggregated homepage data ([docs](#homepage-api)) |
| `/api/home/games` | Today's games |
| `/api/home/news` | Recent sports news |
| `/api/home/accuracy` | Prediction accuracy |
| `/api/games/:gameId` | Detail for one game |

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
| `pnpm test` | Homepage backend tests (Node's built-in runner) |
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

## Homepage API

The Home page is backed by four read-only endpoints. Nothing else in the app has
a backend yet — Schedule, Live, Parlays and Profile remain frontend skeletons.

All responses are JSON, `cache-control: no-store`, and freshness is managed by a
server-side cache so a browser refresh does not become a provider request.

### `GET /api/home`

Aggregated payload used by the Home page: one request for all four sections.

| Parameter | Values | Default |
|---|---|---|
| `sport` | `all` `nfl` `nba` `mlb` `nhl` `football` | `all` |
| `limit` | 1-20 (news articles) | `6` |
| `range` | `all-time` `30d` (accuracy window) | `all-time` |

```json
{
  "date": "2026-09-01",
  "timezone": "Europe/London",
  "summary": { "games_today": 12, "sports_active": 4, "accuracy": null, "predictions_settled": 0 },
  "games": [],
  "news": [],
  "accuracy": { "accuracy": null, "correct": 0, "incorrect": 0, "settled": 0, "range": "all-time" },
  "errors": []
}
```

`errors` names any section that degraded, e.g. `["news_data_unavailable"]`. The
other sections still return data — one provider outage never blanks the page.

### `GET /api/home/games`

Games scheduled for today in `APP_TIMEZONE`. **Sports information only**: no
odds, spreads, totals, bookmakers or bet recommendations are requested,
normalised, stored or returned.

Parameter: `sport` (as above). An unrecognised value returns `400`.

```json
{
  "date": "2026-09-01",
  "timezone": "Europe/London",
  "sport": "all",
  "games": [
    {
      "id": "2398051",
      "sport": "football",
      "league": "Premier League",
      "league_badge": "https://.../league.png",
      "start_time": "2026-09-01T19:45:00.000Z",
      "status": "scheduled",
      "provider_status": "NS",
      "home_team": { "id": "133604", "name": "Arsenal", "logo": "https://.../home.png" },
      "away_team": { "id": "133616", "name": "Chelsea", "logo": "https://.../away.png" },
      "venue": { "name": "Emirates Stadium", "city": "England" },
      "broadcast": null
    }
  ]
}
```

`status` is normalised to `scheduled` | `live` | `finished` | `postponed` |
`cancelled` | `unknown`. The provider's own value is kept in `provider_status`
so switching provider does not change what the frontend sees.

### `GET /api/home/news`

Recent sports headlines. Metadata, short provider summaries and source links
only — article bodies are never fetched, stored or returned.

| Parameter | Values | Default |
|---|---|---|
| `limit` | 1-20 (clamped) | `6` |

```json
{
  "articles": [
    {
      "id": "https://www.bbc.co.uk/sport/...#0",
      "headline": "Headline text",
      "summary": "Short provider summary.",
      "category": null,
      "source": "BBC Sport",
      "published_at": "2026-09-01T10:50:22.000Z",
      "image": "https://.../thumb.jpg",
      "url": "https://www.bbc.co.uk/sport/..."
    }
  ]
}
```

### `GET /api/home/accuracy`

How stored predictions scored against actual results.

`accuracy = correct settled / total settled x 100`, counting only predictions
whose real result is known. Pending, void, cancelled and unfinished-postponed
predictions are excluded.

| Parameter | Values | Default |
|---|---|---|
| `range` | `all-time` `30d` | `all-time` |

```json
{ "accuracy": 82.4, "correct": 103, "incorrect": 22, "settled": 125, "range": "all-time" }
```

With no prediction history the response is the empty state, and the UI shows
`--%`. No history is ever fabricated to populate the widget:

```json
{ "accuracy": null, "correct": 0, "incorrect": 0, "settled": 0, "range": "all-time" }
```

### Errors

Provider failures degrade rather than throw. The section returns empty data plus
a machine-readable code, HTTP 200:

| Code | Meaning |
|---|---|
| `sports_data_unavailable` | Every sports provider request failed |
| `news_data_unavailable` | Every configured news feed failed |
| `accuracy_unavailable` | The prediction store could not be read |

An invalid query parameter returns `400` with
`{ "error": "invalid_request", "message": "..." }`. Internal errors and stack
traces are never returned.

### Architecture

```
Home page
   -> /api/home route handler          (validates input, no provider logic)
      -> Homepage service              (runs sections concurrently)
         |- Sports service -> provider adapter -> TheSportsDB
         |- News service   -> provider adapter -> RSS feeds
         `- Accuracy service -> prediction repository -> DATA_DIR/predictions.json
```

Each provider sits behind a one-method interface with a single implementation.
Swapping providers means writing a new adapter and changing the one line that
constructs it — no route or component changes.

### External services and environment

| Variable | Default | Purpose |
|---|---|---|
| `APP_TIMEZONE` | `Europe/London` | Which calendar day "today" is |
| `SPORTS_API_URL` | TheSportsDB v1 | Sports provider base URL |
| `SPORTS_API_KEY` | `3` (public test key) | Sports provider key. **Server-side only** |
| `SPORTS_CACHE_TTL_SECONDS` | `120` | Games cache lifetime |
| `SPORTS_TIMEOUT_MS` | `8000` | Sports request timeout |
| `NEWS_FEED_URLS` | BBC Sport RSS | Comma-separated news feeds |
| `NEWS_CACHE_TTL_SECONDS` | `600` | News cache lifetime |
| `NEWS_TIMEOUT_MS` | `8000` | News request timeout |
| `DATA_DIR` | `./data` | Persistent data directory |

Provider credentials are read only inside route handlers and services, are never
sent to the browser, and are stripped from log output.

### Prediction storage

No database. The homepage only needs to *read* settled predictions, so records
live in `$DATA_DIR/predictions.json` behind a small repository interface:

```json
{
  "predictions": [
    {
      "id": "p-1",
      "game_id": "2398051",
      "sport": "football",
      "predicted_outcome": "home",
      "actual_outcome": "home",
      "prediction_result": "correct",
      "created_at": "2026-08-30T12:00:00.000Z",
      "settled_at": "2026-08-31T21:00:00.000Z"
    }
  ]
}
```

`prediction_result` is `correct` | `incorrect` | `pending` | `void`. A missing,
empty or malformed file all mean the same thing: no history, accuracy `null`.

**`DATA_DIR` must be a mounted volume in production.** A container filesystem is
ephemeral and would lose prediction history on every redeploy. The Docker image
declares `/data`; the TrueNAS compose file mounts a host path onto it. The
directory must be writable by UID 1000 (the container's `node` user).

Prediction *generation* is not implemented — that is a future task. This backend
only reads existing records and scores them.

---

## Game detail API

Individual game pages live at `/games/:gameId`, using the sports provider's own
event id — the same id the Home page already receives. No second identifier
scheme exists.

```
Games Today card  ->  /games/<event-id>  ->  GET /api/games/<event-id>
                                                -> sports service -> provider
```

### `GET /api/games/:gameId`

One coherent response covering the game, both teams, standings and recent
results, so the page makes a single request.

| Status | Body |
|---|---|
| `200` | `{ "game": { ... } }` |
| `404` | `{ "error": "game_not_found", "message": "..." }` — unknown or malformed id |
| `503` | `{ "error": "game_data_unavailable", "message": "..." }` — provider failure |

```json
{
  "game": {
    "id": "2398051",
    "sport": "football",
    "league": "Argentinian Primera Division",
    "season": "2026",
    "round": "7",
    "start_time": "2026-09-01T00:15:00.000Z",
    "status": "finished",
    "provider_status": "FT",
    "home_team": {
      "id": "137786", "name": "Instituto", "abbreviation": null,
      "logo": "https://.../badge.png", "stadium": "Estadio Juan Domingo Peron",
      "location": "Cordoba, Argentina", "formed_year": 1918
    },
    "away_team": { "...": "same shape" },
    "venue": { "name": "Estadio Juan Domingo Peron", "city": "Argentina" },
    "score": { "home": 1, "away": 0 },
    "game_state": null,
    "broadcast": null,
    "standings": { "home": { "rank": 1, "form": ["D","L","W"], "...": "" }, "away": null },
    "recent_games": { "home": [], "away": [] },
    "head_to_head": []
  }
}
```

`score` is `null` for scheduled games — never a fabricated `0-0`. `game_state`
is populated only while a game is live. Any field the provider does not supply
is `null` and the UI omits that row.

### Caching

Game detail is cached by status, because volatility differs sharply:

| Status | TTL |
|---|---|
| `live` | 1 minute |
| `scheduled` | 10 minutes |
| `finished` | 6 hours — the result is settled |
| `postponed` / `cancelled` | 30 minutes |
| unknown id (404) | 1 minute |

### What the provider supplies, and what it does not

Populated from TheSportsDB: game, venue, season, round, score, team badges and
abbreviations, league standings (record, position, form) and recent results.

Deliberately absent, because the provider does not expose them on the
configured tier — these render as empty states rather than invented data:

| Section | Reason |
|---|---|
| Head to Head | `eventsh2h.php` returns 404 on this tier |
| Broadcast | No TV/network field exists in the event payload at all |
| Game Timeline | No play-by-play or event feed is available for any sport |
| Sport-specific stats | Only one shared league-table stat set is published, so passing yards, ERA, field-goal percentage and similar are not available |

`Parlay Projector Analysis` is reserved on the page and states *Projection
unavailable*. No prediction logic exists yet and no confidence figure is
fabricated.

**No betting data.** There are no odds, spreads, totals, bookmakers, markets or
sportsbook links in the contract, the services or the UI.

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

Stages, in order — every one is a hard gate. A failure at any stage stops the
pipeline and leaves the currently deployed version untouched:

```
Install dependencies → Lint → Type check → Test → Production build
  → Verify dist/standalone/server.js → Docker build
  → Smoke test container → Publish GHCR
```

The smoke test starts the built image and checks that `/health` responds, that
`GET /` returns 200 and renders, and that the container is not running as root.
An image that does not serve traffic never reaches GHCR.

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
| `DATABASE_URL` | *(blank)* | Reserved — unused |

Homepage backend variables are documented in [Homepage API](#external-services-and-environment).

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
