# Spec — Player performance

**Status: built for the pilot, with one phase deliberately incomplete —
see §7.1 point 5.** Baseball's starting-pitcher strikeouts has
been through every phase including §7.6's gate, which it passed — the numbers
are in §7.6 and in `docs/projection-engine.md`. American football's model is
built and **switched off** at `PLAYER_MARKET_LEAGUES` pending its own
measurement, per decision 2. Football (soccer) and MLB batters remain unbuilt,
per §11. Every defect §5 recorded is fixed, and §5 is kept as written because
the failures it describes are the reason the rest of this document is shaped as
it is. Companion to
[docs/specs/projection-v2.md](projection-v2.md), whose §9 put player props out
of scope on the grounds that no player statistics existed — §4 below is the
measurement that changed that. Everything here is a decision, not an option,
unless it says otherwise.

Every provider figure in §4 was read out of a response actually received on
2026-09-23. Nothing is taken from documentation, and the two questions that
could not be answered say so.

---

## 1. What it is, in one sentence

Project what one named player will do in one fixture, from their own
game-by-game record rebuilt as at kick-off; turn that into an over/under
selection **only at a line somebody is quoting**; and put it through the same
projection → selection → parlay → publication → settlement → accuracy pipeline
as every other market, gated on a backtest that proves it is calibrated and
beats the player's own season average.

## 2. What it is not

- **Not a new pipeline.** Four engines already share one `Selection` contract —
  the team scoring model, the race model, the bout model, and this. Nothing
  below adds a second settlement path, a second accuracy system or a second
  store.
- **Not a ladder of lines.** The rule this feature is most able to break is one
  the application already wrote down: *"No alternate lines beyond what is
  quoted. Generating a ladder of handicaps the model can price but nobody
  offers is the exact failure this work set out to fix."* Nothing stops this
  model pricing "over 5.5 strikeouts", and the number would look exactly like a
  real one. So the line comes from a book, with exactly one exception, named in
  decision 6.
- **Not a claim about whether the player is playing.** For most sports and most
  players there is no lineup, no depth chart and no inactive list — measured in
  §4.2, not assumed. Where participation is genuinely announced, this spec uses
  it and scopes itself to it; where it is not, that is a reason to withhold a
  market rather than to discount one.
- **Not an opponent-aware model, in its first release.** A player's own record
  is the whole of the estimate. The defence they face is a real omission, it is
  stated on every projection, and closing it is §6.7.
- **Not a change to any team projection.** `MODEL_VERSION` for teams does not
  move because of this work, and every existing projection must be
  byte-for-byte identical after each phase. Acceptance criterion 2.
- **Not shippable on the strength of the model being sensible.** §6.6 is a
  gate, not a report. A statistic that fails it stays unpublished and the docs
  say why — the same standard MMA's probability bands and baseball's dispersion
  were held to.

---

## 3. The question this spec exists to answer honestly

The application has said, in five places, that player markets do not exist
because the data does not exist. That was true of the roster endpoint and it
was never checked against anything else. It is now checked, and the answer is
more interesting than either "no data" or "plenty of data":

**Per-player, per-game statistics are abundant. Evidence that a player will
take part is almost absent.** A prop needs both. Which sport to pilot is
therefore decided by participation evidence rather than by statistical depth,
and that inverts the obvious answer — see decision 1.

---

## 4. What the providers actually publish

### 4.1 Data — per-player, per-game statistics

Two independent sources, and they are good at different things.

**(a) The finished game's box score**, `summary?event=<id>` →
`boxscore.players[]`. One request yields every player in that game.

| Competition | `boxscore.players` | Stat groups | Group identity |
|---|---|---|---|
| NFL | yes, 2 entries | 10: passing, rushing, receiving, fumbles, defensive, interceptions, kickReturns, puntReturns, kicking, punting | `name` |
| NCAA Football | yes, 2 entries | the same 10 names | `name` |
| NBA | yes, 2 entries | exactly 1 per team | **no `name`, no `type`** |
| MLB | yes, 2 entries | 2 per team | **no `name`; carries `type: "batting"\|"pitching"`** |
| NHL | yes, 2 entries | forwards, defenses, skaters, goalies | `name` |
| Premier League | **absent** | — | — |
| La Liga | **absent** | — | — |
| Champions League | **absent** | — | — |

The three football competitions carry `boxscore.teams` and **no `players` key at
all** — reported as `null` by the probe's own reader and `undefined` in the saved
payload, which is the same finding and worth stating in the form the code will
meet it.

Fields, verbatim from the responses:

| Competition | What is exposed |
|---|---|
| NFL | Yardage, attempts, touchdowns and long for passing/rushing/receiving; `receivingTargets`; `sacks-sackYardsLost`; `QBRating`; full defensive and returning lines |
| NCAAF | The same, three columns short: no `receivingTargets`, no `sacks-sackYardsLost`, no `QBRating`, and `hurries` where the NFL has `QBHits` |
| NBA | minutes, points, rebounds (+ offensive/defensive), assists, turnovers, steals, blocks, fouls, plusMinus, and FG/3PT/FT as composites |
| MLB batting | `hits-atBats`, atBats, runs, hits, RBIs, homeRuns, walks, strikeouts, pitches — plus **season-to-date** avg/OBP/SLG sitting in a single game's row |
| MLB pitching | `fullInnings.partInnings`, hits, runs, earnedRuns, walks, **strikeouts**, homeRuns, `pitches-strikes` — plus season-to-date ERA |
| NHL skaters | goals, assists, shotsTotal, blockedShots, hits, takeaways, giveaways, faceoffs, penalties, and five time-on-ice columns as `"18:14"` strings |
| NHL goalies | goalsAgainst, shotsAgainst, saves, savePct, and saves split by strength |

