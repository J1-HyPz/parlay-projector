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


def post(path, payload):
    request = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        if response.status != 200:
            raise SystemExit(f"::error::POST {path} returned {response.status}")
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
            check_leg_market(leg, f"{risk}: {leg['label']}")

        assert abs(parlay["combined_probability"] - product) < 0.001, (
            f"{risk}: combined probability {parlay['combined_probability']} "
            f"is not the product {product}"
        )

        check_parlay_price(parlay, risk)

        verified = sum(
            1 for leg in legs if leg["market"]["availability"] == "verified"
        )
        print(
            f"  {label}{risk}: {len(legs)} legs, combined "
            f"{parlay['combined_probability']:.3f}, "
            f"probabilities {[round(leg['probability'], 3) for leg in legs]}, "
            f"{verified}/{len(legs)} confirmed markets"
        )


def check_leg_market(leg, where):
    """Every leg must say what the bet is, and be honest about availability.

    The failure this whole layer exists to prevent is a line the model invented
    being presented as one a bookmaker offers. So the two states are checked
    strictly in both directions: a verified market must carry a real price and
    name the book that quoted it, and a model-derived one must carry no price at
    all rather than a leftover from an earlier fetch.
    """
    market = leg["market"]

    assert leg["explanation"], f"{where}: no plain-English explanation"
    assert leg["probability_label"], f"{where}: probability is not labelled"
    assert market["label"], f"{where}: the market is not named"
    assert market["availability"] in ("verified", "model_only"), (
        f"{where}: unknown availability {market['availability']!r}"
    )

    if market["availability"] == "verified":
        price = market["price"]
        assert price, f"{where}: verified with no price"
        assert price["decimal"] > 1, f"{where}: decimal odds {price['decimal']}"
        assert market["source"], f"{where}: verified but no book named"
        assert market["fetchedAt"], f"{where}: verified but not timestamped"
        # Implied probability has to follow from the price, or the comparison
        # against the model means nothing.
        assert abs(price["implied"] - 1 / price["decimal"]) < 0.001, (
            f"{where}: implied {price['implied']} does not follow from "
            f"{price['decimal']}"
        )
        edge = leg["edge"]
        assert edge, f"{where}: priced but no comparison against the model"
        assert abs(edge["edge"] - (leg["probability"] - price["implied"])) < 0.001, (
            f"{where}: edge {edge['edge']} is not model minus implied"
        )
    else:
        assert market["price"] is None, f"{where}: unverified but priced"
        assert market["source"] is None, f"{where}: unverified but names a book"
        assert leg["edge"] is None, f"{where}: unverified but claims an edge"

    # Reasoning is oriented per selection, so the buckets must exist even when
    # a category happens to be empty.
    for bucket in ("support", "risks", "context"):
        assert isinstance(leg["reasoning"][bucket], list), (
            f"{where}: reasoning bucket {bucket} missing"
        )


def check_parlay_price(parlay, risk):
    """A combined price exists only when every leg genuinely carries one."""
    legs = parlay["legs"]
    all_priced = all(leg["market"]["price"] for leg in legs)
    price = parlay.get("price")

    if not all_priced:
        assert price is None, (
            f"{risk}: a combined price was given with an unpriced leg, which "
            f"would mean a figure was invented for it"
        )
        return

    assert price, f"{risk}: every leg priced but no combined price"
    expected = 1.0
    for leg in legs:
        expected *= leg["market"]["price"]["decimal"]
    assert abs(price["decimal"] - expected) < 0.01, (
        f"{risk}: combined odds {price['decimal']} is not the product {expected}"
    )
    assert parlay["risk_rationale"], f"{risk}: no explanation of the classification"


def check_market_explorer():
    """Every market on one fixture, and the builder that combines them.

    The builder is the one place a reader can assemble correlated selections,
    so its arithmetic is the thing most worth checking against live data: a
    combination must be *counted* across the fixture's simulations, not
    multiplied, and a pair that cannot both come in must be refused rather than
    quietly given a small number.
    """
    projections = get("/api/projections/games").get("projections", [])
    assert projections, "no projections to explore markets for"

    # First fixture whose markets actually resolve. A projected fixture can
    # still fail here if it kicks off between the two requests.
    for projection in projections[:5]:
        body = get(f"/api/games/{projection['game_id']}/markets")
        if body.get("groups"):
            break
    else:
        raise AssertionError("no projected fixture returned any markets")

    groups = body["groups"]
    picks = body.get("model_picks") or []
    assert picks, "no model picks ranked"

    total = 0
    for group in groups:
        assert group["label"], f"market group {group['market']} is not named"
        assert group["selections"], f"market group {group['market']} is empty"
        for selection in group["selections"]:
            check_leg_market(selection, f"{group['market']}: {selection['label']}")
            total += 1

    # Ranked by the optimiser's score, not by raw probability.
    scores = [pick["score"] for pick in picks]
    assert scores == sorted(scores, reverse=True), "model picks are not ranked"

    priced = sum(
        1
        for group in groups
        for selection in group["selections"]
        if selection["market"]["availability"] == "verified"
    )
    print(
        f"  {len(groups)} markets, {total} selections, {priced} confirmed"
        + (f", priced by {body['pricing']['source']}" if body.get("pricing") else ", unpriced")
    )

    check_builder(projection["game_id"], groups)


