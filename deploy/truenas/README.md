# Parlay Projector — TrueNAS SCALE deployment

TrueNAS runs the **pre-built container image** published by GitHub Actions. It
never builds the app and never holds a copy of the source. To change the
application you push to GitHub; TrueNAS only pulls a newer image.

| | |
|---|---|
| Custom App name | `parlayprojector` (TrueNAS strips the hyphen) |
| Image | `ghcr.io/j1-hypz/parlay-projector:latest` |
| Container port | `3000` |
| Host port | `3000` (change in the YAML if taken) |
| Compose file | [`deploy/truenas/compose.yaml`](compose.yaml) |
| Persistent storage | none — the app is stateless ([see section 9](#9-storage-for-future-phases)) |
| URL once running | `http://<TRUENAS-IP>:3000` |

---

## 1. Before you install

The image must exist in GHCR first. Push to `main` and let the
**Build and Publish** workflow finish, then confirm the package appears under
`https://github.com/j1-hypz?tab=packages`.

**The GHCR package is currently public**, so TrueNAS pulls it anonymously and
needs no registry credentials. The source repository remains private.

If the package is ever made private again, follow
[section 4](#4-private-ghcr-access) before installing, or the pull will fail
with `unauthorized`.

---

## 2. Install as a Custom App

1. Open the TrueNAS web interface.
2. Go to **Apps → Discover Apps**.
3. Click **Custom App** (top right).
4. Choose **Install via YAML**.
5. Paste the entire contents of [`compose.yaml`](compose.yaml).
6. Set the application name to **`parlay-projector`**. TrueNAS stores it as
   **`parlayprojector`** — hyphens are stripped. That stored name is what
   `TRUENAS_APP_NAME` must match.
7. Before saving, edit these values in the YAML if needed:
   - `SITE_URL` — set to the URL you will actually reach the app on, e.g.
     `http://truenas.lan:3000` or `https://parlay.example.com`. This is only
     used for absolute OpenGraph/metadata URLs.
   - the host side of `ports:` — change `"3000:3000"` to e.g. `"3080:3000"`
     if port 3000 is already in use on the NAS.
8. Save / Install.

TrueNAS pulls the image and starts the container. The app moves
`DEPLOYING → RUNNING`.

Open `http://<TRUENAS-IP>:3000`.

### Verifying

The container exposes a liveness endpoint used by the Docker health check:

```bash
curl http://<TRUENAS-IP>:3000/health
```

Expected response:

```json
{"status":"ok","service":"parlay-projector"}
```

TrueNAS will also show the app as healthy once the health check passes
(first check runs 20s after start).

---

## 3. Environment variables

Set in the compose YAML. None of these are secrets.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port the server listens on inside the container |
| `HOST` | `0.0.0.0` | Bind address. Must stay `0.0.0.0` or the port is unreachable |
| `SITE_URL` | `http://localhost:3000` | Public origin for absolute metadata URLs |

### Optional provider settings

All optional. The app runs with none of them set.

| Variable | Default | Purpose |
|---|---|---|
| `SPORTS_API_KEY` | public test key | **Recommended.** The free test key rate-limits hard and truncates league tables. Setting a real key also raises request concurrency and lowers cache lifetimes automatically |
| `ESPN_ENABLED` | `true` | Enrichment provider (records, form, head-to-head, broadcast). No credentials needed |
| `LIVE_REFRESH_INTERVAL_MS` | `30000` | Live scoreboard poll interval |
| `APP_TIMEZONE` | `Europe/London` | Which calendar day "today" is |

Add these as TrueNAS app environment values — **never** to the compose file in
the repository. `docs/data-providers.md` covers each provider in full.

Check what actually came up with:

```bash
curl http://<TRUENAS-IP>:3000/api/internal/providers
```

### Discord notifications

| Variable | Default | Purpose |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | *(empty)* | **Credential.** Where game updates are posted. Notifications are off entirely when unset |
| `NOTIFY_EVENTS` | `kickoff,final,postponed,cancelled` | Which transitions to announce |
| `NOTIFY_POLL_INTERVAL_MS` | `300000` | How often fixtures are re-checked. Floored at 60s |
| `NOTIFY_MAX_PER_POLL` | `20` | Ceiling on games announced in one poll |
| `APP_BASE_URL` | *(empty)* | Public origin, used only to link each message to its game page |

`DISCORD_WEBHOOK_URL` is the one value here that is a secret: anyone holding it
can post to your channel. Set it **only** through *Edit → Environment Variables*
in the TrueNAS app — never in the compose file, never in the repository, never
in the image. If it leaks, delete the webhook in Discord and create a new one;
there is no other way to revoke it.

Confirm delivery is configured — this reports presence, never the URL:

```bash
curl http://<TRUENAS-IP>:3000/api/internal/notifications
```

Full behaviour, batching and failure rules: `docs/notifications.md`.

That reports each provider's enabled state and health, and returns no
credentials.

---

## 4. Private GHCR access

> **Not currently needed.** The package is public, so TrueNAS pulls it without
> credentials. This section applies only if you make the package private again.

Choose one:

### Option A — make the package public (simplest)

Package visibility is independent of repository visibility. You can publish the
**image** publicly while the **source stays private**. TrueNAS then needs no
credentials at all.

1. Go to `https://github.com/users/j1-hypz/packages/container/parlay-projector/settings`
2. **Danger Zone → Change visibility → Public**

> This makes the built container image downloadable by anyone. The image
> contains your compiled frontend. It does not contain source, `.env` files, or
> secrets, but anyone could run it. Only do this if you are comfortable with
> that. Nothing in this repository has changed the visibility for you.

### Option B — authenticate TrueNAS to GHCR (keeps everything private)

Create a **classic** personal access token with the single scope
`read:packages`:

`GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)`

Then log the TrueNAS Docker daemon into GHCR over SSH:

```bash
echo '<TOKEN>' | sudo docker login ghcr.io -u j1-hypz --password-stdin
```

This writes credentials to the NAS's Docker config so subsequent image pulls
succeed. Re-run it if the token expires.

> The exact location of registry credential settings in the web interface
> varies between TrueNAS releases; the `docker login` route above works
> consistently on Docker-based TrueNAS SCALE versions (24.10 and later).

Do **not** put the token in the compose YAML, in this repository, or in any
GitHub Actions file.

---

## 5. Updating the application

### Mode 1 — manual (recommended to start with)

```
push to main -> GitHub Actions builds + publishes :latest -> you redeploy on TrueNAS
```

> **Pull before you redeploy.** TrueNAS redeploys with
> `docker compose up --force-recreate`, which recreates containers but does
> **not** re-pull a tag it already has locally. On a moving tag like `:latest`,
> a redeploy on its own can silently restart the previous image.

Over SSH — reliable on every TrueNAS version:

```bash
sudo docker pull ghcr.io/j1-hypz/parlay-projector:latest
sudo midclt call app.redeploy parlayprojector
```

Or in the web interface: **Apps → Installed → `parlayprojector`**, use the
image/update action to pull, then **⋮ → Update**. If the app restarts on the
old build, the pull did not happen — use the SSH sequence above.

Nothing on the NAS needs editing. The new version is whatever `main` built.

### Mode 2 — automatic

```
push to main -> GitHub Actions builds + publishes :latest -> TrueNAS redeploys itself
```

Requires the self-hosted runner ([section 7](#7-self-hosted-runner)) and the
repository secrets ([section 6](#6-github-repository-secrets)).

Turn it on:

```bash
gh variable set ENABLE_TRUENAS_AUTO_DEPLOY --body true
```

Turn it off:

```bash
gh variable set ENABLE_TRUENAS_AUTO_DEPLOY --body false
```

Until that variable is exactly `true`, the deploy workflow only runs when you
trigger it by hand from **Actions → Deploy TrueNAS → Run workflow**. Manual runs
work whether or not auto-deploy is enabled.

---

## 6. GitHub repository secrets

Required by the **Deploy TrueNAS** workflow only. The build workflow needs none
of these — it uses the built-in `GITHUB_TOKEN`.

| Secret | Required | Example | Notes |
|---|---|---|---|
| `TRUENAS_HOST` | yes | `192.168.1.50` or `truenas.lan` | Hostname or IP, **no scheme** |
| `TRUENAS_API_KEY` | yes | — | API key with the `APPS_WRITE` role |
| `TRUENAS_USERNAME` | no | `admin` | Log output only; the API key carries identity |
| `TRUENAS_APP_NAME` | no | `parlayprojector` | Must match the name TrueNAS stored |

Optional repository **variables** (not secrets):

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_TRUENAS_AUTO_DEPLOY` | unset | `true` enables automatic deploys |
| `TRUENAS_PORT` | `443` | Management interface port |
| `TRUENAS_API_PATH` | `/api/current` | Use `/websocket` on TrueNAS ≤ 24.10 |
| `TRUENAS_IMAGE` | `ghcr.io/j1-hypz/parlay-projector:latest` | Image pulled before redeploy |
| `TRUENAS_SKIP_PULL` | unset | `true` redeploys without pulling first |
| `TRUENAS_CA_BUNDLE` | unset | Path on the runner to a trusted CA for a self-signed cert |
| `TRUENAS_TIMEOUT` | `600` | Seconds to wait for redeploy |

### Creating the API key

TrueNAS web interface → top-right **user icon → API Keys → Add**. Give it a
name, and grant it a role that includes `APPS_WRITE`. Copy the value once — it
is not shown again.

### Adding the secrets

```bash
gh secret set TRUENAS_HOST
gh secret set TRUENAS_API_KEY
```

Each command prompts for the value. Never pass secrets as command-line
arguments, and never commit them.

---

## 7. Self-hosted runner

Automatic deployment needs a runner **on your LAN**, because the TrueNAS
management API is deliberately not exposed to the internet.

The runner can live on TrueNAS itself, a VM, a Proxmox guest, or any
always-on Linux machine that can reach the NAS management interface.

1. `GitHub repo → Settings → Actions → Runners → New self-hosted runner`
2. Follow the Linux instructions shown there.
3. Give it these labels — the workflow targets all three:

   ```
   self-hosted
   linux
   truenas-lan
   ```

4. Install Python 3.11+ and pip on the runner. The workflow installs the
   `websockets` package itself from `scripts/requirements.txt`.

Requirements: outbound HTTPS to GitHub, and network access to
`https://<TRUENAS_HOST>`. No inbound ports, no port forwarding, no exposure of
the TrueNAS interface.

### TLS

The deploy script verifies certificates by default.

- **TrueNAS has a valid certificate** — nothing to do.
- **TrueNAS uses a self-signed certificate** — export its CA certificate to the
  runner and set the `TRUENAS_CA_BUNDLE` variable to that path.
- Disabling verification is possible via `TRUENAS_INSECURE_SKIP_VERIFY=true`,
  but it is not recommended and the script prints a warning when used.

---

## 8. Rolling back

Every successful build on `main` publishes two tags:

```
ghcr.io/j1-hypz/parlay-projector:latest
ghcr.io/j1-hypz/parlay-projector:<short-sha>     e.g. :a38d21f
```

To roll back:

1. Find the good commit's short SHA — in the Actions run summary, or with
   `git log --oneline`.
2. **Apps → Installed → `parlayprojector` → Edit**.
3. Change the image line from `:latest` to that SHA:

   ```yaml
   image: ghcr.io/j1-hypz/parlay-projector:a38d21f
   ```

4. Save. TrueNAS pulls that exact image and restarts.

The app stays pinned to that SHA until you change it back to `:latest`. While
pinned, a redeploy will **not** pick up new builds — that is the point.

Old images are never deleted automatically, so previous SHAs remain available.

---

## 9. Storage for future phases

The application is **stateless today**: no database, no uploads, no writable
paths. It needs no dataset and no `volumes:` entry, which is why a failed
deploy loses nothing.

That changes when a database or cached sports data arrives. The rule to keep:

> **The web container is disposable. Data lives in datasets that outlive it.**

Every push replaces the container. Anything written *inside* it is gone on the
next redeploy — by design. Persistent data belongs in ZFS datasets mounted into
the services that own it.

### Dataset layout

Create these under your apps pool (**Storage → pool → Add Dataset**, then add
children beneath the parent):

```
/mnt/<pool>/parlay-projector/
├── postgres/     database files
├── redis/        cache
└── data/         app-writable files, cached API responses
```

Use **datasets**, not plain directories — independent snapshots, quotas and
per-workload tuning. Cheap now, awkward to retrofit later.

### Settings worth getting right at creation

| Dataset | Setting | Why |
|---|---|---|
| `postgres` | Record Size **16K** | The 128K default causes heavy write amplification against Postgres' 8K pages |
| `postgres` | Access Time **Off** | Removes a metadata write on every read |
| `redis` | Record Size **16K** | Same reasoning; append-heavy workload |
| `data` | defaults | General file storage |

Add a snapshot task on `postgres` once a real database exists. That is the
rollback path for *data*, in the same way SHA-tagged images are the rollback
path for *code*.

### Ownership — the common failure

Containers write as a numeric UID. If the dataset is not owned by that UID the
container starts and then fails on first write, usually with an error that does
not obviously read as "permissions".

| Service | UID |
|---|---|
| `parlay-projector` (this app) | **1000** (`node`) |
| `postgres` official image | **999** |

Set it in **Storage → dataset → Edit Permissions**, or over SSH:

```bash
sudo chown -R 999:999 /mnt/<pool>/parlay-projector/postgres
```

Match the UID to the image that uses the dataset — not to your login user.

### Shape to preserve

Illustrative only. **Do not add this yet** — the application has no database.

```yaml
services:
  parlay-projector:
    image: ghcr.io/j1-hypz/parlay-projector:latest
    environment:
      DATABASE_URL: "postgres://parlay:PASSWORD@db:5432/parlay"
    depends_on:
      - db
    # still no volumes - the web container stays stateless

  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: parlay
      POSTGRES_USER: parlay
      POSTGRES_PASSWORD: PASSWORD
    volumes:
      - /mnt/<pool>/parlay-projector/postgres:/var/lib/postgresql/data
```

Note that only the database gets a volume. The web container never does.

**Never mount anything at `/app`** — that is where the application lives inside
the container; a volume there hides it and the container fails to start. Mount
to an unused path such as `/data`.

When that time comes, the database password is a real secret: it belongs in the
TrueNAS app configuration, never in the repository. `.env.example` already
reserves `DATABASE_URL` as a blank placeholder for exactly this.

---

## 10. Reverse proxy (optional, later)

The container serves plain HTTP on one port and holds no state, so it sits
behind Nginx Proxy Manager, Nginx, Traefik or a Cloudflare Tunnel without
changes. Point the proxy at `http://<TRUENAS-IP>:3000` and set `SITE_URL` to
the public URL so metadata URLs are correct.

Nothing here installs or configures a proxy.

---

## 11. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `unauthorized` / `manifest unknown` on pull | Private package with no credentials — see [section 4](#4-private-ghcr-access) |
| App stuck `DEPLOYING` | Image pull failing or health check never passing — check the app logs in TrueNAS |
| Redeploy ran but the old version is still served | The image was not re-pulled; `:latest` was already present locally. Pull explicitly first |
| Port already allocated | Change the host side of `ports:` in the app config |
| Deploy workflow queued forever | No runner with all three labels is online |
| `app 'parlayprojector' is not installed` | The app name on TrueNAS does not match `TRUENAS_APP_NAME` — check for the stripped hyphen |
| `TLS verification failed` | Self-signed certificate — set `TRUENAS_CA_BUNDLE` |
| OpenGraph links point at localhost | `SITE_URL` not set to the real URL |