**Football (soccer) has per-player data, in a different shape entirely.**
`boxscore.players` is null; the data lives in `rosters[].roster[].stats` as an
array of named objects rather than a positional array. Fifteen names, identical
across all three competitions, and they include what a shots market needs:
`totalShots`, `shotsOnTarget`, `totalGoals`, `goalAssists`, plus fouls both
ways, cards, offsides, own goals, subIns, appearances and, for keepers,
saves/shotsFaced/goalsConceded. **There is no minutes-played statistic**, and
no passes, touches, tackles or dribbles. Formation and starter flags are
present. So "Player Z 2+ shots on target" is buildable for football — through a
second normaliser, not the existing one.

**(b) The athlete gamelog**,
`common/v3/sports/<sport>/<league>/athletes/<id>/gamelog`. One request yields
one player's whole season, with `eventId` on every row and `gameDate` in the
sibling `events` map — which is exactly what an as-at-kick-off rate needs.

**`?season=YYYY` serves a past season. This is the finding that changes the
design**, and it contradicts the comment currently in
`lib/providers/espn/boxscore.ts` in as many words.

| Competition | Plain request | `?season=2025` | `?season=2024` | Seasons offered |
|---|---|---|---|---|
| NFL | 2 games | **17** | 18 | 9 (2018–2026) |
| NBA | 111 | **87** | 79 | 4 |
| MLB | 150 | **150** | 145 | 10 |
| NHL | 98 | **97** | 90 | 10 |
| NCAAF | 3 | **14** | 4 | 3 |
| La Liga | 7 | **29** | not tested | 4 |
| Champions League | 6 | **0 — empty body, HTTP 200** | not tested | 1 |

The response advertises which seasons it will serve in `filters[].options`, and
that list is **per athlete** rather than per league. MLB exposes a second
filter, `category`, with `batting` and `pitching`: a pitcher's 2025 gamelog
returns **41 appearances** carrying `innings`, `runs` and `strikeouts` by name.

Two caveats worth carrying:

- **Soccer's gamelog ignores the league in its path.** One athlete requested
  through `eng.1`, `esp.1` and `uefa.champions` returned byte-identical Premier
  League data, and a Champions League fixture's player returned his Turkish
  Super Lig log. There is no observed way to ask this endpoint for a player's
  Champions League matches.
- Season values are the **season-ending year** for the winter sports:
  `season=2025` returns the NBA's and NHL's 2024-25.

**So both sources are used, for what each is actually good at.** Box scores
for breadth — who is in a squad and what they did recently, one request shared
by fifty players. Gamelogs for depth on the few players actually being priced,
and for multi-season history a box-score walk cannot reach. Rating both squads
of an NFL fixture is ~20 box scores against ~90 gamelogs; rating the two
announced starters of a baseball fixture is **2 gamelogs against ~60 box
scores**. Which one is cheaper depends entirely on how many players the market
is about, and that is a property of the sport.

### 4.2 Participation — will the player take part

This is where the feature is actually constrained, and the result is the
opposite shape from §4.1.

| Evidence | NFL | NBA | MLB | NHL |
|---|---|---|---|---|
| Starting lineup before kick-off | **none** | **none** | **none** | **none** |
| `boxscore.players` pre-game | `null` | `null` | present, **0 athletes** | `null` |
| `rosters` pre-game | absent | absent | present, **no `roster` array** | absent |
| `lineups` / `starters` / `battingOrder` | absent | absent | absent | absent |
| `teams/<id>/depthchart` | **`{}`** | **`{}`** | **`{}`** | **`{}`** |
| Announced individual starter | **0 of 14** | **0 of 1** | `probableStartingPitcher` | `probableStartingGoalie` |

Coverage of the one thing that does exist, surveyed across whole slates:

| Competition | Pre-game fixtures | Both sides announced | One side | Neither |
|---|---|---|---|---|
| MLB | 12 | **7** | **5** | **0** |
| NHL | 11 | **11** | 0 | 0 |
| NFL | 14 | 0 | 0 | **14** |
| NBA | 1 | 0 | 0 | **1** |

Three further findings:

- **`probables` is on the scoreboard, not the summary.** The summary payload
  carries no such key for any league. `lib/providers/espn/pitchers.ts` already
  reads the right place.
- **The summary's injury list is capped at five a side.** Across the NFL slate
  of 2026-09-27 — 12 fixtures, 24 sides — 23 sides returned exactly 5 and one
  returned 3. No side anywhere returned more. This is the cap
  `docs/projection-engine.md` already records, and it is why availability is
  read from the competition-wide report instead.
- **The depth chart is not dead, only moved.** `teams/<id>/depthchart` on the
  site host returns a two-byte `{}` for all four leagues against valid team
  ids. The core API's
  `.../football/leagues/nfl/seasons/2026/teams/4/depthcharts` returns 200 and
  19 KB with three depth charts. Its positions are `$ref` objects, so
  resolving them to athletes costs further requests, and **that cost was not
  measured** — §11 keeps it open rather than planning on it.

**NBA records a non-appearance after the fact**, which no other league does: an
inactive player is present with `didNotPlay: true`, `reason: "COACH'S
DECISION"` and `stats: []` — 43 of 211 lines across 8 games. That is worthless
for deciding whether to publish a market and valuable for measuring how often
the model would have been voided, which §6.6 uses.

