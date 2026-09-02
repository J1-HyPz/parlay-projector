# Projection engine

Parlay Projector estimates what the available evidence suggests, and how
uncertain that estimate is. It does not claim certainty, and there is no path
through the code that produces one.

```
completed results  →  team ratings  →  sport model  →  simulation
      →  candidate selections  →  risk optimiser  →  published prediction  →  settlement
```

Everything traces back to real fixtures and real scores from the sports data
layer the rest of the application already uses. No second pipeline exists, and
no component calls a provider.

---

## What the data actually supports

This was checked before anything was built, and it shapes the whole design.

**Available:** completed fixtures with final scores, standings, team lists,
head-to-head records, and kick-off times — from which rest days are derived.

### Loading history

Two undocumented provider limits shape how history is fetched, and **both fail
silently**:

- A date range beyond roughly a year returns an **empty** event list rather than
  an error, so a two-season request looks like a competition with no fixtures.
- Any range is capped at the **earliest** N events. A single 200-day MLB request
  therefore returned a fortnight of spring training with everything recent
  missing — and produced ratings that looked perfectly reasonable.

So history is loaded in **45-day windows**, and a window that comes back at the
cap is split in half and retried. The window length is per sport, because the
calendars differ enormously:

| Sport | History | Why |
| --- | --- | --- |
| NFL | 400 days | 17 games across five months, then a long gap |
| Football | 400 days | Season runs August to May |
| NBA, NHL | 330 days | ~80 games in six months |
| MLB | 300 days | ~160 games in seven months |

### Rating pools

Competitions in the same pool are **rated together**. Every football competition
shares one, so a Champions League tie is projected from the clubs' domestic
results. Without it a club has a handful of European games a season — far below
the minimum — and every cup tie read "projection unavailable".

The pooling is sound rather than a convenience: those competitions are precisely
where clubs from different leagues play each other, so a shared Elo is
meaningful. The simplification is that attack and defence rates use one global
football average, which slightly flattens differences in league scoring
environments.

The American leagues are each rated alone; they share no fixtures with anything.

**Not available, anywhere in this application:**

| Missing | Consequence |
| --- | --- |
| Player statistics (rosters carry name, jersey, position, height, weight, age — no stats) | **No player performance selections.** |
| Injuries, suspensions, expected availability | Not modelled. |
| Lineups, starting pitchers, starting quarterbacks, goalkeepers | Not modelled. |
| xG, EPA, pace, offensive/defensive ratings | Not used; scoring rates are derived from results instead. |
| Any tennis competition in the league catalogue | **No tennis model.** |

The brief asks for player props and tennis. Both are absent because the inputs
they require do not exist, and generating them would mean inventing the
evidence. `player_performance` exists as a selection type and settlement
handles it, so a future data source can fill it in; nothing currently produces
one.

---

## Team ratings

Built in `lib/projections/features.ts` from completed results only. Two passes,
both ordinary and inspectable.

**1. Elo**, walked forward chronologically so each update sees only the ratings
as they stood before that game. Margin of victory is included with the usual
diminishing-returns multiplier, damped when the winner was already the stronger
side — otherwise favourites beating weak opposition inflate without limit. Home
advantage is applied to the *expectation*, so an away win moves the rating more.

**2. Scoring rates.** A recency-weighted mean of goals/points scored and
conceded, with an exponential half-life set per sport. Older games are never
dropped entirely — a model driven by the last handful of results swings on
noise.

Then two corrections:

- **Regression to the league average**, proportional to how much history a team
  has. Four games of "form" is mostly noise, and the rating says so.
- **Opponent adjustment.** Each result is divided by the opponent's own rate
  before averaging, so a goal against a mean defence counts for more than one
  against a leaky defence. The ratio is clamped to 0.5–2 so an extreme
  early-season opponent rating cannot distort a whole profile.

---

## Sport models

Not one formula with different constants. All values live in
`lib/projections/config.ts`.

| | Scoring | Draw | Spread | Baseline total | Home adv. | Elo weight |
| --- | --- | --- | --- | --- | --- | --- |
| NFL | Normal | No | Yes | 44 | 1.8 | 0.40 |
| NBA | Normal | No | Yes | 226 | 2.2 | 0.40 |
| MLB | Poisson | No | Yes | 8.6 | 0.2 | 0.30 |
| NHL | Poisson | No | Yes | 6.2 | 0.25 | 0.35 |
| Football | Poisson | **Yes** | No | 2.7 | 0.3 | 0.35 |

