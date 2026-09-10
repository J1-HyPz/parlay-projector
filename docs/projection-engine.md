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

## Fitting a competition's parameters

Most competitions run on their sport's model. Where one does not fit, the
parameters are **measured or fitted against completed games**, never chosen by
judgement. NCAA Football is the worked example, and the method is the point:

| Parameter | How it was decided |
| --- | --- |
| `baselineTotal` | **Measured.** The mean total across 2,021 games. Not a free choice |
| `homeAdvantage` | **Fitted.** The value that drives residual bias to zero. Not the raw home margin, which the ratings already carry most of |
| `scoreSd` | **Read off the residuals.** The model's margin SD is `scoreSd × √2`; it has to match the spread of real errors |
| `historyDays` | **Fitted.** How far back is still informative, judged by coverage against error |

Everything else is inherited. A diff that only moves what the evidence
supported is a diff that can be argued with.

### Why the width matters more than it looks

A model whose stated uncertainty is narrower than its real error does not
merely lose a little accuracy — it **misprices every threshold market**. NCAA
Football claimed a margin SD of 14.1 while its errors spread 16.5. That is how
a handicap the evidence puts at 60% goes out at 84%, and it is why the sport's
spread and team-total selections were failing while its winner selections were
fine. Direction was right; magnitude was not.

### Refusing to project is a result

The least obvious finding. At the NFL's 400-day window, a college fixture in
week one is projected from last season's roster and reports data quality 0.85
while missing the margin by 21 points. Nothing downstream can filter that,
because 0.85 clears every risk profile.

Shortening the window to 300 days means such a fixture has too little history
and is skipped. Across the 2025 season that cost 83 mid-season projections out
of 506 with the margin error unchanged, and removed 50 confident, wrong
projections from the opening fortnight. On the live card it takes NCAA Football
from 86 projected fixtures to 2, with 84 skipped.

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

#### Where it is reported

`/accuracy` renders what the service computes. The headline figure lives on the
homepage; the breakdowns live here, and the one that matters most is **by
competition**.

`by_sport` cannot stand alone, because a sport is not a competition. Five
competitions — the NFL, NCAA Football, the CFL, the American Football League
Europe and the European Football Alliance — all carry `sport: 'nfl'`, so a
sport-level figure averages all five into one number. That is exactly how NCAA
Football's miscalibration stayed hidden inside a healthy-looking NFL figure
until it was fitted its own config. `by_league` groups on the catalogue id
instead, so each competition is checkable on its own.

Two rules travel with every row:

- A rate is withheld below `MIN_REPORTABLE` and the count is shown instead.
  Brier and mean claimed probability are shown regardless — both say something
  at a sample size a percentage does not.
- Predictions carrying no `league_id` are counted under **Unattributed** rather
  than dropped. Two cases produce it: a record written before the field
  existed, and one written by a path that never had a competition to stamp.
  Neither is a competition, so neither is given a competition's name.

The risk-ordering check is surfaced on the same page, and only once it has
enough settled history to have actually run — `ordered` defaults to true so an
unknown cannot read downstream as a failure, which means `checked` is the gate
on saying anything at all.

### Player availability

Game pages show each side's injury report and, for baseball, the probable
starting pitchers. It is a **display feature only** — no projection, expected
score, probability or `MODEL_VERSION` is affected by it. Knowing a player is
out is not knowing what the absence is worth, and sizing that needs player
statistics this application does not hold.

Injuries come from the competition-wide report (`<league>/injuries`), cached
per competition for fifteen minutes and shared by the game page and the
projection pipeline — so the two cannot disagree about how many players are
out, which they briefly did when the page read the fixture summary's
five-per-side extract instead. Probable starters still come from the fixture
summary, which is the only place they appear and which `espnGameDetail` already
fetches.

The two feeds signal "not covered" differently, which is worth knowing before
touching either: the summary omits its `injuries` key, while the league feed
always sends the key and sends an empty array. A league report naming zero
teams is therefore treated as no report at all — a covered competition never
returns zero, and reading football's empty array as "nobody is injured" would
state a squad is fit on no evidence.

