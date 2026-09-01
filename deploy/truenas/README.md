# Parlay Projector — TrueNAS SCALE deployment

TrueNAS runs the **pre-built container image** published by GitHub Actions. It
never builds the app and never holds a copy of the source. To change the
application you push to GitHub; TrueNAS only pulls a newer image.

| | |
|---|---|
| Custom App name | `parlay-projector` |
| Image | `ghcr.io/j1-hypz/parlay-projector:latest` |
| Container port | `3000` |
| Host port | `3000` (change in the YAML if taken) |
| Compose file | [`deploy/truenas/compose.yaml`](compose.yaml) |
| Persistent storage | none — the app is stateless |
| URL once running | `http://<TRUENAS-IP>:3000` |

---

## 1. Before you install

The image must exist in GHCR first. Push to `main` and let the
**Build and Publish** workflow finish, then confirm the package appears under
`https://github.com/j1-hypz?tab=packages`.

Because the source repository is private, the package is private too by
default. Pick one of the two options in
[section 4](#4-private-ghcr-access) before installing, or the image pull will
fail with `unauthorized` / `manifest unknown`.

---

## 2. Install as a Custom App

1. Open the TrueNAS web interface.
2. Go to **Apps → Discover Apps**.
3. Click **Custom App** (top right).
4. Choose **Install via YAML**.
5. Paste the entire contents of [`compose.yaml`](compose.yaml).
6. Set the application name to **`parlay-projector`**.
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

`SPORTS_API_URL`, `SPORTS_API_KEY` and `DATABASE_URL` are reserved for future
phases and are unused by this build. When they do become real, add them as
TrueNAS app environment values — **not** to the repository.

---

## 4. Private GHCR access

The repository is private, so the container package is private by default.
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

On TrueNAS: **Apps → Installed → `parlay-projector` → ⋮ → Update** (or
**Redeploy**). TrueNAS re-pulls `:latest` and restarts the container.

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
| `TRUENAS_APP_NAME` | no | `parlay-projector` | Defaults to `parlay-projector` |

Optional repository **variables** (not secrets):

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_TRUENAS_AUTO_DEPLOY` | unset | `true` enables automatic deploys |
| `TRUENAS_PORT` | `443` | Management interface port |
| `TRUENAS_API_PATH` | `/api/current` | Use `/websocket` on TrueNAS ≤ 24.10 |
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
2. **Apps → Installed → `parlay-projector` → Edit**.
3. Change the image line from `:latest` to that SHA:

   ```yaml
   image: ghcr.io/j1-hypz/parlay-projector:a38d21f
   ```

4. Save. TrueNAS pulls that exact image and restarts.

The app stays pinned to that SHA until you change it back to `:latest`. While
pinned, a redeploy will **not** pick up new builds — that is the point.

Old images are never deleted automatically, so previous SHAs remain available.

---

## 9. Reverse proxy (optional, later)

The container serves plain HTTP on one port and holds no state, so it sits
behind Nginx Proxy Manager, Nginx, Traefik or a Cloudflare Tunnel without
changes. Point the proxy at `http://<TRUENAS-IP>:3000` and set `SITE_URL` to
the public URL so metadata URLs are correct.

Nothing here installs or configures a proxy.

---

## 10. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `unauthorized` / `manifest unknown` on pull | Private package with no credentials — see [section 4](#4-private-ghcr-access) |
| App stuck `DEPLOYING` | Image pull failing or health check never passing — check the app logs in TrueNAS |
| Port already allocated | Change the host side of `ports:` in the app config |
| Deploy workflow queued forever | No runner with all three labels is online |
| `app 'parlay-projector' is not installed` | The app name on TrueNAS does not match `TRUENAS_APP_NAME` |
| `TLS verification failed` | Self-signed certificate — set `TRUENAS_CA_BUNDLE` |
| OpenGraph links point at localhost | `SITE_URL` not set to the real URL |