**Poisson** for goals and runs: counts, discrete, right-skewed, variance fixed
by the mean, and a draw is a real outcome. **Normal** for points: the sum of
many scoring events, where an exact tie is rare enough to resolve by
expectation (overtime, roughly a coin flip with an edge to the better side).

Football gets no spread. A goal handicap on a 2.7-goal game is a different
animal from an NFL spread, and there is no reliable way to price the half-goal
lines that would matter — so it is left out rather than guessed.

### Expected scores

```
expected = league_average × clamp(attack_ratio × opponent_defence_ratio, 0.3, 2.5)
           ± home_advantage / 2
           − short_rest_penalty (when one side is disadvantaged and the other is not)
```

Then **Elo corrects the margin**, not the answer: the rate model captures how
teams score, Elo captures who beats whom. Where they disagree the margin moves
toward Elo by `eloWeight`, with the total held constant — the correction changes
the shape of the game, not how much scoring it contains. Elo is never used
alone.

Rest is a feature, not a rule: a back-to-back costs an NBA side 1.5 points, an
NFL short week 1.0, and MLB nothing at all.

### Simulation

Every fixture is simulated 10,000 times (configurable, clamped 1,000–50,000),
seeded from the game id so the same fixture reproduces the same projection
rather than wobbling between page loads. Tests pass a fixed seed.

**Every probability is read off the same set of simulations** — winner, spread
cover, total, team total. Deriving each from its own closed form is what
produces a 60% winner sitting beside a 70% cover of the model's own line.

---

## Probability, confidence and data quality

Three separate quantities, deliberately.

**Probability** — how likely the model believes the outcome is.

**Confidence** — how reliable that estimate is. Falls with thin samples,
unusually volatile scoring, and lopsided histories between the two sides. A
model can be quite sure a team wins 80% of the time and still be working from
six games; that is a high probability with low confidence.

**Data quality** — how much information went in, driven by the **weaker** of the
two sides. A fixture where one team has thirty games and the other has three is
a thin projection, and averaging would disguise that. Standings and a
head-to-head record add a little, because they corroborate rather than replace
results.

**Below 0.35 data quality, no projection is produced at all.** "Projection
unavailable" is the output — never a fabricated percentage.

---

## Selections

Lines come from the model's own simulated distribution, not from familiar
numbers:

| Type | Line taken from |
| --- | --- |
| Winner | Simulated outcome shares |
| Double chance (football only) | Win + draw |
| Spread — conservative | 80th percentile of the simulated margin |
| Spread — model line | The mean margin, to the nearest half point |
| Total | 20th / 80th percentile of simulated totals |
| Team total | 20th percentile of that team's simulated scores |

All lines are half points, so nothing can push.

**Ranking** is `probability × confidence × data_quality`. Probability alone is a
poor ranking: an 85% call from six games is worse than a 72% one from a full
season, and multiplying expresses that directly while staying interpretable.

---

## Risk profiles

Relative analytical categories. **"Low risk" never means safe**, and the
interface does not say it does.

| | Probability band | Default legs | Min. data quality | Min. confidence |
| --- | --- | --- | --- | --- |
| Low | 70–95% | 3 | 0.60 | 0.60 |
| Medium | 58–78% | 4 | 0.50 | 0.50 |
| High | 45–66% | 5 | 0.45 | 0.45 |

The upper bound on Low is deliberate: a 97% selection usually means a thin
sample and an extreme rating gap — a data problem wearing a confident face.

**Nothing is padded.** A five-leg request that only three candidates support
returns three, and if fewer than two qualify it returns no line with an
explanation.

---

## Correlation

The rule that does most of the work: **at most one selection per game.**

"Chiefs to win" and "Chiefs -3.5" are close to the same call; multiplying their
probabilities would report a confidence the model does not have. Every selection
from a fixture shares a `correlation_group`, the optimiser takes the
highest-scoring one, and the legs are therefore across different fixtures and
near enough independent for the product to mean something.

Same-game combinations would need a joint model and are not produced. The
optimiser also spreads across sports when quality is comparable — a preference,
not a requirement, since quality comes first.