Coverage is uneven and the contract says so rather than papering over it.
`GameDetail.availability` is `null` where the provider publishes nothing for
the competition — every football fixture, and every competition served by
TheSportsDB — and an object with empty player lists where it covers the fixture
and reports nobody. Those are different claims and the interface keeps them
apart.

Two normalisation rules are worth knowing before changing this code:

- Status keys on the provider's machine enum (`type.name`), never on the free
  text beside it, which is inconsistent between leagues — baseball sends
  `"suspension"` where hockey sends `"Suspension"`. An unrecognised enum
  becomes `listed` and shows the provider's own label rather than being guessed
  into `out` or `available`.
- `INJURY_STATUS_ACTIVE` means listed but expected to play, and is the majority
  of the NFL's report. It is never counted as an absence.

**What the model does with it: nothing, deliberately.** Availability reaches
`projectGame` and changes two things, both text — the `quality_reasons` line
and a `kind: 'uncertainty'` factor naming how many are out on each side. It is
kept out of `dataQuality` and `estimateConfidence` on purpose. The model knows
who is missing; it does not know what they are worth, and folding a count into
a quality score would manufacture exactly the value it lacks. `MODEL_VERSION`
is unchanged because no probability moved.

### Starting pitchers (MLB only)

A baseball fixture whose starter has been announced uses that pitcher's own
runs-allowed rate in place of part of the opposing side's team defence rate.
This is the only individual-player input in the application, and it does not
generalise: a starting pitcher is the one participant in any sport here who
accounts for most of a side's defensive innings, and their rate is already in
the same unit as the team rate it displaces.

Three rules hold it together:

- **The rate is always as at the kick-off.** Never the season-to-date ERA the
  scoreboard offers for free, which for any backward-looking purpose includes
  starts made after the fixture being judged. `rateBefore` rebuilds it from the
  starts that finished earlier — the same discipline `toResults(games, asOf)`
  applies to team ratings.
- **The live path and the backtest share one definition.** Both read the same
  per-start gamelog through the same function. A model measured on one
  definition and shipped on another has not been measured.
- **It is a blend, not a swap.** The starter covers their mean innings; the
  team rate covers the rest, standing in for a bullpen rate this application
  does not have. That approximation biases toward the unchanged model, which is
  the right direction for it to err in.

Below `MIN_STARTS`, or with no announced starter, the fixture is projected
exactly as it was before this existed.

Backtested over 1,795 fixtures of the 2026 season: margin MAE 3.591 → 3.556
(paired t = −2.28), total MAE 3.605 → 3.575 (t = −1.43). Margin is the only
metric that separates from noise; the effect is real and small. MLB projections
are stamped `projection-v1-mlb-sp` via `SportModelConfig.modelVersion`, which
overrides the global constant for one sport so the rest are not relabelled as
though they had changed too.

### The long-run history archive

`DATA_DIR/history/<league>/<season>.json` — one file per competition per
completed season, filled by `pnpm history:backfill`.

**It is not a longer rating window, and that distinction is the whole point.**
`historyDays` feeds `buildRatings`, a team's *current* attack and defence rate,
and extending it is the mistake NCAA Football's config already made: a window
reaching into a prior season lets a team with no games yet this year borrow
last year's roster at a data quality high enough to clear every risk profile.
Nothing in `lib/history/` is wired into `buildRatings`, and nothing read from it
may be. It exists to calibrate league constants and to answer questions about
seasons, not about form. The archive changes no projection today.

Why files rather than the in-memory cache: a completed season never changes,
and the process-local cache would re-fetch several years of fixtures on every
redeploy. Why one file per season rather than one archive: a calculation only
ever needs one competition at a time, and adding a finished season writes a
small new file instead of rewriting a large one.

Three rules the fill obeys, each learned rather than assumed:

- **Only completed seasons are written.** An in-progress season can still gain
  results, and a file claiming a whole season while missing its last month
  would move any constant fitted from it with nothing able to tell.
- **An empty season is never written.** This was the other way round first, on
  the reasoning that a competition younger than the window genuinely has no
  fixtures. Then the CFL came back empty because the provider rate-limited the
  fetch, and the archive wrote a file asserting a season that was played
  contained no games. The two are indistinguishable from outside and only one
  is safe to be wrong about, so neither is persisted.