### 4.3 Prices — does anybody quote these lines

**This is the one question in this spec that is not measured, and it is not
measurable from here**: it needs the account's own API key, which only the
operator holds. Stating it plainly rather than inferring it from the
provider's documentation, which says prop coverage is "mainly limited to US
sports and US bookmakers" and lists no prop coverage for the UK books.

What is already built to answer it: `scripts/measure-player-props.mjs` reads
`ODDS_API_KEY` from the environment or a gitignored `.env`, never prints it and
never logs a URL, reads at most three fixtures, and prints the markets, the
books and the quota cost. It currently asks for the six NFL keys and **must be
extended to the baseball keys before Phase B** — see §6.2's first step.

What is known about the shape without a key, from the provider's own contract
and confirmed by the integration already written:

- Player props are the **one** market not served per competition. They come
  from `/events/{id}/odds` — a request per fixture — so a slate of them costs
  more than every other market on the page combined. That is why they are read
  only when a reader opens a fixture, and why the slate-wide build never asks.
- Billing counts markets **returned** times regions, per event. A region
  quoting none of them costs nothing beyond the request.
- `ODDS_API_PLAYER_REGION` exists so the answer can be acted on without moving
  the match markets, which are correctly UK and should stay there.

**Until that measurement is run, this spec assumes no price exists.** Every
consequence of that assumption is stated where it bites, and none of them
blocks Phases A, B or F.

---

## 5. What already exists, and what is wrong with it

