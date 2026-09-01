#!/usr/bin/env python3
"""
Trigger a redeploy of the Parlay Projector Custom App on TrueNAS SCALE.

Uses the documented JSON-RPC 2.0 over WebSocket API:
  - endpoint  wss://<host>/api/current   (TrueNAS 25.04+; /websocket on <= 24.10)
  - auth      auth.login_with_api_key
  - pull      app.image.pull(image)      -- a job
  - redeploy  app.redeploy(app_name)     -- a job
  - status    core.get_jobs / app.query

The image is pulled explicitly before redeploying. TrueNAS redeploys with
`docker compose up --force-recreate`, which recreates containers but does not
re-pull a tag it already has locally -- so on a moving tag like `:latest` a
redeploy alone can silently restart the previous image.

Configuration comes from environment variables only. Nothing is hardcoded and
no secret is ever printed.

Required:
  TRUENAS_HOST        hostname or IP of the TrueNAS box (no scheme)
  TRUENAS_API_KEY     API key with the APPS_WRITE role

Optional:
  TRUENAS_APP_NAME    default: parlayprojector
  TRUENAS_IMAGE       image to pull before redeploying
                      (default: ghcr.io/j1-hypz/parlay-projector:latest)
  TRUENAS_SKIP_PULL   set to "true" to redeploy without pulling first
  TRUENAS_PORT        default: 443
  TRUENAS_API_PATH    default: /api/current  (use /websocket for TrueNAS <= 24.10)
  TRUENAS_USERNAME    recorded in log output only; the API key carries identity
  TRUENAS_CA_BUNDLE   path to a CA/self-signed certificate to trust
  TRUENAS_TIMEOUT     seconds to wait for the redeploy job (default: 600)
  TRUENAS_INSECURE_SKIP_VERIFY
                      set to "true" to disable TLS verification. Strongly
                      discouraged; prefer TRUENAS_CA_BUNDLE.

Exit codes:
  0  redeploy completed and the app reports RUNNING
  1  deployment failed, timed out, or the app did not return to RUNNING
  2  configuration error (missing/invalid environment)
"""

from __future__ import annotations

import json
import os
import ssl
import sys
import time
from typing import Any

try:
    from websockets.sync.client import connect
except ImportError:  # pragma: no cover
    sys.stderr.write(
        "ERROR: the 'websockets' package is required.\n"
        "       python3 -m pip install -r scripts/requirements.txt\n"
    )
    raise SystemExit(2)


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

# TrueNAS strips hyphens from Custom App names, so the app installed from
# an app named "parlay-projector" is addressed as "parlayprojector".
DEFAULT_APP_NAME = "parlayprojector"
DEFAULT_IMAGE = "ghcr.io/j1-hypz/parlay-projector:latest"
TERMINAL_JOB_STATES = {"SUCCESS", "FAILED", "ABORTED"}
POLL_INTERVAL_SECONDS = 3


class ConfigError(RuntimeError):
    """Raised when the environment is missing or malformed."""


def log(message: str) -> None:
    print(f"[deploy-truenas] {message}", flush=True)


def _require_env(name: str) -> str:
    value = (os.environ.get(name) or "").strip()
    if not value:
        raise ConfigError(f"{name} is not set")
    return value


def _env_int(name: str, default: int) -> int:
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def build_ssl_context() -> ssl.SSLContext:
    """
    TLS policy.

    Verification is on by default. A self-signed TrueNAS certificate should be
    trusted explicitly via TRUENAS_CA_BUNDLE rather than by turning
    verification off.
    """
    context = ssl.create_default_context()

    ca_bundle = (os.environ.get("TRUENAS_CA_BUNDLE") or "").strip()
    skip_verify = (
        os.environ.get("TRUENAS_INSECURE_SKIP_VERIFY") or ""
    ).strip().lower() == "true"

    if ca_bundle:
        if not os.path.isfile(ca_bundle):
            raise ConfigError(f"TRUENAS_CA_BUNDLE does not exist: {ca_bundle}")
        context.load_verify_locations(cafile=ca_bundle)
        log(f"TLS: verifying against CA bundle {ca_bundle}")
        return context

    if skip_verify:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        log(
            "TLS: WARNING - certificate verification DISABLED via "
            "TRUENAS_INSECURE_SKIP_VERIFY. This exposes the deployment to "
            "man-in-the-middle attacks. Prefer TRUENAS_CA_BUNDLE."
        )
        return context

    log("TLS: verifying with the system trust store")
    return context