- **A season boundary is a fact about a competition, not its sport.** The CFL
  is `sport: 'nfl'` and plays June to November; inheriting the NFL's
  August-to-February window clipped it to 27 games where the league plays 81.
  `LEAGUE_BOUNDS` in `lib/history/season.ts` overrides the sport default for
  the CFL, AFLE and EFA, which all play summer schedules.

Nothing errored in either of the last two cases — the files were written
faithfully from a wrong question, which is precisely why file validation could
never have caught them and why the counts were checked against what each
competition actually plays.

### Deep head-to-head

The archive's first reader, and it costs no provider call. ESPN's
`seasonseries` covers meetings *within the current season only* — one to four
games, and in August frequently none — so the game page's head-to-head section
used to be shallow or empty for most of the year. `meetingsBetween` asks the
same question of files already on disk and reaches as far back as the archive
goes.

The two sources are merged rather than one replacing the other, because the
provider still knows about a meeting from this season that last month's
backfill cannot. De-duplication is on the id's **trailing segment**: the
archive stores `espn-epl-740911` where the provider returns the bare `740911`,
and matching on the whole string showed every recent meeting twice. Not on the
date — a baseball double-header is two real meetings on one day.

The record is reported with its sample size and its span attached, and is never
scored. Across five seasons most pairs have met a handful of times, and a 4-1
record over five years is a fact about five afternoons rather than a property
of either side. `headToHeadPattern` will only state a skew at six meetings or
more and at a 70% lean; below that it returns null, which is the usual and
intended answer.

### Conditions (MLB only)

An outdoor baseball fixture's projected total is adjusted for the temperature
at first pitch. Nothing else in the application uses weather, and nothing else
measured a reason to.

**The spec proposed wind; the data said temperature.** Across 3,645 open-air
fixtures, wind speed correlated with the total at -0.022 (t = -1.33) and
precipitation at -0.023 (t = -1.41) — both indistinguishable from nothing.
Neither is a surprise on reflection: raw wind speed says nothing without a
direction relative to the outfield, and a gust blowing in cancels one blowing
out; baseball does not play through meaningful rain, it waits. Temperature
correlated at +0.084 (t = 5.08) and survived every confound — +0.061 within a
month, +0.078 within a venue, +0.063 within both — so it is neither the
calendar nor a park effect. Warm air is thinner and the ball carries.

The slope is **0.045 runs per degree**, not the raw 0.0596. The
confound-controlled relationship is about three quarters of the raw one, and
fitting the raw slope would bank a correlation partly owned by the month. It
also holds up better on the held-out seasons: t = -2.65 against -2.29, for a
total MAE within a thousandth.

Three properties hold it together, all asserted in tests:

- **The adjustment is split evenly across both sides**, so it moves the total
  and leaves the margin exactly. Temperature does not favour a team.
- **It is capped**, at 0.8 runs. A modifier acting on a forecast with no
  ceiling is a way to be confidently wrong about a fixture the model used to
  say nothing about.
- **Absent means unmeasured, not zero.** A competition whose config carries no
  `weather` block, a covered ground, or a fixture whose conditions could not be
  fetched all project exactly as they did before this existed.

Gate, per §4.5: total MAE on outdoor fixtures only, 3,638 held out. 3.5945 to
3.5803, paired t = -2.65. Roofed fixtures came out identical to four decimal
places on every metric across 2,764 of them — the acceptance criterion proven
rather than asserted.

**One honest gap.** The backtest used the weather that actually happened; live
projections use a forecast. Forecasts are wrong sometimes, so the live benefit
will be smaller than the measured one. The direction is not in doubt; the size
is optimistic.

`Venue.indoor` comes from the provider and is a property of the **ground, not
the night** — checked, not assumed. Every retractable-roof park reports covered
on every date sampled, so such fixtures simply get no adjustment. That is
conservative in the right direction, at the cost of forgoing one when the roof
was open.

### The ground

`lib/projections/parks.ts`. **MLB only**, and it is not the feature §4.7 of the
v2 spec proposed.