The `player-markets` branch (PR #10) implements a version of Phases A, B, C and
most of E for the NFL. It is green — 1,038 tests, clean typecheck and lint. It
should not merge as a shipped player market, for the reasons below. Every claim
here was verified by running the code, not by reading it.

### 5.1 It cannot reach a parlay

A player selection carries `type: 'player_performance'`, and that string
appears **zero times** in `config.ts`. Put through the real `eligible()` with a
verified, priced leg at 62% probability, 0.9 data quality and 0.8 confidence:

| Risk | Keeps the leg |
|---|---|
| low | **false** |
| medium | **false** |
| high | **false** |

So the branch models players, prices them, settles them — and the optimiser
drops every one. This is the failure `docs/parlay-filters.md` already names for
the UFC and tennis: *"modelled, calibrated, backtested, and then invisible
everywhere."*

### 5.2 The bet builder reports a wrong number and invents a reason for it

`jointProbability` counts simulations through `satisfiedBy`, which returns
`false` for every `player_stat` rule. Measured through `assembleSlip` against a
1,000-simulation distribution:

| Slip | Independent | Joint reported |
|---|---|---|
| One player leg alone | 0.55 | **0.005** |
| Team leg + player leg | 0.33 | **0.005** |

Two things are worse than the number. `same-game.ts` promises that *"a
single-leg builder shows exactly the number the leg card shows"* — the card
says 55% and the builder says 0.5%. And the team-plus-player slip volunteers an
explanation: *"These selections pull against each other — what helps one tends
to hurt the other."* That is fabricated reasoning attached to an artefact, and
it is the single worst behaviour anywhere in this feature.

The comment in `correlation.ts` asserts these rules *"never reach this
function"* because a fixture with no distribution is held to one leg upstream.
An NFL fixture has a distribution, so they do reach it.

### 5.3 Two different players are treated as the same market

`conflicts()` keys on market type plus line. Two players' anytime touchdown at
0.5 are therefore the same market, and one is silently dropped: measured
`conflicts = true`, one leg kept, one dropped. The key needs the athlete and
the statistic in it.

### 5.4 Its data quality is far more generous than the team model's

| Games of one statistic | 4 | 5 | 6 | 8 | **10** |
|---|---|---|---|---|---|
| `playerDataQuality` | 0.520 | 0.600 | 0.680 | 0.840 | **1.000** |

Ten games of one statistic scores a **perfect** data quality. A team reaches
that only with a full season plus standings plus a head-to-head record. The
player model names three whole categories of missing information in its own
`quality_reasons` — no participation evidence, no opponent, no way to tell a
role change from noise — and then scores itself as though none were missing.
Since `score = probability × confidence × data_quality` orders the optimiser's
candidates, a ten-game player leg outranks a full-season team leg.

There is also **no floor**: `MIN_DATA_QUALITY` is applied in `project.ts` and
nowhere in the player path, so a player projection is produced at any quality
while a team projection below 0.35 is refused.

### 5.5 On a thin sample the probability comes from a constant

Four games at 58–62 receiving yards measure a spread of **1.71**; the floor
substitutes **21.09**, twelve times larger, and P(over 49.5) comes out at
0.695. The floor is right to fire — on the measured spread the same line prices
at 0.9999 — but it means the entire width of the distribution is a constant
there, and that constant has never been checked against a result.

### 5.6 Four provider assumptions that the probe contradicts

| Assumption in the code | Measured |
|---|---|
| The gamelog serves the current season only | `?season=YYYY` serves 9–10 seasons per athlete (§4.1b) |
| Athletes carry `position` and `shortName` | **0 of 84** NFL and **0 of 81** NCAAF lines carry either. `PlayerProjection.position` is always null for the one sport implemented |
| `splitStatColumn` handles the composite columns | It handles `/` and `-`. MLB's `fullInnings.partInnings` is `.`-separated: `"6.1"` parses as 6.1, not 6⅓ — **the exact bug `parseInnings` was written to prevent**, reintroduced in a different path |
| The provider writes `-` for a stat that does not apply | Not reproduced on any of **2,243** athlete lines. A player who recorded nothing is **absent from the group**. The code is right, for a reason that is not the stated one |

Two hazards the code does not know about:

- **NCAA Football injects team pseudo-athletes** — `id "-6315"`,
  `displayName " Team"`, a leading space and a negative id, carrying the team's
  totals in the `passing` and `fumbles` groups. `normaliseBoxscore` would
  admit those as a player.
- **A soccer unused substitute carries a full array of zeros** with
  `appearances: 0`, not an absent row. The `null is not zero` discipline that
  protects every other sport is defeated here by the provider writing real
  zeros, and reading them literally would drag every rate toward zero for
  everyone who sat on a bench.

### 5.7 Six documentation claims that are now false

`lib/markets/types.ts` (player markets "deliberately absent" above a union
containing `player_stat`), `lib/projections/types.ts` ("nothing currently
generates it" above a type that is generated), `docs/projection-engine.md`
(twice — the "Not available" table, and a claim settlement handled
`player_performance` before it did), `docs/prediction-accuracy.md`,
`README.md:231`, and `tests/projections.test.ts:482`, a test named *"never
generates player props"* which passes only because it exercises the team
builder. `MARKET_TYPES` is also a dead export — zero readers — omitting both
`player_stat` and `both_teams_to_score`.

### 5.8 One risk no other market carries

Every other market settles from a score, and TheSportsDB is primary for
scores. A player market can settle **only** from ESPN, which
`docs/data-providers.md` describes as *"optional enrichment… Do not make it
load-bearing."* A 24-hour ESPN outage voids every open player leg, and the
accuracy report would show a void spike with no visible cause. This is the
strongest argument for the `$DATA_DIR` player archive in §6.1 being a
settlement dependency rather than a redeploy convenience.

---

## 6. Decisions taken

| # | Decision |
|---|---|
| 1 | **The pilot is MLB starting-pitcher strikeouts**, not the NFL. Decided on participation (§4.2), which is what a prop needs and what §3 explains is actually scarce: baseball is one of two sports where the individual is *announced*, every surveyed fixture had at least one, and the v2 spec already measured announced starters at 99.9% over 4,226 of them. It is also the cheapest to price (2 gamelog requests a fixture) and the cheapest to gate (§6.6) |
| 2 | **The NFL work already built stays in the tree and stays switched off** until it passes §6.6 on its own. It is not deleted — it is the second sport, and most of it is sport-agnostic — but a market whose participation evidence is `0 of 14` does not ship because the code exists |
| 3 | **A player market is withheld where participation is not announced.** Recent appearance is evidence of a *role*, not of selection, and the two are not interchangeable. This is what scopes the pilot to the pitcher and excludes MLB batters, whose lineup is not published pre-game either |
| 4 | Both provider sources are used for what each is good at (§4.1). Neither replaces the other, and which is cheaper is a property of how many players the market is about |
| 5 | **Every rate is as at kick-off**, rebuilt from appearances that finished strictly earlier — never the season-to-date figures the provider puts in a single game's row (`avg`, `OBP`, `SLG`, `ERA`, `ytdGoals`). The live path and the backtest call one function, so the model measured is the model shipped |
| 6 | **A line comes from a bookmaker.** The sole exception is a market with one natural threshold everywhere — an anytime touchdown is half a touchdown because the question is whether he scored at all — which is a threshold the model does not choose, like a podium being three |
| 7 | **Its own model version**, `PLAYER_MODEL_VERSION`, per sport and stat family. The team `MODEL_VERSION` does not move |
| 8 | **The gate is explicit and named, not an empty entry in a list.** §5.1's exclusion is accidentally correct and must be replaced by a deliberate switch, or the next person "fixes" `allowedTypes` without knowing a gate was intended |
| 9 | Distribution per statistic is **measured, not assumed** — including the dispersion question, which no constant can answer and which baseball's own scoring model already failed once (§6.3) |
| 10 | A player who did not take part **voids**. Far commoner than a tennis retirement, stated on the selection before it is placed, and the reason an unrecorded statistic stays distinguishable from a recorded zero from the box score to settlement |
| 11 | **Football (soccer) is in scope as a later phase, not excluded.** It has shots, shots on target, goals and assists per player per match. It needs a second normaliser, has no minutes, writes real zeros for unused substitutes, and its gamelog cannot be asked about a specific competition — four reasons to stage it, none to refuse it |

---

## 7. Phases

### 7.1 Phase A — data layer

1. **A new capability, `player_gamelogs`**, declared in
   `providers/capabilities.ts`, routed in `providers/registry.ts`'s `PRIORITY`,
   and added to the ESPN descriptor. Services ask for the capability, never for
   ESPN — which is the existing rule and the thing the current branch skipped
   by calling `fetchEspn` directly from `lib/players/history.ts`.
2. **Two adapters under `lib/providers/espn/`**: the existing box-score
   normaliser, corrected for §5.6, and a gamelog adapter that takes an athlete,
   a season and a category and returns dated rows. Both pure; fetching and
   caching stay separate, as they already are.
3. **Fix the four contradicted assumptions and the two hazards** in §5.6
   before anything is built on top: `.` as a composite separator, the missing
   `position`/`shortName`, negative-id team pseudo-athletes, soccer's zero-filled
   unused substitutes. Each gets a test with the real payload behind it.
4. **Cached as the rest of `lib/cache` is**, and a failure degrades to *no
   player selections* rather than breaking the fixture. A single unreadable
   game costs that game, not the competition.
5. **Long-run player history archived under `$DATA_DIR`** — *not built, and
   deliberately so once the pilot's shape was known.* The reasoning it was
   written on was the football one: rating a squad from box scores is twenty
   requests a fixture, so losing that cache on a redeploy is expensive. The
   pilot is **two gamelog requests a fixture**, cached for a week, so a redeploy
   costs almost nothing to recover from and an archive would carry its own
   staleness problem for no gain.

   It stays in this spec because the reasoning reverses the moment a
   box-score-shaped market ships — American football is exactly that — and
   because it is still the honest mitigation for §5.8, which is unaddressed:
   settlement reads box scores, and an ESPN outage lasting the whole 24-hour
   finalisation window would void open player legs. Today that risk is carried
   rather than removed, and the accuracy report would show it as a void spike
   with no visible cause.

**Fixtures.** Real payloads, in `tests/fixtures/espn/`:
`boxscore-{nfl,nba,mlb,nhl,ncaaf}.json`, `boxscore-soccer-{epl,ucl}.json`,
`gamelog-nfl-{current,season2025}.json`, `gamelog-soccer-epl.json`,
`summary-nfl-upcoming-injuries.json`.

**They are trimmed, and a test must not assert a count against them.** Each
carries a `__probeNote` recording its request URL, HTTP status, original byte
count and exactly which arrays were shortened — repeated athletes were cut to
about five a group to keep each file reviewable. So the saved NFL box score
holds 47 athlete lines where the live response held 84, and the saved
`?season=2025` gamelog holds 6 games where the live one held 17. **Every count
in §4 is from the live response; the fixtures are for asserting *shape*.**
Verified against the files: 0 of 47 NFL athlete lines carry a position or a
`shortName`, MLB's first pitching key is `fullInnings.partInnings` with values
`"6.1"` and `"7.0"`, the Premier League box score carries `teams` and no
`players` key at all, and its roster stats carry the fourteen outfield names
§4.1 lists.

**Acceptance.** A pitcher's rate for a past fixture is rebuilt from appearances
strictly before that fixture, proven by a test that re-derives it from the
pre-game slice. Every existing team projection is unchanged. ESPN disabled
produces no player selections and no error.

### 7.2 Phase B — model

`lib/projections/player-model.ts` and `player-selections.ts` exist and are
largely reusable. What changes:

1. **Extend the price measurement first.** Add the baseball market keys to
   `scripts/measure-player-props.mjs` and run it. §4.3 is the one unmeasured
   question in this spec and it decides whether Phase C has anything to attach
   to.
2. **A `PlayerProjection` per statistic** — player, team, stat, expected value,
   a distribution rather than a mean, data quality, confidence,
   `quality_reasons` and `factors`, in the same spirit as `GameProjection`.
   Already built; keep.
3. **Rebuild data quality against what is actually known** (§5.4). Ten games of
   one statistic must not score 1.0 while the model holds no opponent, no
   participation evidence and no role information. A ceiling below 1 is the
   minimum; the honest version caps what the *absence* of a whole evidence
   category permits. And **apply `MIN_DATA_QUALITY`** so the player path refuses
   for the same reason the team path does.
4. **Fit the spread floor** (§5.5) rather than carrying it as a constant. It
   currently generates the probability on a thin sample.
5. **Inputs, each justified by backtest rather than assumed**: the
   recency-weighted rate; expected innings, which for a pitcher is the analogue
   of minutes or snaps and which `pitchers.ts` already computes; the opponent's
   allowed rate for that statistic; the fixture's own projected total from the
   team model, so the player and team views cannot contradict each other; home
   or away; and rest. Anything that does not earn its place is not shipped.

**Gate.** §6.6, before any of it is published.

### 7.3 Phase C — markets and settlement

Mostly built and mostly correct. `MarketType` has `player_stat`, the
`SettlementRule` variant freezes `athleteId` alongside the name — the id is
what settles, exactly as `finish_position.entrant` is frozen — and
`settlement.ts` covers did-not-play as a void, an exact whole line as a push,
and an unread box score as *not yet* rather than *no*. What remains:

1. **Resolve the two names for one thing.** `SelectionType` says
   `player_performance`, `MarketType` says `player_stat`. Inherited rather than
   introduced, and every other market uses one word.
2. **Retry then void, never guess**, where the statistic is missing from the
   provider. The existing backoff covers it; assert it.
3. **State the early-exit rule on the selection before it is placed.** A
   pitcher pulled after two innings has a real, settled strikeout count, so
   this settles normally — which is *different* from a scratch, and a reader
   should be told which is which in advance rather than afterwards.
4. Display names for each statistic in `explain.ts` and `glossary.ts`.

### 7.4 Phase D — correlation, the builder, and parlays

The phase the current branch gets most wrong (§5.1–5.3), and where a design
decision is genuinely open. Two steps.

**Step 1 — honest now, without new modelling.**

- `player_performance` joins the risk profiles' `allowedTypes`, behind decision
  8's explicit switch.
- `conflicts()` keys on athlete, statistic and line, so two players stop
  colliding.
- A slip counts its team legs against the simulations exactly as today and
  **multiplies the player legs in**, labelling which part was counted and which
  assumed — the pattern `buildMixed` already uses across fixtures: *"counted
  within each fixture, multiplied between them."*
- **One guard:** a player leg may not sit beside a score-based leg from the
  same fixture. A quarterback's passing yards with his own team's total, or a
  pitcher's strikeouts with the game total, is exactly the pair the standing
  rule against multiplying obviously-correlated probabilities is about.
- `describeCorrelation` must not be handed a joint it could not measure. Its
  present willingness to explain an artefact (§5.2) is the bug to fix first.

**Step 2 — the measured version.** Draw each rated player's statistic **inside
each simulated game**, scaled by that game's simulated score. `satisfiedBy` can
then answer a player rule at index `i`, and joint probability, contradiction
detection, the conditional test and the correlation wording all work unchanged
with no special cases. Drawing *independently* is arithmetically identical to
multiplying and must not be presented as counting.

The scaling is a real coupling and it is **cheap to measure**: a box score
carries a player's statistic and his team's score for the same game, so the
correlation can be read straight off an archived season. Ships only where that
measurement supports it, per the v2 spec's rule for extending `same-game.ts`.

`docs/parlay-filters.md` gains the include/exclude switch.

### 7.5 Phase E — interface

- **Fixture page:** a player projections section — expected value, likely
  range, probability against the line, and why — following
  `docs/design-system.md` and the existing `components/game/*` patterns,
  readable on a phone. Built; keep, and correct the copy the measurements above
  falsify.
- **Parlays page and leg cards:** player legs render with the same market,
  availability, price and edge treatment as any other leg.
- **Accuracy page:** player markets broken out separately, withheld below 20
  settled predictions. Note this is **new surface, not a new grouping** —
  `by_market` has been computed by the service since it was written and is
  rendered nowhere; the page shows competition, sport and risk only.
- No stake, no projected return, no "lock". The existing honesty rules apply
  unchanged.

### 7.6 Phase F — the backtest gate

**A player market ships only if**, over at least one full season, run through
the same code path as the live model, it is **calibrated** (bands, Brier, log
loss) and **beats a naive baseline** — the player's plain season average as the
mean, with the same distribution. A statistic that fails stays unpublished and
the docs say why.

**Result — pitcher strikeouts, run over the 2024 and 2025 seasons.** 120
announced starters, 5,841 appearances, 4,881 of them evaluated and 960 skipped
for too short a record. Every estimate built from that pitcher's strictly
earlier starts.

| | Brier | log loss | bias | accuracy |
|---|---|---|---|---|
| **model** | **0.2012** | **0.5880** | **+0.0012** | **0.6920** |
| baseline | 0.2025 | 0.5948 | +0.0022 | 0.6903 |

Paired Brier difference **−0.00223 over 4,659 starts, t = −2.60**.

**Clustered by start, and that is load-bearing.** Each appearance is scored at
up to four lines, so the 15,664 pairs are roughly fourfold correlated; treating
them as independent observations would make almost any difference look
established. The unit of evidence is one start.

**The effect is real and it is small.** Accuracy differs by less than two tenths
of a point, and the whole Brier gain is 0.0013. What the model buys over "this
pitcher averages six, call it six" is better-shaped *probabilities* rather than
better guesses — which is visible in the log loss, where the gap is five times
wider than in Brier.

Calibration, folded onto the favoured side — the same correction
`bout-backtest.ts` makes, because bucketing on "probability of going over" would
put every under-leaning estimate below 0.5 and smear the bands:

| band | n | model says | happened |
|---|---|---|---|
| 50–60% | 4,193 | 55.0% | 55.1% |
| 60–70% | 4,166 | 65.0% | 66.0% |
| 70–80% | 3,857 | 75.0% | 74.6% |
| 80–90% | 3,068 | 84.6% | 83.3% |
| 90–100% | 380 | 92.6% | 91.8% |

**The finding that mattered more than the verdict: strikeouts are not Poisson.**
Asked before anything shipped, because it asks what no rate can answer. Within
player, variance over mean measures **1.16**. Left at Poisson the model was
over-confident everywhere and increasingly so at the top — the 90–100% band
claimed 92.5% and delivered 88.2%, and bias ran +0.0214.

Fitted at **1.35** by sweep, higher than the measurement, and the gap is worth
recording. Baseball's *scoring* dispersion had to be fitted down from its raw
figure because a pooled variance double-counts how much fixtures differ from one
another. This one is measured within player, so it carries no such
double-count — but the model's rate is itself an estimate from eight to thirty
starts, and the uncertainty in that estimate adds to the predictive spread on top
of the process variance. A decayed sample of eight to ten starts contributes
roughly another 0.1, which is *consistent with* 1.35 without establishing it.

| dispersion | bias | Brier | log loss | paired t |
|---|---|---|---|---|
| 1 (Poisson) | +0.0214 | 0.2019 | 0.5906 | −2.11 |
| 1.16 (measured) | +0.0104 | 0.2014 | 0.5888 | −2.37 |
| **1.35 (shipped)** | **+0.0012** | **0.2012** | **0.5880** | **−2.60** |
| 1.5 | −0.0037 | 0.2012 | 0.5880 | −2.74 |

Bias crosses zero between 1.35 and 1.5 while Brier and log loss are flat from
1.25, so both criteria land in the same place — the reasoning the ballpark weight
and MMA's `eloK` already use.

**What the dispersion absorbs is a change of role, and this was nearly recorded
wrongly.** The first explanation written was that a fitted 1.35 above a measured
1.16 reflected uncertainty in the model's own rate estimate. It does not.
`category=pitching` returns **every** appearance, relief outings included, and a
one-inning relief outing's strikeouts are nothing like a six-inning start's.
Filtered to appearances of three innings or more, the measured dispersion is
**0.97** — so strikeouts *per start* are Poisson to within three per cent, like
ice hockey and football's scoring, and the whole of the overdispersion is the
mixture.

**Two cleaner-looking alternatives, both measured and both refused.**

*Filtering to starts only*, the obvious fix. On that subset the model **loses to
the baseline at every dispersion tried** — paired t of +1.27, +1.09, +0.92, +0.70
and +0.51 at 1, 1.1, 1.2, 1.35 and 1.5, positive meaning the plain average wins.
So the model's entire measured edge is in absorbing a change of role, and removing
the role change removes the edge. That is a materially different claim from "it
rates a starter better", and it is the true one.

*A per-inning rate times expected innings*, which is theoretically invariant to
how long an appearance ran. Decisively worse: paired t of **+7.49** against the
per-appearance rate over 4,703 starts, Brier 0.1966 against 0.1915. Multiplying
two noisy estimates compounds error faster than the decomposition removes bias.

**The consequence a reader can be bitten by, unfixed.** A pitcher who has been
relieving and is then announced as a starter carries a rate built mostly from
one-inning outings, so his strikeouts are **understated**. Recency weighting
narrows the window but cannot see the announcement, and both attempts to teach
the model the difference measured worse than leaving it alone.

**A pitcher needs starts on record before a start is projected.** Eight
appearances of three innings or more, and this is an *eligibility* rule rather
than a rate rule — the distinction is measured. Filtering the **rate** to starts
only makes the model lose to a plain average, because the recency weighting is
what tracks a change of role. But "what is his strikeout level" and "does the
model have any basis for projecting a six-inning start" are different questions,
and only the second needs starts.

Without it, a reliever named as an opener is projected from one-inning outings.
Live, one carried an expectation of **0.82 strikeouts for a start** — not so much
a wrong estimate as an estimate of a different question. On a real slate the
separation is unambiguous: genuine starters had 88–97% of their appearances above
three innings, a swing man 14%, and the opener **none of 69**.

It is a correctness guard for the page rather than a calibration gain, and the
measurement says so: applying it removes 4 pitchers of 120 and moves nothing —
Brier 0.2015 against 0.2012, paired t −2.61 against −2.60, dispersion 1.159
against 1.160.

**One provider fact this uncovered, which also affected the team model.** The
scoreboard is keyed by **US date, not UTC**. A fixture starting at 01:40 UTC is
listed under the *previous* day, so asking only for the UTC date finds no
announced starter for nearly every night game — measured on event 401817044, and
`startersFor` had been doing exactly that since the starting-pitcher work
shipped. Both candidate dates are now asked for, and both are cached per date.

**Two things this gate did not establish.** The lines are a fixed ladder rather
than prices anybody quoted, because no historical book lines exist here; the
calibration claim is therefore about the model's probabilities at plausible
thresholds, not about its edge against a real market. And 120 of 291 announced
starters were read, so the sample is the busiest end of the rotation rather than
every pitcher who started a game.

**Its own harness.** `backtest.ts` reports margin and total error over
home/away/draw and cannot express this claim; `bout-backtest.ts` is the
precedent — a separate harness because it scores a different kind of claim —
and a player harness follows it: one binary event, bucketed into calibration
bands, with coverage reported beside error.

**Four traps, three of them already paid for once in this codebase.**

1. **Rebuild ratings per day, not per appearance.** `bout-backtest.ts` learned
   this: rebuilding per contest let the third fight on a card learn from the
   first two, which no live projection could do.
2. **Bound the window at both ends.** The lower bound is fidelity to what the
   live model is given, and its absence is what made `historyDays` unfittable
   for the team model.
3. **Exclude pre-season, and know what the filter keeps.** `calibrate.ts`'s NFL
   window is 1 September to 28 February, so it correctly drops August
   exhibitions and **keeps the Pro Bowl** — the first NFL 2025 record in the
   archive is AFC v NFC at the Moscone Center. One game in 334 is negligible
   for a team constant and not obviously negligible for a player, whose usage in
   an exhibition is nothing like a real game. Its team ids are 31/32 rather than
   clubs, so attribution by club id may exclude it already — a check to run, not
   an assumption.
4. **Ask whether the count is actually Poisson.** A Poisson process fixes
   variance at the mean; baseball's *scoring* measured 2.27 and needed the
   distribution changed rather than its constants. A pitcher's strikeouts per
   start inherit variance from innings pitched varying, so the same question
   must be asked per statistic, with `measureDispersion` and
   `sampleOverdispersed` already in place to answer and to fix it. A per-inning
   rate times expected innings is the alternative to a flat per-start rate, and
   which one wins is measured, not argued.

**Cost, from the local archive.** `data/history/<league>/<season>.json` holds
2021–2025 with ids already in the `espn-<league>-<eventId>` form the fetcher
takes, so a season backtest runs offline apart from the player reads:

| | Finished 2025 games | Player reads for the pilot |
|---|---|---|
| MLB | 2,936 | **~2 gamelogs per fixture** |
| NFL | 334 | 334 box scores |
| NBA | 1,397 | 1,397 box scores |
| NHL | 1,498 | 1,498 box scores |

The pilot is the cheapest thing on this table to gate, which is decision 1's
fourth reason.

**Report** the numbers here and in `docs/projection-engine.md`, in the NCAAF
section's format.

---

## 8. Cross-cutting rules

- **No fabrication.** If an input does not exist, the output does not exist. No
  placeholder players, no invented lines, no made-up prices.
- **A probability and a price are never merged.** The
  `MarketContext` / `EdgeAssessment` separation holds.
- **Backward-looking code sees only the past.** Any leak of post-kick-off data
  into a backtest is a bug, and the season-to-date columns the provider puts
  inside a single game's row (§6 decision 5) are the specific trap here.
- **Never explain an artefact.** §5.2 is the worst behaviour in the existing
  implementation because it is confident prose attached to a number the model
  could not compute. A figure that could not be measured is reported as
  unmeasured.
- **Absent is not zero, and the provider does not always agree.** Football
  writes real zeros for a player who never came on. A rule that holds by luck
  in four sports and fails in the fifth is not a rule yet.
- **Status is not impact**, and **a recent appearance is not a team sheet.**
  Decision 3 exists because those two are the easiest things to conflate here.
- **Team projections stay byte-for-byte identical.** `MODEL_VERSION` does not
  move for this work.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` and `pnpm format:check` pass at the
  end of every phase, not once at the end.

---

## 9. Sequencing

| Order | Phase | Why here |
|---|---|---|
| 1 | A — data layer | Everything rests on it, and §5.6's four contradicted assumptions must be fixed before anything is built on them |
| 2 | B — model | Needs A. Its first step is the price measurement, because that decides whether C has anything to attach to |
| 3 | F — the gate | **Before C, D and E, not after.** The existing branch's mistake is having built the market before measuring whether it is calibrated, and running the gate early means a failed statistic costs no interface work |
| 4 | C — markets and settlement | Mostly built; small corrections |
| 5 | D — correlation and the builder | The largest genuine design decision, and step 2 needs its own measurement |
| 6 | E — interface | Last, so nothing is rendered that the gate has not cleared |

Phase F sits third deliberately. It is listed sixth in the brief, and moving it
earlier is the one place this spec departs from that order — for the reason §5
demonstrates at length.

---

## 10. Acceptance criteria

1. Every shipped statistic has a recorded backtest result — calibration bands,
   Brier, log loss — and beats the season-average baseline on the same fixtures.
2. Every existing team projection is provably unchanged, from the same test
   fixtures, and `MODEL_VERSION` has not moved.
3. A player with no participation evidence produces **no selection**, not a low
   confidence one.
4. A player who did not take part **voids**, proven end to end rather than in
   the settlement unit alone — §5.8 means this path is the one most likely to
   fire for a reason unrelated to the player.
5. A player leg can be built, published, settled and reported, with a test that
   follows one all the way through. The UFC's invisibility is the failure this
   criterion exists to prevent.
6. The bet builder reports a player leg's own probability for a single-leg slip,
   and never explains a correlation it could not measure.
7. Two different players never collide in one slip.
8. `by_market` is rendered, and player markets are withheld below 20 settled
   predictions like everything else.
9. Every documentation claim in §5.7 is corrected in the phase that falsifies
   it, not batched at the end. `CHANGELOG.md` gains entries under Unreleased in
   the existing voice.
10. Nothing new persisted outside `$DATA_DIR`, and everything persisted is
    documented in `.env.example`.

---

## 11. Deliberately out of scope

- **Any sport beyond the pilot, until the pilot is through F.** The brief's own
  instruction, and §5 is what happens without it.
- **MLB batter markets.** No lineup is published pre-game (§4.2), so decision 3
  excludes them. They are the natural third increment, behind the NFL.
- **Minutes-based football (soccer) markets.** There is no minutes statistic.
- **A player's Champions League record.** The gamelog ignores the league in its
  path and returns the domestic league (§4.1b). No observed way to ask.
- **Half and quarter player markets.** The model simulates whole games.
- **Alternate lines beyond what is quoted**, per decision 6.
- **Same-game player-plus-team combinations**, until §7.4 step 2's coupling is
  measured.
- **Retraining from recent results.** Measuring comes first; adjusting a model
  from a bad weekend is how a system learns superstition.

---

## 12. Open decisions

### The pilot, against a stated preference

Decision 1 picks MLB pitcher strikeouts on the evidence in §4.2. The NFL was
chosen in conversation before any of that evidence existed, and the NFL
implementation is the one that is built. This is the one decision in this spec
that is a genuine choice rather than a finding, and it is flagged rather than
buried: the participation measurement is `0 of 14` for the NFL against `12 of
12` fixtures with at least one announced starter for baseball, and that is the
whole of the argument. Overruling it costs one line here and the NFL's own
Phase F.

### Whether the core API's depth charts are worth resolving

`.../seasons/2026/teams/4/depthcharts` returns real data where the site host
returns `{}` (§4.2). Its positions are `$ref`s, and the cost of resolving them
to athletes is unmeasured. If it is cheap, it is the first participation
evidence the NFL and NBA would have, and decision 3's exclusion of them could
be revisited on evidence. The `$ref`-chasing core path was already rejected once
for pitchers at ~30 requests each, so this is a measurement to run rather than a
plan.

### Whether the injury cap can be paged past

The summary returns at most five a side (§4.2). No paging parameter was tried.
The competition-wide report is already the workaround and is already used, so
this matters only if a per-fixture call would otherwise be cheaper.

### Which name wins

`player_performance` or `player_stat` (§7.3 step 1). A one-word decision with a
store migration behind it, since the selection type is persisted on every
record.

---

## 13. Documentation

Update as each phase ships, never batched. `docs/betting-markets.md`'s "No
player markets" section and `docs/projection-engine.md`'s "What is missing" both
already carry text written by the partial implementation and must be corrected
to describe what is actually gated and why. `docs/prediction-accuracy.md` gains
the real DNP rule once it has fired in production rather than only in a test.
`docs/data-providers.md` gains the `player_gamelogs` capability and the
`?season=` finding, which is the most reusable thing in this document.
`README.md`'s "Player projections are absent" line goes. This spec's status
moves from **draft** to **built** phase by phase.