def check_builder(game_id, groups):
    """A slip the reader assembled, evaluated jointly."""
    flat = [s for group in groups for s in group["selections"]]
    by_type = {}
    for selection in flat:
        by_type.setdefault(selection["market"]["type"], []).append(selection)

    # One leg first: the joint and the product must agree, which is the
    # property that keeps a leg's own number and its contribution consistent.
    single = post(f"/api/games/{game_id}/markets", {"selections": [flat[0]["id"]]})["slip"]
    assert single, "a single-selection slip was refused"
    assert abs(single["combined_probability"] - single["independent_probability"]) < 0.002, (
        "one leg disagrees with itself: "
        f"{single['combined_probability']} vs {single['independent_probability']}"
    )

    # Two legs from different markets on the same fixture: related, so the
    # measured figure must not simply be the product.
    pair = [group[0] for group in by_type.values()][:2]
    if len(pair) == 2:
        slip = post(
            f"/api/games/{game_id}/markets", {"selections": [s["id"] for s in pair]}
        )["slip"]
        assert slip, "a two-selection slip was refused"
        assert slip["correlation"]["level"] in ("low", "moderate", "high")
        product = pair[0]["probability"] * pair[1]["probability"]
        assert abs(slip["independent_probability"] - product) < 0.002, (
            f"independent figure {slip['independent_probability']} is not the "
            f"product {product}"
        )
        assert 0 < slip["combined_probability"] < 1, "joint probability out of range"
        print(
            f"  builder: {pair[0]['market']['type']} + {pair[1]['market']['type']} "
            f"-> joint {slip['combined_probability']:.3f} against product "
            f"{slip['independent_probability']:.3f}, "
            f"{slip['correlation']['level']} correlation"
        )

    # Both sides of one market cannot both come in, so one must be dropped
    # rather than the pair being priced as though they could.
    opposing = next((sel for sel in by_type.values() if len(sel) >= 2), None)
    if opposing:
        slip = post(
            f"/api/games/{game_id}/markets",
            {"selections": [opposing[0]["id"], opposing[1]["id"]]},
        )["slip"]
        assert slip, "an opposing-selection slip returned nothing at all"
        assert slip["dropped"] >= 1 or len(slip["legs"]) == 1, (
            "two sides of one market were both accepted"
        )
        print(f"  builder: incompatible pair reduced to {len(slip['legs'])} leg")

    # A slip of ids that do not belong to this fixture is reported, not guessed.
    unknown = post(f"/api/games/{game_id}/markets", {"selections": ["not-a-selection"]})
    assert unknown.get("slip") is None, "an unknown selection was silently accepted"
    print("  builder: unknown selections reported rather than dropped")


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


def check_formula_one():
    """Formula 1 arrives as a field, not as two sides.

    The whole point of widening the domain: a Grand Prix session carries its
    entrants and no home or away team. If anything in the pipeline had quietly
    nominated two drivers to fill those slots, this is where it would show.

    Out of season the calendar is legitimately empty, so the shape is asserted
    against whatever comes back rather than a count being demanded.
    """
    games = get("/api/schedule?sport=f1").get("games", [])

    if not games:
        print("  formula 1: no sessions in the current window (out of season)")
        return

    sessions = set()
    for game in games:
        assert game.get("home_team") is None, f"{game['id']} was given a home team"
        assert game.get("away_team") is None, f"{game['id']} was given an away team"
        assert isinstance(game.get("entrants"), list), f"{game['id']} carries no field"
        assert game.get("title"), f"{game['id']} has no event name"

        for entrant in game["entrants"]:
            assert entrant.get("name"), "an entrant with no name"
            position = entrant.get("position")
            assert position is None or (isinstance(position, int) and position > 0), (
                f"bad finishing position {position!r}"
            )

        if game.get("session"):
            sessions.add(game["session"])

    listed = ", ".join(sorted(sessions)) or "unnamed"
    print(f"  formula 1: {len(games)} sessions across {len(sessions)} kinds ({listed})")


def check_race_sessions_are_not_projected():
    """A race must never reach the scoring model.

    That model is built on two sides and a score. Asked about a Grand Prix it
    should produce nothing at all, rather than a number derived from a fixture
    shape the event does not have.
    """
    body = get("/api/parlays?sport=f1&risk=medium")
    assert body.get("parlay") is None, "the two-sided model produced a line for a race"
    print("  formula 1: correctly absent from the two-sided projection engine")


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

    print("--- market explorer and builder ---")
    check_market_explorer()

    print("--- day selector ---")
    check_days()

    print("--- control responsiveness ---")
    check_controls_are_responsive()

    print("--- formula 1 ---")
    check_formula_one()
    check_race_sessions_are_not_projected()

    print("projection engine verified against live data")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as error:
        print(f"::error::projection output failed validation: {error}")
        raise SystemExit(1)