**What was proposed, and why it was refused.** The spec proposed blending each
team's own `homeAttack` / `awayAttack` rates into the expected score. Measured
across thirteen competitions and 1,443 team-seasons, a team's home/away split
carries no signal to blend. Under the null that every club shares one
league-wide split, the expected spread of observed splits is computable from
per-game scoring variance and games played — and in twelve of the thirteen the
*observed* spread sits at or below it:

| | mean split | observed SD | noise SD | reliability | odd/even | season to season |
|---|---|---|---|---|---|---|
| NFL | 2.20 | 4.17 | 4.37 | 0 | — | -0.08 |
| NHL | 0.24 | 0.35 | 0.36 | 0 | -0.12 | +0.09 |
| EPL | 0.27 | 0.37 | 0.39 | 0 | -0.05 | +0.24 |
| NCAAF | 6.34 | 6.52 | 7.21 | 0 | — | +0.14 |
| NBA | 2.10 | 2.81 | 2.60 | 0.14 | +0.07 (t=0.90) | +0.08 (t=0.91) |
| **MLB** | 0.03 | 0.76 | 0.59 | **0.40** | **+0.32 (t=4.13)** | **+0.32 (t=3.64)** |

No direct test of persistence reaches significance outside baseball. A blended
split would have been fitted to sampling noise.

**Baseball's split is real, and it is the ballpark rather than the team.** Two
measurements separate those. A club's home *scoring* split and its home
*conceding* split move together (r = +0.275): a genuine home advantage would
push them apart, since a side playing better at home should also concede less
there, whereas a ground that helps hitters helps both sides. And the same
ground repeats the following season (r = +0.426), which a property of a roster
would not.

**What the model was actually getting wrong was the rating, not the ground.** A
club's scoring rate is built from every game it plays, half at its own ground
and half spread over everyone else's, so a club at an extreme park carries a
rate too low for its home fixtures and too high for its away ones. Across five
archived seasons the two errors mirror each other at **r = -0.947**: Colorado's
totals ran 1.39 runs light at Coors and 1.23 heavy on the road, Seattle's the
same in reverse. A bonus applied at Coors alone would have corrected one half
and left the other untouched.

So the adjustment is a **difference** — this ground's factor against the factor
the visitor's own rating carries in:

```
adjustment = clamp((factor[home] - factor[away]) * weight, -cap, cap)
```

Fitted as two free weights, the two terms came out very nearly equal and
opposite (+0.20 and -0.25), which is the signature a mirrored error must have.

A factor is measured as **the host's total runs at this ground minus the same
host's total away from it**. Subtracting a club from itself cancels its own
quality, which a raw average at the ground would absorb whole — Coors would
look inflated by however good the Rockies happened to be that year.

Properties, all asserted in tests:

- **Split evenly across both sides**, so the margin is preserved exactly. This
  is the same measurement that identified the effect: a park helps both sets of
  hitters, so it can move how much scoring the model expects but never who it
  favours. Verified on the analytic expectation across 7,483 held-out fixtures
  — the margin moved on **zero** of them.
- **The venue is checked, not assumed.** A fixture away from the home club's
  own ground — a neutral site, a relocation, a renamed park — gets no
  adjustment. Both clubs must carry a factor or none is applied, because
  applying one term without the other moves the total by a whole park factor
  where the evidence supports a fraction of the gap.
- **Capped**, at 1 run. It binds on exactly one pairing in either direction:
  Coors against T-Mobile, a 4.18-run gap that weights to 1.045.
- **Absent means measured-and-rejected, not unexamined.** Basketball and ice
  hockey went through the identical forward-chained test and both came out
  *worse* — paired t of +0.47 and +0.94, error moving the wrong way.

**Gate**, forward-chained so every fixture is corrected using only seasons
before its own, over 7,483 held-out fixtures in 2023-2025:

