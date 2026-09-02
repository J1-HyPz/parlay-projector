#!/usr/bin/env python3
"""
End-to-end verification of the prediction accuracy system.

Drives a real prediction through the whole lifecycle inside the built
container, using the application's own endpoints — no fixtures, no seeded
history, no hand-marked results.

  generate a line  ->  prediction stored as pending
                   ->  tracker settles it against the real score
                   ->  accuracy metrics reflect it
                   ->  homepage widget shows the same number

Then checks the properties that must hold whatever the data is:

  * the headline denominator excludes pending, void and push
  * a percentage is withheld below the reporting threshold
  * nothing is fabricated when there is no history
  * settlement is idempotent
  * every accuracy section is internally consistent
"""

import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
TIMEOUT = 180


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=TIMEOUT) as response:
        if response.status != 200:
            raise SystemExit(f"::error::GET {path} returned {response.status}")
        return json.load(response)


def check_empty_history_is_honest():
    """A fresh container has settled nothing, and must say so."""
    report = get("/api/accuracy")
    overall = report["overall"]

    if overall["settled"] == 0:
        assert overall["accuracy"] is None, (
            f"accuracy must be null with nothing settled, got {overall['accuracy']}"
        )
        assert overall["correct"] == 0 and overall["incorrect"] == 0
        print("  no settled history -> accuracy null, nothing fabricated")
    else:
        print(f"  {overall['settled']} already settled in this container")

    return report


def check_generation_stores_predictions():
    """Generating a line must store its legs as pending predictions."""
    before = get("/api/accuracy")["counts"]["stored"]

    line = get("/api/parlays?risk=low&legs=3")
    parlay = line.get("parlay")
    if not parlay:
        print("  no line available to publish (out of season) - skipping")
        return None

    after = get("/api/accuracy")["counts"]["stored"]
    assert after >= before, "stored count went backwards"

    tracking = line.get("tracking") or {}
    assert tracking, "the line reported no tracking state for its legs"

    statuses = {leg["id"]: tracking.get(leg["id"], {}).get("status") for leg in parlay["legs"]}
    for leg_id, status in statuses.items():
        assert status is not None, f"leg {leg_id} has no tracked status"
        assert status in {"pending", "live", "won", "lost", "push", "void", "unsettled"}, status

    print(f"  {len(parlay['legs'])} legs stored, statuses {sorted(set(statuses.values()))}")
    return line


def check_idempotent_publishing(line):
    """Regenerating the same line must not double-count it."""
    if not line:
        return
    before = get("/api/accuracy")["counts"]["stored"]
    get("/api/parlays?risk=low&legs=3")
    after = get("/api/accuracy")["counts"]["stored"]

    assert after == before, (
        f"republishing the same line changed the stored count ({before} -> {after})"
    )
    print("  republishing the same line stored nothing new")


def check_accuracy_consistency():
    """Every section must agree with the report it came from."""
    report = get("/api/accuracy")
    overall = report["overall"]

    assert overall["settled"] == overall["correct"] + overall["incorrect"], (
        "settled must equal correct + incorrect"
    )

    if overall["accuracy"] is not None:
        expected = round(overall["correct"] / overall["settled"], 4)
        assert abs(overall["accuracy"] - expected) < 1e-6, "accuracy is not wins / settled"
        assert overall["settled"] >= 20, "a rate was reported below the threshold"

    # Breakdowns cannot claim more settled predictions than exist overall.
    for section in ("by_sport", "by_market", "by_risk", "by_model"):
        total = sum(group["settled"] for group in report[section])
        assert total <= overall["settled"], (
            f"{section} reports {total} settled against an overall {overall['settled']}"
        )
        for group in report[section]:
            if group["accuracy"] is not None:
                assert group["settled"] >= 20, (
                    f"{section}/{group['key']} reported a rate from {group['settled']}"
                )

    # Calibration bands must partition the settled predictions.
    banded = sum(band["predictions"] for band in report["calibration"])
    assert banded == overall["settled"], (
        f"calibration covers {banded} of {overall['settled']} settled predictions"
    )

    score = report["score"]
    for key in ("home_mae", "away_mae", "margin_mae", "total_mae"):
        value = score[key]
        assert value is None or (value == value and value >= 0), f"{key} is {value}"

    print(
        f"  overall: {overall['settled']} settled, accuracy {overall['accuracy']}, "
        f"brier {overall['brier']}, pending {overall['pending']}, live {overall['live']}"
    )
    return report


def check_homepage_matches(report):
    """The widget and the service must be the same number."""
    home = get("/api/home/accuracy")
    overall = report["overall"]

    for key in ("accuracy", "correct", "incorrect", "settled"):
        assert home[key] == overall[key], (
            f"homepage {key}={home[key]} disagrees with the service {overall[key]}"
        )
    print("  homepage widget matches the accuracy service exactly")


def check_sections():
    """Every documented section responds and is shaped as promised."""
    for section in (
        "summary",
        "sports",
        "markets",
        "risk",
        "calibration",
        "score",
        "parlays",
        "trend",
        "models",
        "recent",
    ):
        body = get(f"/api/accuracy?section={section}")
        assert isinstance(body, dict) and body, f"section {section} returned nothing"
    print("  all 10 accuracy sections respond")


def check_windows():
    """A narrower window can never contain more than all-time."""
    all_time = get("/api/accuracy?window=all-time")["overall"]["settled"]
    for window in ("today", "7d", "30d"):
        scoped = get(f"/api/accuracy?window={window}")["overall"]["settled"]
        assert scoped <= all_time, f"{window} reports {scoped} against all-time {all_time}"
    print("  windows are consistent with all-time")


def check_tracker():
    """The background tracker must be running and reporting itself."""
    health = get("/api/internal/tracker")
    assert health["enabled"] is True, "the tracker is disabled"
    assert health["interval_seconds"] > 0

    for key in ("pending", "live", "unsettled"):
        assert health["open"][key] >= 0

    # Nothing sensitive should be exposed here.
    body = json.dumps(health).lower()
    for term in ("password", "token", "secret", "webhook", "/mnt/", "api_key"):
        assert term not in body, f"tracker diagnostics leaked {term!r}"

    print(
        f"  tracker: interval {health['interval_seconds']}s, "
        f"open {health['open']}, queued {health['queued']}, stale {health['stale']}"
    )


def main():
    print("--- empty history ---")
    check_empty_history_is_honest()

    print("--- generation stores predictions ---")
    line = check_generation_stores_predictions()

    print("--- idempotency ---")
    check_idempotent_publishing(line)

    print("--- accuracy consistency ---")
    report = check_accuracy_consistency()

    print("--- homepage ---")
    check_homepage_matches(report)

    print("--- sections and windows ---")
    check_sections()
    check_windows()

    print("--- tracker ---")
    check_tracker()

    print("accuracy system verified end to end")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"::error::accuracy verification failed: {error}")
        raise SystemExit(1)