**Regenerate** rotates the starting point of the candidate list. It explores a
different valid combination and never touches a probability.

---

## Storage and settlement

Predictions are published to `$DATA_DIR/predictions-v2.json` — the mounted
TrueNAS dataset, alongside the notification state. This is the one thing in the
application that must survive a redeploy, because it is the only evidence the
model works. No database server is introduced; a file behind a small interface
is enough, and moving to Postgres later means adding an implementation rather
than rewriting callers.

**The probability and the settlement rule are frozen at publication.** Nothing
is recomputed afterwards. A record whose settlement rule is missing or malformed
is dropped rather than reconstructed from its label — rebuilding it would mean
settling against a line the model never published.

Settlement runs on the notifier's timer, or its own every 30 minutes when
Discord is not configured. It reads final scores from the shared fixture cache
and compares them against the stored rule.

A cancelled or postponed game **voids**: the projection was never tested, and
counting it either way would distort the figures.

---

## Measuring the model

Accuracy alone is misleading — a model that only ever backs heavy favourites can
post an impressive percentage while being badly calibrated. So:

- **Accuracy**, withheld below 20 settled predictions. Below that a percentage
  is noise dressed as a finding.
- **Brier score**, mean `(probability − outcome)²`. Lower is better; 0.25 is
  what always saying 50% earns.
- **Log loss**, which punishes confident mistakes far harder.
- **Calibration buckets** — of the predictions rated 70–79%, how many actually
  came in? Reported per band, withheld below 10 in a bucket.

Settled predictions feed the existing homepage accuracy widget. There is **one**
accuracy system, not two.

### Backtesting

`lib/projections/backtest.ts` replays completed games in order. For each one the
ratings are rebuilt from **only** the results that finished before its kick-off,
a projection is produced, and the real result is applied afterwards.

Look-ahead safety is enforced at the source: `toResults(games, asOf)` filters on
the cut-off, and the backtest passes each fixture's own kick-off. A test
re-derives sample cases from the pre-game slice and asserts the probabilities
match exactly — if a result were leaking into its own prediction, they would
not.

---

## Cost

A page of parlays does **not** produce hundreds of provider requests:

- History is chunked, but a window that ended before today can never change and
  is cached for a **week**. After the first warm-up only the window containing
  today is refetched.
- Ratings are derived once per pool and cached, so the nine football
  competitions cost one set rather than nine.
- Projections are cached per fixture, with the lifetime tightening as kick-off
  approaches: 6 hours beyond a day out, 2 hours inside a day, 30 minutes inside
  six hours.
- Every risk level and every regeneration reads the same cached candidates.

---

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROJECTION_MODEL_VERSION` | `projection-v1` | Stored on every prediction so older ones stay interpretable |
| `PROJECTION_SIMULATIONS` | `10000` | Monte Carlo runs per fixture (clamped 1,000–50,000) |
| `PROJECTION_CACHE_TTL_SECONDS` | `21600` | Fallback lifetime; the effective TTL tightens near kick-off |

None is a secret. The model is deterministic given its inputs, and its inputs
are the sports data the application already fetches.

---

## Endpoints

| Endpoint | Returns |
| --- | --- |
| `GET /api/projections/games?sport=` | Projections for every eligible upcoming fixture |
| `GET /api/projections/games/:gameId` | One fixture, or `projection: null` with a reason |
| `GET /api/parlays?risk=&sport=&legs=&variant=` | A generated line, or `null` with `insufficient_candidates` |

No endpoint returns odds, prices, bookmaker data or monetary figures. There is
no stake field and no projected return anywhere in the application: without real
bookmaker odds a return figure would be invented. `implied_odds` is available as
the model's own probability expressed as a decimal, labelled as such.

---

## What this model does not do

- **No player projections**, for the reasons at the top.
- **No tennis.**
- **No league-strength adjustment inside the football pool.** All football
  competitions share one average, so a mid-table Serie A side and a mid-table
  League One side start from the same baseline. Elo separates them over time
  through European ties, but the scoring rates do not.
- **Home/away splits are computed but only lightly used** — they feed data
  quality rather than the expected score, because four home games is not enough
  to justify a separate rate.
- **Parameters are calibrated assumptions, not learned.** The home advantages
  and baseline totals come from published long-run averages for each
  competition. Once enough settled predictions exist, the calibration buckets
  are what should drive revising them.