| | before | after | |
|---|---|---|---|
| total MAE | 3.5793 | **3.5681** | paired t **-3.09** at the shipped weight |
| per-ground bias, RMS over 32 grounds | 0.3773 | **0.2943** | |
| Coors Field bias | -1.406 | **-0.678** | |
| T-Mobile Park bias | +0.710 | **+0.386** | |
| margin MAE | 3.4675 | 3.4680 | unchanged, as it must be |
| Brier | 0.2457 | 0.2457 | |

The weight is **0.25**, not the 0.30 that minimises error. Error is flat from
0.25 to 0.35, and 0.25 gives the same figure to three ten-thousandths of a run,
a slightly better per-ground bias, and a materially firmer result (t = -3.09
against -2.67). Where a curve is flat, the better-established point on it is
the one to stand on. Above 0.4 the correction overshoots and the gain
collapses, which is independent evidence that the ratings already carry most of
the park.

**A note on how this was measured.** The harness scores
`projection.expected_total`, which is the *mean of the simulated draws* and so
carries sampling noise of about 4.4/sqrt(simulations) runs — roughly 0.09 at the
default 2,500, the same order as the adjustment being tested. That does not bias
the comparison but it costs power, and it made an early run of this gate read
t = -1.93. `projectGame` returns the analytic `expected` beside the
distribution, and scoring that is the noise-free limit of the same measurement;
re-running the simulated path at 12,000 draws agreed with it (t = -2.82 against
-2.71 at weight 0.30).

### Backtesting

`lib/projections/backtest.ts` replays completed games in order. For each one the
ratings are rebuilt from **only** the results that finished before its kick-off,
a projection is produced, and the real result is applied afterwards.

Look-ahead safety is enforced at the source: `toResults(games, asOf)` filters on
the cut-off, and the backtest passes each fixture's own kick-off. A test
re-derives sample cases from the pre-game slice and asserts the probabilities
match exactly — if a result were leaking into its own prediction, they would
not.

**The rating window is bounded at both ends.** The upper bound is the
look-ahead rule above. The lower bound is `historyDays`, and it was missing:
live, `leagueGames` fetches only `today - historyDays`, so `buildRatings` never
sees a game older than that, while the harness was handing it every prior game
in the list. That measured a model with an unbounded window — not the one that
ships — and it also made `historyDays` unfittable, since sweeping a value
nothing read would report "no improvement" at every setting and look like a
finding.

### Calibrating a competition

`lib/history/calibrate.ts` plus the archive is what replaces an `assumed`
constant with a measured one. Three rules, each of which produced a wrong
answer first:

- **Exclude pre-season.** The archive holds every fixture a competition played
  because they happened; the NFL's 335 a season include about 50 exhibitions.
  A constant fitted over them is fitted partly on games of backups.
- **Score every candidate on the fixtures every candidate projected.** Changing
  `historyDays` changes which teams clear `minGames`, so it changes which
  fixtures are projectable — 372 under a 120-day window against 570 under 300.
  Comparing their error rates directly says only which games a variant skipped.
- **Report coverage beside error.** The rule above fixes one bias and creates
  another: judged only on what it managed, a short window looks competitive. On
  the whole season it projects 65% of fixtures against 99.7%. "Coverage against
  error" is both words.

`scoreSd` is a **per-team** score SD — `model.ts` samples each side
independently — so the margin the model implies has SD `scoreSd * sqrt(2)`.
Comparing the constant against a measured margin spread directly makes a
well-calibrated model look 40% too narrow.

**Is the sport actually Poisson?** Worth asking before fitting anything for a
Poisson competition, because it asks something no constant can answer. A
Poisson process fixes the variance of a score at its mean; `measureDispersion`
reports the observed ratio. Measured across five archived seasons:

| Competition | variance / mean | margin SD | Poisson can produce |
|---|---|---|---|
| NHL | 0.99 | 2.62 | 2.49 |
| La Liga | 1.06 | 1.63 | 1.61 |
| Serie A | 1.04 | 1.71 | 1.61 |
| Premier League | 1.10 | 1.90 | 1.71 |
| Bundesliga | 1.15 | 2.02 | 1.78 |
| **MLB** | **2.27** | **4.48** | **3.01** |

Ice hockey and football are Poisson to within a few per cent, which is a real
validation of the model family. **Baseball is not**, and it is the one sport
here that needed its distribution changed rather than its constants.