# --------------------------------------------------------------------------
# Minimal JSON-RPC 2.0 client
# --------------------------------------------------------------------------

class TrueNASClient:
    def __init__(self, websocket) -> None:
        self._ws = websocket
        self._next_id = 0

    def call(
        self,
        method: str,
        params: list[Any] | None = None,
        *,
        timeout: int = 60,
    ) -> Any:
        """Send one JSON-RPC request and return its result, ignoring notifications."""
        self._next_id += 1
        request_id = self._next_id
        self._ws.send(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": method,
                    "params": params or [],
                }
            )
        )

        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"timed out waiting for a response to {method}")

            message = json.loads(self._ws.recv(timeout=remaining))

            # The server also pushes event notifications; those carry no "id".
            if message.get("id") != request_id:
                continue

            if "error" in message:
                error = message["error"]
                raise RuntimeError(
                    f"{method} failed: "
                    f"{error.get('message', error)} (code {error.get('code')})"
                )
            return message.get("result")


def wait_for_job(client: TrueNASClient, job_id: int, timeout: int) -> dict[str, Any]:
    """Poll core.get_jobs until the job reaches a terminal state."""
    deadline = time.monotonic() + timeout
    last_state: str | None = None

    while time.monotonic() < deadline:
        jobs = client.call("core.get_jobs", [[["id", "=", job_id]]])
        if not jobs:
            raise RuntimeError(f"job {job_id} disappeared from the job queue")

        job = jobs[0]
        state = job.get("state")

        if state != last_state:
            log(f"job {job_id}: {state}")
            last_state = state

        if state in TERMINAL_JOB_STATES:
            return job

        time.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(
        f"job {job_id} did not finish within {timeout}s (last state: {last_state})"
    )


def wait_for_running(client: TrueNASClient, app_name: str, timeout: int) -> str:
    """
    Wait for the app to settle on a state.

    TrueNAS reports DEPLOYING while containers are being recreated, so a
    redeploy job finishing is not by itself proof the app came back up.
    """
    deadline = time.monotonic() + timeout
    last_state: str | None = None

    while time.monotonic() < deadline:
        apps = client.call("app.query", [[["name", "=", app_name]]])
        if not apps:
            raise RuntimeError(
                f"app {app_name!r} not found on this TrueNAS system. "
                "Install it as a Custom App first (see deploy/truenas/README.md)."
            )

        state = apps[0].get("state")
        if state != last_state:
            log(f"app {app_name}: {state}")
            last_state = state

        if state == "RUNNING":
            return state
        if state in {"CRASHED", "STOPPED"}:
            return state

        time.sleep(POLL_INTERVAL_SECONDS)

    raise TimeoutError(
        f"app {app_name!r} did not reach RUNNING within {timeout}s "
        f"(last state: {last_state})"
    )


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------

