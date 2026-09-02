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
    print(f"projections: {len(projections)} (model {body.get('model_version')})")

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
    print("projection engine verified against live data")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"::error::projection output failed validation: {error}")
        raise SystemExit(1)