`scoreDispersion` is that change. Above 1 the rate is drawn from a Gamma before
the count is drawn from a Poisson — a negative binomial — which gives variance
`dispersion * mean` while leaving the mean exactly where it was. That last part
is the point: widening a distribution must not move what it is centred on, or a
width fix quietly becomes a different projection. At or below 1 it returns
plain Poisson bit-for-bit, so every competition that measured Poisson is
untouched and none of them set it.

Baseball is fitted at **2.3**, by backtest rather than by taking the raw 2.27.
The observed ratio mixes two things — the spread of a single fixture and the
variation in expected score between fixtures — and the model already reproduces
the second through its own varying expectations, so plugging the raw figure in
would double-count. Held out on 2024 and 2025 separately, 4,956 fixtures:

| | width gap | Brier | log loss | margin MAE | accuracy |
|---|---|---|---|---|---|
| 2024 before | -1.41 | 0.2499 | 0.6936 | 3.454 | 54.9% |
| 2024 after | **+0.13** | **0.2464** | **0.6858** | 3.455 | 54.9% |
| 2025 before | -1.56 | 0.2476 | 0.6888 | 3.482 | 55.7% |
| 2025 after | **-0.03** | **0.2442** | **0.6813** | 3.482 | 55.8% |

Margin error and accuracy are unchanged to three decimals in both seasons,
which is the signature a width-only change should have. Had they moved, the
"fix" would have been altering the projection itself.

Note also that `scoreSd` is **inert for a Poisson sport** — `model.ts` reads it
in the normal branch alone. MLB, NHL and football carry values that change
nothing, kept only so a config has one shape.

**NBA: `scoreSd` 12 -> 10.3.** The NCAAF finding in mirror image — a stated
width seventeen per cent *too wide* rather than too narrow, which misprices
every handicap in the opposite direction. Implied margin SD 16.97 against a
measured error spread of 14.36 and 14.68 in the two held-out seasons; at 10.3
the gap closes to +0.21 and -0.11, and Brier and log loss improve in both
seasons over 2,660 fixtures. Stored under `projection-v1-nba-width`. Nothing
else moved: `baselineTotal` measured 225.61 against 226 and changed no
projection, and `historyDays` below 250 costs coverage for worse error.

**NFL: measured, no change warranted.** Five seasons, fitted on 2021-2023 and
reported on 2024 and 2025 held out. `baselineTotal` measured 44.79 against 44
and moving it changed nothing at all. `scoreSd` 10 implies a 14.14 margin SD
against a measured 14.07. `homeAdvantage` bias changes sign between the two
held-out seasons, and fitting it made held-out bias worse — 0.45 to 2.19.
`historyDays` below 300 costs a third of the season. Its width was checked the
same way basketball's was and does not survive it: the gap does close, from
+1.12 to -0.27, but Brier and log loss get marginally *worse* in one held-out
season and are flat in the other, and a pooled sweep and a per-season check
disagreed — which is what a noise-sized effect looks like. The findings are
recorded in the config's own comments so the check is not re-run blind.

**MLB and NHL: measured, no change warranted.** Ice hockey is the best-fitting
config in the application on every axis checked — `baselineTotal` 6.28 against
6.2, raw home margin 0.257 against 0.25, held-out bias +0.054, and a width
within 5% of its own error. Baseball's constants also measure close; its
problem is the distribution above. Its `homeAdvantage` is the one number worth
a second look — the raw home margin is 0.046 runs against a configured 0.2,
because a home side leading after eight and a half innings does not bat again —
but bias favours 0.1 while Brier and log loss favour 0.3, across a total Brier
range of 0.0013. Nothing is identified well enough to move.

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
- **Home/away splits are computed but deliberately not used** — they feed data
  quality rather than the expected score, and that is a measurement rather than
  a shortcut — thirteen competitions were checked and twelve show no signal to
  use. See "The ground" above.
- **Parameters are calibrated assumptions, not learned.** The home advantages
  and baseline totals come from published long-run averages for each
  competition. Once enough settled predictions exist, the calibration buckets
  are what should drive revising them.