def main() -> int:
    try:
        host = _require_env("TRUENAS_HOST")
        api_key = _require_env("TRUENAS_API_KEY")
        app_name = (os.environ.get("TRUENAS_APP_NAME") or DEFAULT_APP_NAME).strip()
        image = (os.environ.get("TRUENAS_IMAGE") or DEFAULT_IMAGE).strip()
        skip_pull = (
            os.environ.get("TRUENAS_SKIP_PULL") or ""
        ).strip().lower() == "true"
        port = _env_int("TRUENAS_PORT", 443)
        api_path = (os.environ.get("TRUENAS_API_PATH") or "/api/current").strip()
        timeout = _env_int("TRUENAS_TIMEOUT", 600)
        username = (os.environ.get("TRUENAS_USERNAME") or "").strip()
        ssl_context = build_ssl_context()
    except ConfigError as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        return 2

    if host.startswith(("http://", "https://", "ws://", "wss://")):
        sys.stderr.write(
            "ERROR: TRUENAS_HOST must be a bare hostname or IP, without a scheme.\n"
        )
        return 2

    uri = f"wss://{host}:{port}{api_path}"
    log(f"connecting to {uri}")
    if username:
        log(f"authenticating as {username} (API key)")

    try:
        with connect(uri, ssl=ssl_context, open_timeout=30, close_timeout=10) as ws:
            client = TrueNASClient(ws)

            if client.call("auth.login_with_api_key", [api_key]) is not True:
                sys.stderr.write(
                    "ERROR: TrueNAS rejected the API key. Check TRUENAS_API_KEY "
                    "and that the key has the APPS_WRITE role.\n"
                )
                return 1
            log("authenticated")

            # Confirm the app exists before touching it, so a typo in
            # TRUENAS_APP_NAME fails clearly instead of silently doing nothing.
            existing = client.call("app.query", [[["name", "=", app_name]]])
            if not existing:
                sys.stderr.write(
                    f"ERROR: app {app_name!r} is not installed on this system.\n"
                    "       Install it as a Custom App first "
                    "(see deploy/truenas/README.md).\n"
                )
                return 1
            log(f"found app {app_name!r} in state {existing[0].get('state')}")

            # Pull first. `app.redeploy` runs `docker compose up
            # --force-recreate`, which will happily reuse a stale `:latest`
            # already present on the NAS.
            if skip_pull:
                log("skipping image pull (TRUENAS_SKIP_PULL=true)")
            else:
                log(f"pulling {image}")
                pull_job = client.call("app.image.pull", [{"image": image}])
                if isinstance(pull_job, int):
                    job = wait_for_job(client, pull_job, timeout)
                    if job.get("state") != "SUCCESS":
                        error = job.get("error") or "no error detail reported"
                        sys.stderr.write(
                            f"ERROR: image pull job {pull_job} finished as "
                            f"{job.get('state')}: {error}\n"
                        )
                        return 1
                log("image pulled")

            log(f"triggering app.redeploy({app_name!r})")
            job_id = client.call("app.redeploy", [app_name])
            if not isinstance(job_id, int):
                sys.stderr.write(
                    f"ERROR: expected a job id from app.redeploy, got {job_id!r}\n"
                )
                return 1

            job = wait_for_job(client, job_id, timeout)
            if job.get("state") != "SUCCESS":
                error = job.get("error") or "no error detail reported"
                sys.stderr.write(
                    f"ERROR: redeploy job {job_id} finished as "
                    f"{job.get('state')}: {error}\n"
                )
                return 1
            log(f"redeploy job {job_id} succeeded")

            final_state = wait_for_running(client, app_name, timeout)
            if final_state != "RUNNING":
                sys.stderr.write(
                    f"ERROR: app {app_name!r} settled in state {final_state}, "
                    "expected RUNNING.\n"
                )
                return 1

            log(f"SUCCESS: {app_name} is RUNNING")
            return 0

    except ssl.SSLCertVerificationError as exc:
        sys.stderr.write(
            f"ERROR: TLS verification failed: {exc}\n"
            "       If TrueNAS uses a self-signed certificate, export its CA to a\n"
            "       file and set TRUENAS_CA_BUNDLE to that path.\n"
        )
        return 1
    except (TimeoutError, RuntimeError) as exc:
        sys.stderr.write(f"ERROR: {exc}\n")
        return 1
    except OSError as exc:
        sys.stderr.write(
            f"ERROR: could not reach {host}:{port} - {exc}\n"
            "       The runner must be on a network with access to the TrueNAS\n"
            "       management interface.\n"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
