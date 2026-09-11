# Choosing what a parlay is built from

Sport, then competition, then risk, then how many selections. Everything after
that — projection, thresholds, optimiser — is unchanged; this document is only
about the narrowing that happens first.

```
all tracked events
      ↓ sport
      ↓ competition
eligible events        upcoming · not started · inside the window · enough history
      ↓
projection engine
      ↓ risk profile
parlay optimiser
```

## The selector comes from the registry

There is no list of sports on the Parlays page. There was, and it had been
wrong for months: six sports, no tennis, no Formula 1, because nothing
connected it to `lib/leagues/registry.ts`.

`lib/leagues/catalogue.ts` derives the selector from the registry instead, and
`GET /api/leagues` serves it alongside the competition list the rest of the
application already used. Adding a competition to the registry is now the whole
change — the Parlays page learns about it on its own, as Schedule and the hubs
already did.

Two questions are answered there, and they are not the same question:

| Question | Answer from |
| --- | --- |
| Which competitions exist? | the registry |
| Which can be projected? | `isProjectable` |

A competition can be tracked — fixtures, results, standings — without the
engine having a model for its sport. Such a competition is listed, disabled,
with the reason, rather than being silently dropped from a page it used to
appear on. Every tracked competition currently has a model, so nothing is in
that state today; the path exists for whatever gets added next.

**`isProjectable` is the single definition, and that matters more than it
sounds.** Three engines can own a competition — the scoring model, the race
model, and the individual-contest model behind MMA and tennis — and the
question "can this be built from?" is asked in three places: the selector, the
candidate build, and the settlement tracker. They used to answer it separately.
The UFC and both tennis tours were the cost of that: modelled, calibrated,
backtested, and then invisible everywhere, because the selector asked one
question and the tracker asked another. One function now answers all three, so
a competition cannot be offered in one place and forgotten in another.

## Competition ids, not names

Requests and stored records key on the catalogue id (`epl`), never the display
name. "Premier League" is what a competition is called this season; `epl` is
what it is. A selection now carries both:

```ts
league: 'Premier League'   // what a fixture shows
league_id: 'epl'           // what it is
```

## The filter is binding

This is the part worth being careful about.

Narrowing happens **before anything is projected**. `buildCandidates` takes the
sport and competition, resolves them to a list of leagues, and that list is the
entire universe the rest of the build sees. There is no later stage that could
reach past it, which makes the guarantee structural rather than a rule the
optimiser has to remember.

So a request for the Premier League with five legs, where three matches
qualify, returns **three legs** and says so. It does not quietly add a fourth
from the NBA because that leg scored better. There is a test named after this
scenario.

An unresolvable filter — an unknown competition, or one belonging to a
different sport than the one asked for — is a `400`, not a widening. Failing
open would mean a typo in a bookmark silently returned the whole card.

## How many legs are possible

A multi-game line takes at most one selection per fixture, so the number of
qualifying fixtures *is* the ceiling. The response reports it:

```
max_legs         legs this filter can actually reach
games_available  fixtures with a selection the risk profile accepts
eligible         model-backed selections across those fixtures
```

Counts above `max_legs` are shown greyed with the reason rather than accepted
and quietly under-delivered. A same-game line draws several legs from one
fixture, so no such ceiling applies to it and `max_legs` is simply the maximum.

## What each sport offers

Competitions come from the registry, so this table describes today rather than
defining it.

| Sport | Competitions |
| --- | --- |
| American Football | NFL, NCAA Football, CFL, AFLE, EFA |
| Basketball | NBA, WNBA, NCAA Men's, NCAA Women's |
| Baseball | MLB |
| Hockey | NHL |
| Football | Premier League, Championship, League One, Champions League, Europa League, Conference League, La Liga, Bundesliga, Serie A |
| Tennis | ATP Tour, WTA Tour |
| MMA | UFC |
| Formula 1 | Formula 1 |

A sport with one competition selects it outright — offering "all" above a
single identical choice is a decision that isn't one. Football is grouped by
region using the headings the catalogue already carries for the hubs; nothing
is invented for the sports that do not need it.

MMA and tennis are offered but will produce no legs until `ODDS_API_KEY` is
set, and the reason is the same one that applies to Formula 1: a parlay leg
must be a bet a bookmaker is actually quoting, and the fixtures feed's own
prices cover neither sport. Their projections still appear on each fixture's
page, where they read as analysis. That is a configuration state rather than a
gap in the model — see docs/betting-markets.md.

Formula 1 is not forced into a league shape. It is one competition whose events
are sessions, and only the Grand Prix itself is projected — see
[Formula 1](f1.md).

## Requests

```
GET /api/parlays?sport=football&league=epl&risk=medium&legs=4
GET /api/parlays?sport=all&league=all&risk=low&legs=3
GET /api/parlays?sport=f1&risk=medium
```

`league` may be omitted or `all`. The response echoes what it resolved:

```json
"scope": {
  "sport": "football",
  "league": "epl",
  "sport_label": "Football",
  "league_label": "Premier League"
}
```

## What is recorded

Each published line stores the filter it was built under:

```ts
scope: { sport: 'football', league: 'epl', legs: 4 }
```

and each prediction stores its own `league_id`. Neither is used by the accuracy
figures yet; both exist so a success rate can later be read per competition. A
Premier League figure means something. An average across every football
competition on the card means considerably less.

Records written before the filter existed carry neither field. They were all
built across everything, which is what their absence says.

## What did not change

Risk profiles, thresholds, the models, correlation handling, one-selection-per-
fixture, and the refusal to pad a line. The filter narrows the candidate pool;
it does not alter what any of those mean. Low risk within the Premier League is
the same claim as low risk anywhere else.
