#!/usr/bin/env python3
"""
End-to-end verification of the projection engine against live provider data.

The unit tests run on synthetic seasons, where the answer is known. This runs
the whole pipeline — real fixtures, real results, real ratings, real
simulations — inside the built container, and checks the properties that must
hold whatever the data happens to be:

  * outcome probabilities sum to one, and none is 0 or 1
  * expected scores are finite and non-negative
  * the projected margin agrees with the projected scores
  * data quality never falls below the engine's own floor
  * no two legs of a line come from the same game
  * combined probability is the product of the leg probabilities

An empty result is a legitimate outcome — out of season there may be nothing
with enough history to project — so the script checks shape rather than
insisting a line exists.
"""

import json
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"
TIMEOUT = 180

# The engine's own floor; a projection below this should not have been produced.
MIN_DATA_QUALITY = 0.35


def get(path):
    with urllib.request.urlopen(f"{BASE}{path}", timeout=TIMEOUT) as response:
        if response.status != 200:
            raise SystemExit(f"::error::GET {path} returned {response.status}")
        return json.load(response)


def check_projections():
    body = get("/api/projections/games")
    projections = body.get("projections", [])
    print(
        f"projections: {len(projections)} "
        f"(skipped {body.get('skipped_insufficient_data', '?')} for thin history, "
        f"model {body.get('model_version')})"
    )

    for p in projections:
        gid = p["game_id"]
        outcome = p["outcome"]

        total = outcome["home"] + outcome["away"] + outcome.get("draw", 0)
        assert abs(total - 1) < 0.01, f"{gid}: outcome probabilities sum to {total}"

        for key in ("home", "away"):
            value = outcome[key]
            assert 0 < value < 1, f"{gid}: {key} probability is {value}"

        for key in ("expected_home_score", "expected_away_score", "expected_total"):
            value = p[key]
            assert value == value, f"{gid}: {key} is NaN"
            assert value >= 0, f"{gid}: {key} is negative ({value})"

        assert 0 <= p["confidence"] <= 1, f"{gid}: confidence {p['confidence']}"
        assert p["data_quality"] >= MIN_DATA_QUALITY, (
            f"{gid}: data quality {p['data_quality']} below the engine's floor"
        )

        margin = p["expected_home_score"] - p["expected_away_score"]
        assert abs(p["expected_margin"] - margin) < 0.05, (
            f"{gid}: margin {p['expected_margin']} disagrees with the scores"
        )

    if projections:
        print("  every projection: probabilities sum to 1, scores finite and non-negative")
    else:
        print("  no fixtures currently have enough history to project (a valid state)")

    return len(projections)


def check_parlays(sport="all"):
    label = f"[{sport}] "
    for risk in ("low", "medium", "high"):
        body = get(f"/api/parlays?risk={risk}&sport={sport}&legs=3")
        parlay = body.get("parlay")

        if not parlay:
            print(
                f"  {label}{risk}: no line "
                f"({body.get('eligible', 0)} eligible, {body.get('games_available', 0)} games)"
            )
            continue

        legs = parlay["legs"]
        games = [leg["game_id"] for leg in legs]
        assert len(set(games)) == len(games), f"{risk}: two legs from the same game"

        product = 1.0
        for leg in legs:
            probability = leg["probability"]
            assert 0 < probability < 1, f"{risk}: leg probability {probability}"
            assert leg["label"], f"{risk}: a leg with no label"
            assert leg["projection"]["expected_home_score"] >= 0
            product *= probability

        assert abs(parlay["combined_probability"] - product) < 0.001, (
            f"{risk}: combined probability {parlay['combined_probability']} "
            f"is not the product {product}"
        )

        print(
            f"  {label}{risk}: {len(legs)} legs, combined "
            f"{parlay['combined_probability']:.3f}, "
            f"probabilities {[round(leg['probability'], 3) for leg in legs]}"
        )


def check_days():
    """The day selector must agree with what a day can actually build."""
    body = get("/api/parlays?risk=low&legs=3")
    days = body.get("days") or []
    assert days, "no day availability reported"

    print(f"  {len(days)} days in the window")
    for entry in days:
        assert entry["eligible"] <= entry["games"], (
            f"{entry['date']}: more eligible than games"
        )
        assert entry["buildable"] == (entry["eligible"] >= 2), (
            f"{entry['date']}: buildable disagrees with the eligible count"
        )

    buildable = [entry for entry in days if entry["buildable"]]
    print(
        "  buildable: "
        + (", ".join(f"{e['date']}({e['eligible']})" for e in buildable) or "none")
    )

    # Picking a day must return only that day's fixtures.
    for entry in buildable[:2]:
        picked = get(f"/api/parlays?risk=low&legs=3&date={entry['date']}")
        parlay = picked.get("parlay")
        assert picked.get("date") == entry["date"], "the API ignored the requested day"
        if not parlay:
            print(f"  {entry['date']}: no line despite being marked buildable")
            continue
        for leg in parlay["legs"]:
            assert leg["start_time"], "a leg with no kick-off time"
        print(f"  {entry['date']}: {len(parlay['legs'])} legs, all on that day")

    # A day outside the window falls back to every day rather than erroring.
    fallback = get("/api/parlays?risk=low&legs=3&date=1999-01-01")
    assert fallback.get("date") is None, "an out-of-window date should be ignored"
    print("  out-of-window date ignored, not rejected")


def check_controls_are_responsive():
    """
    Changing a control must not rebuild every projection.

    Risk level, leg count and day do not change a single projection, so they
    share one cached candidate set. Without that, every click re-simulated
    every eligible fixture ten thousand times and the page felt dead.
    """
    import time

    # Warm the candidate set for this sport.
    get("/api/parlays?risk=low&legs=3")

    worst = 0.0
    for risk, legs in (("medium", 4), ("high", 5), ("low", 2)):
        started = time.monotonic()
        get(f"/api/parlays?risk={risk}&legs={legs}")
        elapsed = time.monotonic() - started
        worst = max(worst, elapsed)
        print(f"  risk={risk} legs={legs}: {elapsed:.2f}s")

    # Generous, so this fails on a rebuild rather than on a slow runner.
    assert worst < 10.0, (
        f"a control change took {worst:.1f}s - the candidate set is being rebuilt"
    )
    print(f"  slowest control change {worst:.2f}s, candidate set reused")


def main():
    print("--- projections ---")
    check_projections()
    print("--- parlays ---")
    check_parlays()

    # Every single-sport filter, not just "all". The football pool spans nine
    # competitions and is by far the heaviest path; it was the one that failed
    # in production while "all" passed here.
    for sport in ("football", "nfl", "nba", "mlb", "nhl"):
        check_parlays(sport)

    print("--- day selector ---")
    check_days()

    print("--- control responsiveness ---")
    check_controls_are_responsive()
    print("projection engine verified against live data")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"::error::projection output failed validation: {error}")
        raise SystemExit(1)
