# Spec — Projection v2

**Status: in progress.** §4.1 and §4.2 have shipped in full, §4.3's archive is
built, filled and read, §4.4 has been run for every competition with settled
data, §4.9 — the distributional fix §4.4 uncovered but could not make — has
shipped, §4.5 has shipped for baseball, and §4.6 has been checked and is
blocked at the provider, and §4.7 has shipped as something other than what it
proposed — the split it named was measured and refused, and the venue effect
underneath it shipped instead. §4.8's provider check has been run — boxing is
blocked at the provider, MMA and tennis both pass — and §4.8.c has shipped for
MMA: fight-winner, calibrated and backtested. Tennis is next. Companion to
[docs/projection-engine.md](../projection-engine.md), which describes v1 as it
exists today, and to the audit that produced this list. Everything below is a
decision, not an option, unless it says otherwise.

---

## 1. What it is, in one sentence

Close the two partial features the audit found, give the reader real player
availability information the model currently has none of, deepen the
evidence behind every sport's calibration with several seasons of history
kept apart from the per-team rating window, recalibrate every sport the way
NCAA Football already was, bring boxing, MMA/UFC and tennis into real
coverage for the first time, and add three bounded new signals to the sports
already modelled — each proven against the backtest harness before it ships,
never assumed.

## 2. What it is not

- **Not a rewrite.** Poisson and Normal, the Elo blend, the simulator, the
  one-leg-per-game correlation rule — all of v1's architecture stays. Every
  phase below is an addition or a recalibration inside it, not a replacement
  of it.
- **Not a longer rating window for an existing team sport.** `historyDays`
  feeds `buildRatings` — the rolling calculation of a team's *current* attack
  and defence rate — and extending that window is exactly the mistake NCAA
  Football's config already made and this project already fixed. Three to
  five years of history (§4.3) lives in a separate archive used for
  calibration and cross-validation. It never feeds a single team's current
  rating. An individual athlete's own rating window, added in §4.8, is a
  different question with a different answer — see the reasoning there.
- **Not point-by-point simulation for tennis, and not style-matchup modelling
  for boxing or MMA.** §4.8 measures these sports the same way every other
  sport here is measured — from completed results — not from a theoretical
  model of how a point is played or a punch is thrown. Going further than
  results-based Elo is a question for evidence gathered after this ships, not
  an assumption built into it.
- **Not player performance props.** Lineups, injuries and news are *status*
  — who is playing, who isn't, what changed. A prop needs *impact* — how many
  points a specific absence is worth — which needs a player's own performance
  history. That data source still does not exist and is not part of this
  spec. §4.2 is deliberately scoped to stop short of it.
- **Not a single cutover.** Eight phases, independently shippable and
  independently revertible. A phase whose backtest doesn't support it does not
  ship, and the rest proceed without it.
- **Not fabrication with better branding.** Every new signal is gated on
  evidence existing for the specific fixture it would apply to. Where it
  doesn't, the fixture is priced exactly as v1 prices it today — never an
  assumed average standing in for missing evidence.

## 3. Decisions already taken

| # | Decision |
|---|---|
| 1 | Phases are ordered by leverage against effort — diagnostics first, then player availability, then long-run history, then recalibration, then new signals, then new sports — as sequenced in §7 |
| 2 | A phase that changes a projection's probability or expected score ships only after `backtest.ts` shows an improvement on the metric it targets — margin MAE, bias, or stated-vs-measured width. "It should help" is not a ship criterion |
| 3 | Any phase that changes `expectedScores()` or a `SportModelConfig` value bumps `MODEL_VERSION`, once per competition, when that competition's change lands — not batched across sports and not bumped for diagnostics- or display-only work |
| 4 | Player availability (§4.2) is a **display feature first**. Its display half ships without a backtest gate, because it changes nothing about a probability. Its model-input half follows the same evidence gate as every other phase |
| 5 | Long-run history (§4.3) is a **separate archive** from the per-team rating window. It never changes `historyDays` or feeds `buildRatings` directly — extending that window is the mistake NCAA Football's config already made and this project already fixed |
| 6 | New sports (§4.8) ship match or fight **winner only** in their first release. Every other market for them is a follow-on increment, built only once winner-level calibration is proven the same way an existing sport's config is |
| 7 | An individual athlete's rating window (§4.8) is sport-specific and multi-year by construction. This is **not** the mistake decisions 5 and §5 warn against — a person's own recent career is still evidence about that same person, unlike a team's roster, which turns over between seasons |
| 8 | A new sport that fails its provider-discovery check (§4.8.a) does not ship, and no substitute data source is assumed in its place |
| 9 | Player performance props stay out of scope for v2 (§9) — this has not changed. Boxing, MMA/UFC and tennis are no longer out of scope; they are §4.8, gated the same as everything else |
| 10 | A phase that finds no measurable improvement for a given sport is not a failure. "Measured, no change warranted" is a legitimate, recorded outcome — the same standard the football rating-pool simplification already documents |

---

## 4. Phases

### 4.1 Diagnostics — accuracy by competition, risk ordering surfaced

**Shipped.** Notes on what the phase actually turned out to be are at the end
of this section.

**Why.** NCAA Football, CFL and the Euro-American competitions all report as
`nfl` in the accuracy breakdown today, because `by_sport` groups on
`record.sport`. `league_id` has been stored on every prediction since the
filtering work, but nothing groups by it. This is precisely the shape of
problem that let NCAA Football's miscalibration hide inside a healthy-looking
number for as long as it did — and nothing currently stops the next one doing
the same.

**How.**

1. `metrics.ts` — add `by_league`, alongside the existing `by_sport`:
   `groupBy(headline, (record) => record.league_id, (id) => findLeague(id)?.label ?? id)`.
   A record with no `league_id` — written before the field existed — groups
   under a `legacy` bucket rather than being silently dropped, the same
   treatment every other optional historical field already gets.
2. `accuracy.ts` — add `by_league: GroupedAccuracy[]` beside `by_sport` in the
   report shape.
3. Interface — a per-competition breakdown, same row shape as the existing
   sport breakdown, sorted by `settled` descending.
4. Surface `risk_ordering`, which `/api/accuracy` already returns and nothing
   currently reads: one line, shown only once `checked: true` — "Low settling
   above Medium above High" when `ordered`, or `message` when not.

**Acceptance.**

- A settled NCAA Football prediction appears under "NCAA Football," not
  "American Football."
- A competition below `MIN_REPORTABLE` shows its count without a rate, the
  same rule as every other accuracy figure in the application.
- The risk-ordering line is absent until `checked: true`.
- `MODEL_VERSION` unchanged — this phase changes what is reported, not what is
  computed.

**What it turned out to be.**

Step 3 above says "the same row shape as the existing sport breakdown." There
was no existing sport breakdown. `/api/accuracy` had been computing `by_sport`,
`by_market`, `by_sport_market`, `by_risk`, `by_model`, `by_confidence`,
`by_data_quality`, the calibration table, the score breakdown, the trend and
the risk-ordering check since the service was written, and **nothing in the
application rendered any of it** — the sole consumer of that endpoint was the
homepage results scroller, reading `section=recent-parlays`. The whole visible
claim about the model's record was one ring on the homepage.

So the acceptance criterion "a settled NCAA Football prediction appears under
NCAA Football" could not be met by adding a grouping. It needed a surface to
appear on. `/accuracy` is that surface, in the primary navigation, and it
renders the competition, sport and risk breakdowns plus the risk-ordering line.
The remaining breakdowns the service already computes — calibration, trend,
market, model version — are still unrendered and are a candidate for a later
increment, not a gap in this one.

Three things were decided in the building that the plan did not anticipate:

- **The bucket for a missing `league_id` is "Unattributed", not "legacy".** The
  spec assumed a missing id meant a record written before the field existed.
  The field is also legitimately absent today on any selection built outside
  the catalogue-aware service, as `types.ts` says in as many words. Labelling
  those "legacy" would be a false claim about a current record, so the bucket
  is named for what is actually known: nothing.
- **`league_id` is now normalised in `store-parse.ts`.** It survived the store
  round trip only because `withDefaults` spreads the raw record — it was never
  validated. Unchecked, a non-string arriving from a hand-edited or corrupt
  file would have become its own row in the breakdown, named after whatever it
  stringified to. It is reduced to `null` and counted as unattributed, the same
  treatment `home_team` and `away_team` already get.
- **The competition id is lower-cased before grouping.** Two casings of one id
  would otherwise split a competition across two rows, each holding half the
  sample and neither reaching `MIN_REPORTABLE` — a competition made
  unreportable by a formatting difference.

The page also carries a **Pending** column that the plan did not call for. It
earns its place: without it a competition with predictions running but none
settled renders as a row of six dashes, which reads as a fault rather than as
"no evidence has arrived here yet."

---

### 4.2 Player availability — lineups, injuries and news

**Why.** The model has never had access to who is actually playing, and says
so today with one blanket line in `qualityReasons()`. Separately, this is
information a reader wants directly — a starting pitcher, an injury report and
recent news about the two sides in front of them, without leaving the game
page to go find it.

This is deliberately **not** player performance props. Status — who is
playing, who isn't — is a fact the provider can supply. *Impact* — how many
points a specific absence is worth — is a number that needs the player's own
performance history, which this phase does not add. Everywhere below, the
model uses availability as a caution or a narrow substitution, never as a
quantified point value it has no basis for.

Two halves, deliberately staged: a display feature that ships on its own
merits, and a model input that follows behind it once the data's actual shape
and coverage are known from having lived with the display half.

#### 4.2.a Display

**Shipped**, with the provider findings below changing several of the steps.
Notes at the end of this subsection.

**How.**

1. **Injuries.** `fetchEspn('<sport>/<league>/teams/<teamId>/injuries')` — the
   same host and pattern as the existing roster call. Normalise ESPN's raw
   status text into a small enum: `out`, `doubtful`, `questionable`,
   `probable`, `day_to_day` — the same discipline `GameStatus` already applies
   to provider-specific fixture statuses. Keep the provider's own short note
   verbatim rather than trying to interpret it further.
2. **Starters.** Two tiers, not one:
   - **Confirmed** — MLB probable pitchers, commonly present directly in the
     scoreboard/summary payload a day or two out.
   - **Likely, from a depth chart** — NFL, NBA, NHL and football generally
     expose only a default ordering, not a live "playing tonight"
     confirmation. Carried with a `confirmed: false` flag and labelled as a
     depth chart in the interface, never presented the way a confirmed
     starter is.

   This mirrors the vocabulary `MarketContext.availability` already uses for
   odds (`verified` vs `model_only`) — the same shape of honesty problem,
   reusing the same solution rather than inventing a new one.
3. **News.** The per-league news pipeline already exists
   (`lib/leagues/news-normalise.ts`, `lib/home/news`) and powers Home today.
   Add per-fixture aggregation — both teams' recent items, surfaced on the
   game page — rather than sending a reader to the league-wide feed. Whether
   ESPN's article payload tags specific athletes is unverified; check one
   live payload before building narrower-than-team filtering. If it isn't
   there, team-level aggregation is still real value and ships without it.
4. **Freshness.** Injury and starter data goes stale fast — a "questionable"
   tag routinely resolves in the hours before kickoff. Timestamp every fetch
   and apply the same discipline `quoteIsFresh` already gives odds: stale data
   is treated as no data, with a shorter TTL the closer the fixture is to
   kickoff, not the flatter curve used for provider history.
5. **Interface.** A section on the game detail page, both teams side by side.
   Coverage will be uneven by league and by fixture, the same way odds
   coverage already is — a missing section says so plainly using the existing
   `Unavailable` / `InlineEmpty` components, never a blank gap.

**Acceptance.**

- A game page for a fixture with injury data shows it, correctly attributed to
  the team it belongs to.
- A depth-chart-derived likely starter is visibly distinguished from a
  confirmed one, in the same way an unverified market already is.
- A fixture the provider has nothing for shows an explicit "not available"
  state, not an empty section that reads as a loading failure.
- No change to any projection's probability, expected score, or
  `MODEL_VERSION` — this half is display only.

**What the provider actually publishes.**

Checked live before building, and four of the five steps above changed as a
result.

| Endpoint | Result |
|---|---|
| `teams/<id>/injuries` (step 1's assumption) | **Dead.** Returns `{}` for NFL, MLB, NBA, NHL and football alike |
| `<league>/injuries` (league-wide) | Works, but the NFL's is **8.9 MB** decompressed — past this application's own 8 MiB response cap |
| `summary?event=<id>` | **Carries the fixture's injury report and, for baseball, the probable starters.** Used |
| `teams/<id>/depthchart` | **Dead.** Returns `{}` |
| Per-league news `categories[]` | Tags `type: "team"` with a team id and `type: "athlete"` with an athlete id — per-fixture filtering is possible |

The decisive finding is the third: `espnGameDetail` **already fetches that
summary** for the header, records and previous meetings. Availability therefore
costs no extra request, no new cache and no new freshness policy — it inherits
the call it rides on, whose TTL is already 60 seconds for a fixture that has
not finished. Step 4 of the plan is satisfied by the existing code rather than
by new code.

Consequences for the plan:

- **Step 2's second tier does not exist.** Depth charts return nothing, so
  there is no "likely starter" to distinguish a confirmed one from. The
  `confirmed: false` flag was therefore *not* built: with one possible value it
  would imply a distinction the data cannot make. Baseball's probable pitcher
  ships carrying the provider's own word, "probable", and nothing is presented
  as a confirmed team sheet.
- **Football has no availability data at all** — verified twice over, once
  through the league-wide endpoint (zero entries for the Premier League, La
  Liga, Serie A, the Bundesliga and the Champions League) and once through the
  fixture summary, which omits the `injuries` key entirely. That absence is
  carried through the contract as `availability: null` and stated on the page,
  because "we cannot say" and "nobody is missing" are different claims. It
  means the display half covers the American sports and not the eight football
  competitions.
- **The enum in step 1 was wrong in both directions.** `out`/`doubtful`/
  `questionable`/`probable`/`day_to_day` misses the injured-list variants
  (7-, 10-, 15- and 60-day IL, IR), suspension and bereavement, and includes
  `probable`, which no league emits. What is emitted is a stable machine enum
  on `type.name`; the free-text `status` beside it is inconsistent between
  leagues — baseball sends `"suspension"`, hockey sends `"Suspension"` — so the
  mapping keys on `type.name` and keeps the provider's wording for display only.
- **A listed player is usually a *playing* player.** 519 of the NFL's 800
  entries are `INJURY_STATUS_ACTIVE`: on the report, expected to play. They are
  kept, with their own quiet status, rather than counted as absences — folding
  them in would overstate every squad's problems.
- **The provider's own placeholder had to be filtered.** `side` and `detail`
  both take the literal `"Not Specified"`, which joined naively reads out as
  "Not Specified Groin — Not Specified". Exactly that one string is dropped,
  established by sampling every injury across the four covered leagues — and
  `"Undisclosed"`, at eighty occurrences, is deliberately **kept**, because it
  is the report genuinely saying the team would not disclose.

**Still outstanding from this subsection.** Step 3, per-fixture news, is not
built. The provider does tag articles by team id, so it is feasible as
specified; it is simply a separate increment from the injury and starter work.

#### 4.2.b Model input

**Shipped in full.** Point 3 cleared its backtest; the measured result is
recorded at the end of this subsection.

**How.**

1. **The blanket caveat becomes conditional.** `qualityReasons()` currently
   states, unconditionally, that no player-availability data exists for any
   competition. Once real data exists for a fixture, this becomes specific —
   "Team X has three players listed out" — and is dropped entirely for a
   fixture with no reported absences. A competition the feed doesn't cover at
   all keeps the original blanket line, since for that fixture it remains
   true.
2. **Reported as a `ProjectionFactor`, not a scored discount.** An absence is
   real information a reader should see, but the model has no basis to size
   its effect without player stats. It is added as a caution factor —
   `subject: { kind: 'uncertainty' }` — visible on the projection, not folded
   into `confidence` or `data_quality` as a number that would overstate what
   is actually known.
3. **MLB starting pitcher — the one case with a real, quantifiable
   substitution.** Where a probable starter is confirmed and has enough
   starts of history, substitute a pitcher-specific runs-allowed rate for the
   team's average defence rate on that side of `expectedScores`, for MLB
   only. This is the single exception to point 2 above, because a pitcher's
   own rate is one number with a defined meaning inside the existing Poisson
   framework — not an estimate of "how much a player is worth" the way a
   general prop would need.

**Gate.**

- The confidence-discount idea (point 2) is deliberately **not** backtested
  for a magnitude, because it doesn't carry one — it is a transparency change,
  not a probability change, and ships once the display half is stable.
- The pitcher substitution (point 3) *is* backtested like every other
  model-facing phase: with and without the substitution, scored only on games
  where a probable starter was actually known ahead of time, since most of a
  season this feature has nothing to substitute and averaging over the whole
  season would dilute the comparison to noise. Ships only if margin or total
  MAE improves on that subset.

**Acceptance.**

- A fixture with no reported absences carries no availability caveat.
- A fixture with a confirmed absence shows a stated factor a reader can read,
  not a silently adjusted number.
- A fixture with no confirmed probable starter is projected identically to
  today — the pitcher substitution is exactly that, a substitution, never a
  new default.
- A pitcher below a minimum-starts threshold gets no rating; the team rate is
  used, unchanged from now.

**What shipped, and what it corrected.**

Point 1's premise was already out of date by the time it was built. The blanket
line did not merely need narrowing — §4.2.a had made it **false**, since injury
data now exists for the American sports and the sentence claimed none existed
for any competition. Three outcomes now, and they are three different claims:
the provider publishes nothing for this competition (the original sentence,
narrowed to where it is true), it publishes a report naming nobody (no caveat
at all), or it lists players (say who, how many, and that the ratings cannot
account for them).

Point 2 shipped as specified: a `kind: 'uncertainty'` factor per side, and
`dataQuality` deliberately does **not** receive the availability. A count
folded into the quality score would be exactly the manufactured point value
this phase exists not to produce.

Two implementation findings worth keeping, both caught by checking live output
rather than by reasoning about it:

- **The two feeds disagree about how coverage is signalled.** The fixture
  summary omits its `injuries` key for an uncovered competition; the
  league-wide feed always sends the key and sends `[]`. Reading the second as
  "nobody is injured" would have told a reader both Premier League squads were
  fully fit. A report with zero teams is therefore read as no report at all —
  the conservative error, since a covered competition never returns zero.
- **The two feeds put the team id in different places** — `block.id` on the
  league feed, `block.team.id` on the summary. The first cut silently matched
  no team at all, which looks exactly like a competition with nobody injured.

One thing changed that §4.2.a had already shipped. The game page originally
read injuries from the fixture summary, which is **capped at five per side**:
for one MLB fixture it showed five where the full report held seven and ten.
Since the projection's caveats are built from the full report and appear on the
same page, the two sat inches apart disagreeing. The page now reads injuries
from the competition-wide report as well, and the summary is kept only for
probable starters, which appear nowhere else.

**Point 3: measured, and shipped.**

The blocking question was whether a pitcher's rate could be built *as at* a
past fixture, since the ERA carried on the scoreboard is season-to-date and
would leak games played after the fixture being scored.

It can. `common/v3/sports/baseball/mlb/athletes/<id>/gamelog` returns a
pitcher's whole season a start at a time — innings, runs, and each game's date
— in one request. The `$ref`-chasing core API path costs about thirty requests
per pitcher and was rejected for it.

Both concerns raised before building it were resolved by the data rather than
by argument:

- **The announced starter is recoverable, and is not the actual starter.** A
  historical scoreboard still carries `probables`, so the backtest uses the
  starter that *was announced*, not the one the boxscore later recorded. Over
  4,226 announced starters, the announced pitcher did start **4,220 times
  (99.9%)** — and the six that did not are what prove the field is the genuine
  announcement rather than the result written back over it.
- **One rate definition serves both paths.** The live model does *not* use the
  free season-to-date ERA. It fetches the same gamelog and calls the same
  `rateBefore`, so the model that ships is the model that was measured.

**The result.** Two runs over 2,121 fixtures of the 2026 season, identical
seed, identical fixture list, differing only in whether the substitution was
supplied. Scored on the 1,795 evaluated fixtures where a rate existed for at
least one starter.

| Metric | Baseline | With pitchers | Paired Δ | t |
|---|---|---|---|---|
| Margin MAE | 3.5908 | 3.5564 | **−0.0344** | **−2.28** |
| Total MAE | 3.6051 | 3.5754 | −0.0297 | −1.43 |
| Brier | 0.2537 | 0.2522 | −0.0015 | −0.74 |
| Accuracy | 0.5331 | 0.5365 | +0.0033 | — |

The gate was margin **or** total MAE improving. Margin does, and is the only
one of the three that separates from noise — the per-fixture paired difference
gives t = −2.28 over 1,795 fixtures, against −1.43 for total and −0.74 for
Brier. Reported plainly rather than as four wins: the effect is real but small,
about 1% of the margin error, and it improved the individual fixture only 915
times out of 1,795. Testing two metrics and shipping on the better of them also
makes a single t of −2.28 weaker evidence than it looks, which is a reason to
treat this as a modest gain rather than a settled one.

**A per-competition `MODEL_VERSION` came out of this**, as decision 3 requires
and as the code could not previously express. `SportModelConfig.modelVersion`
overrides the global constant for one sport, so MLB now stores
`projection-v1-mlb-sp` while every other sport keeps `projection-v1`. A single
global bump would have relabelled every sport's stored predictions as though
all of them had changed, which would make the accuracy breakdown by model
version a false record.

---

### 4.3 Long-run history — three to five years, kept separate from the rating window

**Points 1, 3 and 5 shipped** — the archive exists, is filled, and its first
reader is deep head-to-head. Point 2 (league-constant calibration) belongs to
§4.4 and now has an archive to draw on; point 4 (the regression anchor) remains
the stretch goal it was described as. Notes at the end of this section.

**Why.** More seasons behind a competition means a more stable measurement of
everything that doesn't change week to week — how much a league actually
scores on average, how large a real home edge is, how wide the model's errors
really spread. It also makes a fitted config trustworthy in a way a single
season's backtest cannot: a `homeAdvantage` that holds across four separate
seasons is a different kind of finding than one that happened to fit the
season it was checked against.

**What this is not, and why that distinction is load-bearing.** This is
**not** a longer `historyDays`. That window feeds `buildRatings` — the rolling
calculation of a team's *current* attack and defence rate — and extending it
is exactly the mistake NCAA Football's config already made: a window long
enough to reach into a prior season lets a team with no games yet this year
borrow last year's roster as if nothing had changed, at a data quality high
enough to clear every risk profile. Nothing here touches `historyDays`,
`buildRatings`, or a single team's current rating. Three to five years lives
in a **separate archive**, used only for the three purposes below.

**How.**

1. **A long-run archive, fetched and stored apart from the rating window.**
   The same chunked, 45-day-window fetch already used for everything else,
   walked back three to five years instead of the sport's `historyDays`. A
   per-league feasibility check first: a closed, stable competition — the
   NFL, the Premier League — almost certainly has clean multi-year coverage.
   A league with regular promotion, relegation or conference realignment
   makes "the same league five years ago" a fuzzier claim, and a newer or
   smaller competition (the Euro-American bucket, most obviously) may not
   have five stable years to offer at all. Piloted on the most stable
   competitions first — NFL and one pooled football league — before deciding
   whether, and how far back, to extend the rest.
2. **League-constant calibration and multi-season backtesting.**
   `baselineTotal`, `homeAdvantage` and `scoreSd` are checked for
   season-to-season stability — fit on some seasons, validated on others held
   out, rather than the single split NCAAF's own fit used. This directly
   strengthens §4.4 (Recalibration), which should draw on this archive once
   it exists.
3. **Deep head-to-head, as a free byproduct.** Today's head-to-head signal
   comes from ESPN's `seasonseries` field on the game summary —
   `headToHeadFor()` in `lib/providers/espn/adapter.ts` — meetings within the
   *current season only*, typically one to four games. A genuine multi-year
   head-to-head record needs no new provider call at all: it falls out of
   filtering the archive already being fetched for two specific teams.
   Reported as a `ProjectionFactor` when a real pattern is found —
   informational, not scored, given how thin most pairs' sample sizes still
   are even across five years. The game page's existing head-to-head section
   can show a meeting from before the current season for the first time,
   correctly dated — real reader-facing value on top of the model use.
4. **An experimental long-run regression anchor — gated separately, and
   optional.** Today, a team with few games regresses toward the flat league
   average, identical for every team regardless of whether it is historically
   strong or weak. The archive makes it possible to regress a thin-sample team
   toward *its own* multi-year baseline instead. This is the one genuinely
   new modelling idea in this phase, and the one most likely not to survive a
   backtest — team quality drifts meaningfully over five years, for the same
   reasons rosters change, so an old baseline could easily pull a rating the
   wrong way. Treated as a stretch goal inside this phase, not a committed
   deliverable: built and backtested, shipped only where it measurably beats
   the flat league average it would replace, sport by sport.
5. **Storage — files, one per league per season, not one archive and not a
   database.** A completed season never changes, unlike the "today" window
   the rest of the application already treats as volatile. The process-local,
   in-memory cache everything else uses (`lib/cache.ts`) would mean
   re-fetching the entire archive from scratch on every redeploy — a real,
   avoidable cost at this volume. The fix is the same discipline the
   prediction and watchlist stores already use, shaped to how this data is
   actually read: `DATA_DIR/history/<league>/<season>.json`, one small file
   per completed season, rather than a single growing archive. A calculation
   only ever needs one league's history in memory at a time — exactly what
   `buildRatings` already does for the current rating window — so there is
   never a reason to load the other nineteen leagues' files to answer a
   question about one, and appending a newly-completed season is writing one
   new small file rather than rewriting a large one. Only the in-progress
   season stays in the existing in-memory cache. §4.8's per-athlete archives
   for boxing, MMA and tennis use the same layout and the same reasoning.
   This is the first provider data this application would persist rather
   than treat as ephemeral — a genuine decision, not a foregone one, though
   not a database either; the reasoning is in §10.

**Feasibility check results.** Run in full, 2026-09-10, against the live
provider each competition actually uses — findings below the table. Every
row resolves to one of: **Confirmed** (clean coverage for the full
three-to-five-year window), **Scoped down** (usable, but for fewer years
than the general target — stated how many), or **Excluded** (coverage too
thin, too discontinuous, or wrong to be worth archiving — stated why). No
row was filled in before its check actually ran; a plausible-looking number
written in ahead of that would have been exactly the fabrication this
project exists to avoid.

| Competition | Pool | Status |
|---|---|---|
| NFL | — | **Confirmed** — see findings below |
| NBA | — | **Confirmed** — see findings below |
| MLB | — | **Confirmed** — see findings below |
| NHL | — | **Confirmed** — see findings below |
| NCAA Football | — | **Confirmed** — see findings below |
| CFL | — | **Scoped down** — 2022–2025 confirmed, by a different endpoint than the one currently used; 2021 not recovered; see findings below — this also fixes a live-data bug, not only the archive |
| AFLE | Euro-American | **Excluded, and correctly so** — the competition itself launched this year; there is no earlier season to be missing |
| EFA | Euro-American | **Excluded, and correctly so** — same reason as AFLE |
| Premier League | Football | **Confirmed** — see findings below |
| Championship | Football | **Confirmed** — see findings below |
| League One | Football | **Confirmed** — see findings below |
| UEFA Champions League | Football | **Confirmed** — see findings below |
| UEFA Europa League | Football | **Confirmed** — see findings below |
| UEFA Europa Conference League | Football | **Confirmed** — see findings below |
| La Liga | Football | **Confirmed** — see findings below |
| Bundesliga | Football | **Confirmed** — see findings below |
| Serie A | Football | **Confirmed** — see findings below |

Football's nine competitions rate together (§4.4's rating pool), so the
pool's usable long-run depth is capped by whichever of the nine has the
thinnest coverage, not by the average — the same reasoning already applies
to the pool's *current* rating window. All nine are now checked (findings
below): none is a weak link, so the pool's five-year depth is not capped by
any of them.

**Findings — NFL and Premier League, run 2026-09-10.** Both piloted first, as
point 1 above names them. Same method as production: the app's own 45-day
window split (`splitRange`) and `compactDate` format, against the live
`site.web.api.espn.com` scoreboard endpoint at each competition's registered
`espnPath` (`football/nfl`, `soccer/eng.1`), walking back exactly five years
from today.

- **Premier League — clean.** 1,900 events across the window. Every full
  season-year (2022 through 2025) returned exactly **380** — 20 clubs, 38
  games each, matching the competition's known structure exactly, not
  approximately. Every zero-event window falls precisely in the June–July
  close season. Every request returned 200; no window came anywhere near the
  300-event request cap that would risk the earliest-N-events truncation the
  chunking exists to avoid (the busiest single window returned 88).
- **NFL — clean, with one figure worth explaining rather than leaving
  unexplained.** 1,675 events across the window. Every full season-year
  returned **335**, not the 272-game regular season alone — accounted for by
  the scoreboard endpoint also carrying preseason (≈48 games) and the
  playoffs (13 games): 272 + 48 + 13 = 333, within two of the observed
  figure, close enough to attribute the gap to a boundary game or two rather
  than a real hole. Every zero-event window falls in the documented
  February–July off-season. No failed requests, no window near the cap.
- **The lower 2021 and partial 2026 figures in both leagues** are the
  five-year window's own start and end boundary landing mid-season, not a
  provider gap — the same effect would appear at any fixed cutoff.
- **What this checked, and what it didn't.** This confirms fixture
  *presence* and *volume* at five years' depth, using the exact request
  shape production already uses. It does not yet confirm every returned
  event's score parses cleanly the way `toResults()` needs across the older
  seasons specifically, and it did not test depth beyond five years — neither
  claim is made here. Both are worth a specific check once §4.3 is actually
  built against this data, not assumed from this result.

**Findings — NBA, MLB and NHL, run 2026-09-10.** Same method, with one
methodology correction made before trusting the result: the pilot's
300-event request cap was sized for the NFL and the Premier League, and MLB
alone can carry over 600 events in a single 45-day in-season window — left
at 300, several MLB windows would have silently truncated and read as a
provider gap that was actually the probe's own request parameter. Raised to
1,000 for all three before running; no window in any of the three leagues
came within 40% of that ceiling, so the true per-window volume is now known
rather than assumed.

- **NBA — clean.** 6,992 events across the window. Every full season-year
  returned 1,392–1,403, consistent with 1,230 regular-season games plus
  preseason and playoffs, and stable year to year — no season stands out from
  the others. Zero-event windows fall exactly in the July–September
  off-season.
- **NHL — clean.** 7,650 events across the window. Every full season-year
  returned 1,499–1,607, consistent with 1,312 regular-season games plus
  preseason and playoffs. Zero-event windows fall exactly in the July–August
  off-season.
- **MLB — clean, with one real historical event correctly visible in the
  data rather than hidden by it.** 14,783 events across the window — by far
  the densest of any competition checked so far, as expected from a 162-game
  schedule. Full calendar years 2023–2025 each returned 2,977–2,983 games;
  2022 returned 2,794, a genuine step down rather than noise. That lines up
  with the real 2021–22 MLB lockout, which compressed spring training and
  delayed that season's start — the data is reflecting an actual event, not
  a coverage gap, and is worth reading as a small piece of evidence that this
  feed's history is trustworthy rather than as something to explain away.
  Zero-event windows fall exactly in the November–February off-season.
- **Season-year bucketing needed a per-sport correction.** MLB's season sits
  entirely inside one calendar year (February to November); NBA, NHL, NFL
  and the Premier League all cross a year boundary (roughly October to June
  or August to May). Bucketing MLB with the same Aug-cutoff rule the other
  four correctly use would have misattributed its April games to the
  *previous* year's season. Worth stating plainly since it is exactly the
  kind of per-sport calendar assumption §4.3's per-league feasibility check
  exists to catch before it reaches a config, not after.
- **Same scope note as NFL and the Premier League.** Presence and volume at
  five years' depth are confirmed; score-field cleanliness in the older
  seasons and coverage beyond five years are not, and remain a build-time
  check rather than an assumption carried by this result.

**Findings — the remaining eight football-pool competitions, run
2026-09-10.** Same method, same registered `espnPath` per competition
(`soccer/eng.2`, `soccer/eng.3`, `soccer/uefa.champions`,
`soccer/uefa.europa`, `soccer/uefa.europa.conf`, `soccer/esp.1`,
`soccer/ger.1`, `soccer/ita.1`). All nine football competitions — these
eight plus the Premier League above — are confirmed. No weak link.

- **Championship and League One — clean, matching exactly.** 557 games in
  every full season for both, not the 552 a bare 24-team, 46-game structure
  would suggest — the difference is the promotion play-off (two two-legged
  semi-finals plus a final, five extra games), correctly present. The
  identical figure for both competitions is not a coincidence; they share
  the same 24-team structure and the same play-off format.
- **Promotion and relegation churns the roster, not the fixture history.**
  Point 1's caution about these two leagues was about rating *continuity* —
  a club that bounced between divisions is harder to rate consistently
  across seasons than one that stayed put. It is not a caution about whether
  the fixtures themselves exist, and they do, for whichever twenty-four clubs
  actually made up the division each season.
- **La Liga, Bundesliga and Serie A — clean, matching exactly.** 380 games a
  season for La Liga and Serie A (20 clubs, 38 games), 306 for the
  Bundesliga (18 clubs, 34 games) — the lower figure is the Bundesliga's
  real, smaller division, not a gap. Serie A's 2022 season returned 381, one
  game over the expected count; not investigated further; a single-game
  discrepancy at this volume is well inside normal boundary noise from fixed
  45-day windows meeting a rescheduled fixture, not a coverage question.
- **The Bundesliga's off-season shows up as two separate empty windows,
  and that is real, not a miscount.** Checked directly against the raw
  per-window log: one gap sits over a genuine mid-season winter break
  (2022-12-04 to 2023-01-17) the other three domestic leagues here do not
  observe at this length, and the summer close season is long enough to
  fill two consecutive 45-day windows outright in some years rather than
  one. Both are calendar facts about the competition, not something the
  provider is failing to return.
- **The Champions League and Europa League changed format inside this
  window, and the archive shows exactly where.** Both moved from a
  group-stage structure to a 36-team single league phase for the 2024–25
  season — a real change to the competitions themselves, not a data
  artefact. The Champions League: 125 games a season for 2021–2023 (the old
  32-team, eight-group format), jumping to 189 from 2024–25 onward (the new
  format), with the transition landing precisely at the 2024-08-25 window —
  exactly where the actual reform took effect. The Europa League: 141
  games a season before the change, 189 after, same transition point. A
  config or a backtest that treated all five seasons as one uniform format
  would be quietly averaging two different competitions.
- **The Conference League's early history is the competition's actual early
  history, not a truncated archive.** It did not exist before the 2021–22
  season, and this window starts within days of its actual inaugural
  matches — so a low or partial count at the start of the range would mean
  something different here than it does for every other competition
  checked, where the same shape of number means a mid-season window cutoff.
  In fact the 2021 figure (141) matches 2022 and 2023 exactly, suggesting
  the window catches the competition's first season close to whole; this was
  not verified against the competition's specific opening date, and is
  worth confirming precisely before relying on it, rather than assumed from
  the coincidence of matching numbers. It restructured to a 36-team league
  phase in 2024–25 alongside the other two, landing at 153 games rather than
  189 — a different game count from its two sibling competitions in the new
  format, a real difference worth carrying into any config that treats them
  as comparable.
- **Same scope note as every check above.** Presence and volume at five
  years' depth are confirmed for all nine competitions; score-field
  cleanliness in the older seasons, and depth beyond five years, remain a
  build-time check.

**Findings — NCAA Football, CFL, AFLE and EFA, run 2026-09-10.** The last
four, and the ones point 1 always expected to be the most likely to actually
fail rather than confirm. Three do. This batch needed two different methods:
NCAA Football is ESPN-backed, checked the same way as every competition
above; CFL, AFLE and EFA are served by TheSportsDB, not ESPN — the registry
records `provider: 'thesportsdb'` and `espnPath: null` for all three — which
fetches by whole calendar-year season (`eventsseason.php`), not a date
range, and needed a different probe entirely.

- **NCAA Football — clean.** 4,852 events across the window. Every full
  season-year (2022–2025) returned 958–977, a tight, stable band, unmoved by
  the genuinely major conference realignment that happened inside this exact
  period — which is the correct outcome, since realignment changes which
  conference a team plays in, not whether the team's games get reported.
- **CFL — the endpoint is broken for this league, not the data.** First
  pass found the same thing reported previously: every season from 2021
  through 2026 returned exactly five events via `eventsseason.php`, all
  tagged `round: 500` and clustered in a single week in May, months before
  the real June-to-November season — preseason, not the season, and it read
  as "Excluded." A second pass, specifically investigating the cause,
  overturned that. `eventspastleague.php` — a different endpoint on the same
  provider, no season parameter — returned one real, current, correctly
  scored game (Calgary Stampeders 28, Edmonton Elks 38, 2026-09-07) tagged
  `strSeason: "2026"`: the exact season string the broken call had already
  been asked for and had failed to return. That ruled out a season-format
  mismatch outright — the data exists, tagged exactly as expected, and the
  bulk season endpoint simply isn't finding it. Querying by **round** instead
  of by season — `eventsround.php?id=4405&r=<n>&s=<year>` — confirmed why:
  every round checked across **2022, 2023, 2024 and 2025** returned three to
  five real games apiece (real teams, real scores, correct in-season dates),
  exactly what a nine-team league playing an odd-numbered field each week
  produces. **2021 alone returned nothing by this method either** — not
  independently explained here, though the CFL's actual 2021 season is
  on record as pandemic-disrupted: delayed into August and shortened to
  fourteen games, which may use a different round numbering the same
  request shape does not account for. Worth checking directly if 2021
  specifically turns out to matter; not chased further here. Why the season
  endpoint fails at all — a backend indexing issue specific to this league's
  entry, or a bulk-query restriction the free tier applies to a
  lower-profile league while leaving round-level and single-event lookups
  open — was not determined, and is not asserted as more than an open
  question.
- **Fixed, outside this spec — this was a live bug, not only an archive
  gap.** The production adapter, `lib/providers/thesportsdb/fixtures.ts`,
  called the exact endpoint just shown to be broken for this league, which is
  why `/api/leagues/cfl/games` returned zero games for a date range squarely
  inside the CFL season, matching a `sportsdb_fixtures_loaded … "games":0"`
  log line already seen earlier in this session, before this was being
  investigated. CFL now fetches round by round instead — confirmed live: the
  hub shows Round 15 fixtures still to come and Round 14 results with real
  scores (Calgary 28, Edmonton 38, among others), and `/api/leagues/cfl/games`
  returns real games for the same date range that returned none before. Every
  other competition on this provider is untouched; their season-level calls
  were never the problem. This also means the archive can draw on this
  league from four confirmed seasons rather than excluding it.
- **AFLE and EFA — Excluded, correctly, and for a reason this check could
  not have determined on its own.** Every season from 2021 through 2025
  returned zero events for both; 2026 returned five real-looking fixtures
  each — correctly dated, `status: FT`, genuine club names (Vienna Vikings,
  Berlin Thunder, Frankfurt Galaxy, Munich Ravens and others actually active
  in European American football). Confirmed directly: both competitions
  launched this year. There is no earlier season being missed — the shape of
  the data is exactly what a competition's actual first season looks like,
  not a coverage gap dressed the same way. Nothing here needed the same
  second look CFL did; the single season that exists is real, and there
  is genuinely nothing behind it to find.

**Gate.**

- Points 2 and 3 (calibration and head-to-head) touch no probability by
  themselves — they strengthen evidence and reporting. No backtest gate on
  their own; recalibration that draws on them (§4.4) is still gated exactly as
  §4.4 already specifies.
- Point 4 (the regression anchor) is the one part of this phase that changes
  an expected score, and is gated exactly like every other model-facing
  change in this spec: ships only where a backtest shows it beating the flat
  league-average baseline, per sport, and only for the sports where it does.

**Acceptance.**

- A team's current rating and every existing projection are provably
  unchanged by this phase shipping — same test fixtures, same output —
  unless point 4 specifically ships for that sport and passes its own gate.
- At least one recalibrated competition reports its config's stability across
  multiple held-out seasons, not one.
- The game page's head-to-head section can show a meeting from a season
  before the current one, correctly dated, where the archive has one.
- Every row in the feasibility check results table above carries a real
  finding — Confirmed, Scoped down, or Excluded, each with its reason — not
  "Not yet run," before this phase is considered complete for that
  competition.

---

**What shipped, and what it cost to get right.**

`lib/history/` holds four modules — season boundaries, file store, validation,
and the fill — plus `pnpm history:backfill`. Layout is exactly as point 5
specifies: `DATA_DIR/history/<league>/<season>.json`. The archive is **inert**,
as acceptance criterion 5 requires: nothing reads it, and it is deliberately
not wired into `buildRatings`.

Verified by counting what each competition actually plays, not by trusting that
the fetch succeeded — which is what caught both bugs below:

| Competition | Season | Archived | Expected |
|---|---|---|---|
| Premier League | 2023, 2024, 2025 | 380 each | 380 (20 teams, double round robin) |
| NFL | 2023, 2024, 2025 | 334-335 each | ~335 with preseason and play-offs |
| CFL | 2025 | 81 | 81 (9 teams, 18 games) |

Zero duplicate fixture ids across season files, which is the check that the
window clamping works — TheSportsDB returns whole calendar years, so a football
season spanning two of them would otherwise be counted twice.

The full fill: **21 competitions, 3 seasons each, 31,627 games, 18 MB** — so
the five-season target lands near 30 MB, comfortably inside §10's estimate.
It also reproduces, independently, a fact this document recorded separately:
the Champions League archives 125 games for 2023 and 189 for 2024 and 2025,
which is exactly the 32-team group stage giving way to the 36-team league phase
at 2024-25. Bundesliga 306 (18 teams), Championship and League One 557 (24
teams plus play-offs), La Liga and Serie A 380 — every count matches what the
competition actually plays.

**One thing §4.4 must know before calibrating from this.** The windows are
generous by design, so they include pre-season: MLB archives ~2,979 games where
the regular season is 2,430, and the NFL ~335 against 272. Those are real
fixtures and belong in the archive, but a `baselineTotal` or `homeAdvantage`
fitted without filtering them would be fitted partly on exhibition games.
Filtering is the calibration's job, not the archive's — but it is not optional.

**Two bugs found, both by a number looking wrong rather than by anything
failing.**

- **A season boundary is a fact about a competition, not its sport.** The CFL
  carries `sport: 'nfl'` and so inherited an August-to-February window, which
  clipped its June-to-November season to 27 games where the league plays 81.
  `LEAGUE_BOUNDS` now overrides the sport default for the CFL, AFLE and EFA,
  all of which play summer schedules.
- **An empty result is ambiguous, so it is no longer persisted.** The first
  version wrote empty seasons, reasoning that a competition younger than the
  window genuinely has none — the AFLE and EFA. Then the CFL came back empty
  because the provider rate-limited the fetch, and the archive wrote a file
  asserting a season that was played contained no games. Indistinguishable from
  outside, and only one is safe to be wrong about.

Neither errored. Both files were written faithfully from a wrong question,
which is exactly why the file validation could not have caught them — it can
detect a *damaged* file, never a truthful record of the wrong thing.

**A provider fix fell out of this.** The CFL's round-by-round fetch treated a
rate-limited round as an empty round, so a temporary 429 produced a season with
no games at all. Rate-limited rounds are now retried with backoff, and a round
that still cannot be read raises rather than counting as empty.

**Point 3 shipped, and behaved as predicted.** It needed no new provider call —
only a filter over files that now exist. A Premier League fixture that would
have shown at most the current season's meetings now shows six, from December
2023 to April 2026, correctly dated, with the record tallied above them.

One bug worth recording, because it is the kind that only appears when two
sources meet: the archive stores this application's own fixture id
(`espn-epl-740911`) while the provider's season series returns the bare event
id (`740911`). De-duplicating on the whole string matched nothing, so every
recent meeting rendered twice. The key is now the id's trailing segment.
Deliberately not the date, which would have been the obvious shortcut and would
have collapsed a baseball double-header — two real meetings on one day — into
one.

The record is reported with its sample size and span attached and is never
scored, exactly as point 3 specifies. `headToHeadPattern` states a skew only at
six meetings and a 70% lean, and returns null otherwise, which is the usual
answer.

**Still outstanding in this phase.** Point 2 (league-constant calibration) is
§4.4's work. Point 4 (the long-run regression anchor) remains the stretch goal
it was always described as.

---

### 4.4 Recalibration — fit the other seven configs

**Run for every competition with settled data.** One constant changed, five
competitions confirmed correct as they stand, and one finding that
recalibration cannot address at all. Notes at the end of this section.

**Why.** Every configuration but NCAA Football's is currently marked
`assumed` in `config.ts` — a published long-run average, not anything measured
against this application's own results. The tool that fixed NCAA Football,
`backtest.ts`, is already generic across sports.

**How, per competition** — the exact method the NCAAF section of
`docs/projection-engine.md` already documents, now able to draw on §4.3's
archive for multi-season validation where it has landed for that competition:

1. **Measure** `baselineTotal` directly from completed games. Compare to the
   current constant; a difference of more than a few percent is the same
   nine-point gap NCAAF had.
2. **Fit** `homeAdvantage` to drive residual bias to zero across a held-out
   season — not to match the raw home margin, which the ratings already carry
   most of.
3. **Read `scoreSd` off the residuals**, so the model's stated margin SD
   matches the real spread of its errors. This is the fix that mattered most
   for NCAAF: a model whose stated width is narrower than its real error
   misprices every threshold market, not just the ones that look wrong.
4. **Fit `historyDays`** on coverage against error. The finding that a window
   long enough to reach last season quietly projects from a stale roster
   applies to any competition with real year-over-year turnover — most of the
   college and lower-tier competitions, not necessarily the pro ones.

**Gate.** A change ships for a competition only if its backtest shows the
specific thing it targeted improving on a held-out season — bias toward zero,
margin MAE down, stated width matching measured width. Where §4.3's archive
exists for that competition, "held out" means held-out *seasons*, plural, not
one. A competition whose current values already pass stays as it is, and that
finding is worth a line in the config's comment so the next person doesn't
re-run the same check blind.

**Order.** Pro leagues with the largest settled sample first — NFL, then NBA —
since they validate fastest.

AFLE and EFA do not proceed at all. Both launched this year — there is not
enough settled data behind either to fit against by any method, which is not
a "needs more than four numbers changed" problem but a "there is nothing to
fit yet" one. Revisit once each has a real season or two on record.

CFL was waiting on a fix outside this spec, not on more history — §4.3
traced its thin-looking data to a broken bulk-fetch endpoint for this
specific league, not to an absence of real results, and that fix has since
landed: fixtures now come from a round-level query against the same
provider, confirmed live. CFL can be recalibrated against the actual
competition whenever its turn in the order above comes up, on the same four
confirmed seasons the archive now uses.

**Acceptance, per competition.**

- A backtest result attached to the change, in NCAAF's format: bias
  before/after, margin MAE before/after, stated-vs-measured width.
- `MODEL_VERSION` bumped for that competition's change, independently of the
  others — a reader can tell which prediction used which fit.
- That sport's tests updated to assert measured *properties* — bias near
  zero, width matching error, window shorter than a season where turnover
  applies — not the old constants, the same pattern the NCAAF test suite
  already sets.

---

**Results, run 2026-09-10 against five archived seasons each.**

| Competition | Verdict |
|---|---|
| NBA | **`scoreSd` 12 -> 10.3 shipped.** Stated width was 17% too wide. Everything else correct |
| NFL | Measured, no change warranted |
| NHL | Measured, no change warranted — the best-fitting config in the application |
| Football pool | Measured, no change warranted — stated width within 2% of real error |
| MLB | Constants correct; **the distribution is not.** See below |
| CFL | Deferred: only two seasons recovered, 2024 and 2025 |
| AFLE, EFA | Do not proceed, as this section already states |

**The NBA finding is NCAAF's in mirror image.** NCAAF's stated width was too
*narrow*, so every handicap priced as more certain than the model was.
Basketball's was too *wide* — an implied margin SD of 16.97 against a measured
error spread of 14.36 and 14.68 across the two held-out seasons. At 10.3 the
gap closes to +0.21 and -0.11, with Brier and log loss improving in both
seasons over 2,660 fixtures. Stored under `projection-v1-nba-width`, using the
per-competition version §4.2.b added.

**The NFL is genuinely well calibrated**, which is worth stating because every
value in it was marked `assumed`. `baselineTotal` measured 44.79 against 44,
and moving it changed *nothing at all* — identical bias, error, Brier and
accuracy in both held-out seasons, because for a normal-scoring sport it is
only the prior a thin rating regresses toward. `scoreSd` implies 14.14 against
a measured 14.07. `historyDays` below 300 costs a third of the season.

**The finding recalibration cannot fix: baseball is not Poisson.**

Asked before fitting anything for a Poisson competition, because it asks
something no constant can answer. A Poisson process fixes the variance of a
score at its mean. Measured across five archived seasons:

| Competition | variance / mean | margin SD | Poisson can produce |
|---|---|---|---|
| NHL | 0.99 | 2.62 | 2.49 |
| La Liga | 1.06 | 1.63 | 1.61 |
| Serie A | 1.04 | 1.71 | 1.61 |
| Premier League | 1.10 | 1.90 | 1.71 |
| Bundesliga | 1.15 | 2.02 | 1.78 |
| **MLB** | **2.27** | **4.48** | **3.01** |

Ice hockey and football are Poisson to within a few per cent — a real
validation of v1's model family, and worth recording as such. **Baseball is
not.** Its scores vary more than twice as much as the distribution allows, and
on the held-out seasons the model's implied width came out 34% narrower than
its own error. Every MLB total, run line and team total therefore prices as
more certain than the model is.

This is the NCAAF failure mode again, reached by a third route — but unlike
NCAAF's it is not a constant that is wrong, so §4.4's method could not reach
it. **Now fixed, in §4.9 below.**

Related and smaller: **`scoreSd` is inert for a Poisson sport.** `model.ts`
reads it in the normal branch alone, so MLB, NHL and football carry values that
change nothing. Documented in place rather than removed, so a config keeps one
shape across scoring families.

**MLB's `homeAdvantage` was the one constant worth a second look**, and it
still did not move. The raw home margin is 0.046 runs against a configured 0.2
— a home side leading after eight and a half innings does not bat again, so
baseball wins at home without scoring more. But bias favours 0.1 while Brier
and log loss favour 0.3, across a total Brier range of 0.0013. Nothing is
identified well enough to move, and tuning it against a Brier already distorted
by the dispersion problem would be fitting a symptom.

**Three methodological errors, each of which produced a confident wrong answer
before it was caught.** They are recorded because the same traps apply to the
five competitions still to do:

- **The harness was not measuring the shipped model.** `historyDays` bounds the
  fixtures fetched for `buildRatings` live, but `backtest.ts` handed it every
  prior game in the list. So it measured a model with an unbounded rating
  window, and — worse — made `historyDays` unfittable, because sweeping a value
  nothing read reports "no improvement" at every setting and looks like a
  finding. Fixed before any constant was fitted.
- **`scoreSd` is a per-team SD, not a margin SD.** Each side is sampled
  independently, so the implied margin carries a factor of sqrt 2. Compared
  directly against a measured margin spread, a well-calibrated model looks 40%
  too narrow — the first NFL run duly "found" exactly the NCAAF failure and it
  was an arithmetic error.
- **Coverage and error have to be read together, and fixing one bias created
  the other.** Candidates were first compared on whatever each could project,
  which rewarded short windows for skipping hard fixtures. Restricting every
  candidate to a common fixture set fixed that and hid the opposite problem: a
  120-day NFL window looked competitive on what it managed while projecting
  65% of the season against 99.7%. Judged on the whole season it is worse on
  both counts. §4.4's own wording — "coverage against error" — is both words.

**A fourth trap avoided rather than hit.** Fitting `homeAdvantage` to zero the
residual bias on the fitting seasons pushed the NFL's from 1.8 to 3.6 and made
held-out bias *worse*, 0.45 to 2.19. The bias changes sign between seasons, so
there was nothing stable to fit. This is exactly what §4.4 warns against when
it says not to fit to the raw home margin, one step further on.

**A fourth correction, to this document's own earlier claim.** The NFL notes
first recorded that `baselineTotal` "changed nothing at all" as though that
were evidence the value was right. It is not: `baselineTotal` never enters
`expectedScores`. `leagueAverage` is the *measured* average of the games in the
window, and the constant is only its fallback when there are none — what it
actually reaches is the confidence estimate and the wording of two factors. So
a backtest measuring bias, error and Brier cannot see it, and the measurement
is the evidence rather than the unchanged metrics. Corrected in the configs and
in `docs/projection-engine.md`.

**Still to do.** Only the CFL, once its archive is deeper — two seasons are
recovered, 2024 and 2025, and the rest are still returning empty against the
provider's rate limit rather than being genuinely absent.

---

### 4.9 Overdispersed scoring — the fix §4.4 could not reach

**Shipped.** Added as its own phase because §4.4 fits constants and this
changes a distribution, which is a different kind of change and deserved a
different gate.

**Why.** §4.4 measured baseball at a variance-to-mean ratio of 2.27 where a
Poisson process fixes it at 1. No constant could widen the simulation to match,
because a Poisson draw takes its variance from its mean.

**How.** `scoreDispersion` on `SportModelConfig`. Above 1 the rate is drawn
from a Gamma before the count is drawn from a Poisson — a negative binomial —
giving variance `dispersion * mean` while leaving the mean untouched. At or
below 1 it returns plain Poisson bit-for-bit, so a competition that measured
Poisson is unchanged down to the individual simulation, and none of them set
it.

**The value was fitted, not taken from the measurement.** The observed 2.27
mixes the spread of a single fixture with the variation in expected score
between fixtures, and the model already reproduces the second through its own
varying expectations — so plugging the raw ratio in would double-count. Swept
and measured instead, landing at 2.3. That it comes out near the raw figure is
a fact about baseball, whose teams sit close together in quality, not a
justification for having assumed it.

**Result**, held out on 2024 and 2025 separately, 4,956 fixtures:

| | width gap | Brier | log loss | margin MAE | accuracy |
|---|---|---|---|---|---|
| 2024 before | -1.41 | 0.2499 | 0.6936 | 3.454 | 54.9% |
| 2024 after | **+0.13** | **0.2464** | **0.6858** | 3.455 | 54.9% |
| 2025 before | -1.56 | 0.2476 | 0.6888 | 3.482 | 55.7% |
| 2025 after | **-0.03** | **0.2442** | **0.6813** | 3.482 | 55.8% |

Both seasons improve, consistently, at roughly three times the size of the NBA
width correction. Margin error and accuracy are unchanged to three decimals in
both — the signature a width-only change must have. Had they moved, the fix
would have been altering the projection rather than its stated uncertainty.

Stored under `projection-v1-mlb-sp-disp`, a new stamp rather than a reuse of
the pitcher fit's: two unrelated changes to one competition cannot share a
version, or a stored prediction cannot say which it was made under.

**Cost.** About 3x the sampling time per draw, which is roughly 1ms to 3ms per
MLB projection at ten thousand simulations. Measured, not assumed.

---

### 4.5 Weather

**Shipped for MLB, on temperature rather than wind.** Notes at the end of this
section; the data rejected two of the three variables this phase named.

**Why.** A total-runs projection for an outdoor MLB game in wind gusting
toward the outfield is priced identically to a dome game today. The
application has no way to know the difference, and currently doesn't try.

**How.**

1. Check whether the provider already returns venue coordinates before
   building anything to supply them. If not, a static lookup table — finite
   per league, built once, not fetched per fixture.
2. Fetch from Open-Meteo: free, keyless, forecast and historical both, in
   keeping with the project's standing rule against committing secrets to
   compose files.
3. A dome/indoor flag per venue, mostly static, suppresses the feature
   entirely for that fixture.
4. The modifier: a small, bounded adjustment inside `expectedScores`, the
   same shape as the existing `shortRestPenalty` — conditional, capped,
   sport-specific. Wind affects MLB total runs; wind and precipitation affect
   NFL and football scoring efficiency. Neither applies to NBA or NHL, which
   are always indoors.
5. Recorded as a `ProjectionFactor` whenever it fires, so a reader sees why a
   total moved — the same transparency every existing input already gets.

**Gate.** Backtest with and without the modifier over a season of outdoor
games only; ships if total MAE improves for that subset specifically. A wrong
wind adjustment is worse than none — it invents confidence about something
the model previously and correctly admitted it didn't know.

**Acceptance.**

- Indoor and dome fixtures are provably unaffected — identical projection with
  the feature on or off.
- A fixture where the modifier fired shows it among `factors` or
  `quality_reasons`.
- A provider timeout or missing coordinates degrades to no adjustment, never
  a stale or fabricated one.

**What the data said, before anything was built.**

Step 1 asked whether the provider already returns venue coordinates. It does
not — venue carries name, city, country, a `grass` flag and an `indoor` flag,
but no latitude or longitude. Cities are geocoded through Open-Meteo instead
and cached for a month, which is ample: a ground and its city share their
weather, and the effect below was measured at exactly that precision.

Step 3's dome flag needed no static table — the provider sends `indoor` on
every venue. But it is a property of the **ground, not the night**: every
retractable-roof park reports covered on every date sampled, so the provider is
classifying grounds that *can* close rather than nights they did. Conservative
in the right direction; such fixtures simply get no adjustment.

**Two of the three proposed variables do not exist in the data.** Measured
across 3,645 open-air fixtures:

| variable | r | t | verdict |
|---|---|---|---|
| temperature | +0.084 | +5.08 | real |
| wind speed | -0.022 | -1.33 | nothing |
| precipitation | -0.023 | -1.41 | nothing |

This section named wind for MLB. Wind speed alone cannot work, and on
reflection obviously so: without a direction relative to the outfield, a gust
blowing in cancels one blowing out. Doing it properly needs a per-ground
outfield bearing, which this phase did not anticipate and did not build.
Precipitation fails for a simpler reason — baseball does not play through
meaningful rain, it waits.

Temperature survived every confound that could have explained it away: +0.061
within a month, +0.078 within a venue, +0.063 within both at once. So it is
neither the calendar nor a park effect.

**The slope is 0.045 runs per degree, not the measured 0.0596.** The
confound-controlled relationship is about three quarters of the raw one, and
fitting the raw slope would bank a correlation partly owned by the month. It
also holds up better on the held-out seasons — t = -2.65 against -2.29, for a
total MAE within a thousandth of the raw slope's.

**Gate, met.** Total MAE on outdoor fixtures only, 3,638 held out: 3.5945 to
3.5803, paired t = -2.65. Roofed fixtures identical to four decimal places on
every metric across 2,764 of them, which is the first acceptance criterion
proven rather than asserted. Margin MAE and accuracy unchanged, as an
evenly-split total adjustment must leave them.

**One honest gap.** The backtest used the weather that actually happened; live
projections use a forecast. Forecasts are wrong sometimes, so the live benefit
will be smaller than the measured one. The direction is not in doubt; the
size is optimistic.

**Not done:** NFL and football. This section proposed wind and precipitation
for them, and the same measurement should be run before anything is built —
the baseball result is a warning that a plausible variable can measure at
nothing.

---

### 4.6 F1 reliability

**Checked, and blocked.** The contingent step below was run on 2026-09-10 and
the field is genuinely absent, so this phase stops exactly where it says it
should. Evidence at the end of the section.

**Contingent phase.** Before any modeling work: pull one live race payload
and check whether the provider carries a status, classified, or retired field
the normaliser currently discards. `race-model.ts` states plainly today that
no such field is read — this step checks whether that's because the feed
lacks it, or because nothing has looked. If the field genuinely isn't there,
this phase stops here and stays blocked; no failure rate gets invented in its
place.

**How, only if the field exists.**

1. `toRaceResults` (or a sibling) also records whether each entrant finished.
2. `DriverRating` gains a `reliability` rate — finishes over starts across the
   history window, regressed toward the field average the same way `strength`
   already is, gated at the existing `minRaces`.
3. In simulation, a DNF is rolled against a driver's own reliability before
   the position draw. A DNF removes them from that simulated race's order and
   every other position shifts up.

**Acceptance.**

- A driver with a poor reliability record has visibly lower podium and points
  probabilities than a driver of comparable `strength` with a clean one, in a
  case built for the test.
- `RACE_MODEL_VERSION` bumps independently of the main `MODEL_VERSION`, the
  same separation the race model already keeps.

**The check, run 2026-09-10. Three avenues, all dead.**

- **The scoreboard's competitor object** carries `id`, `uid`, `type`, `order`,
  `winner`, `athlete` and `statistics` — and `statistics` is an empty array on
  every session, the race included. There is no status, classified or retired
  field to have been discarded.
- **Absence from the classified order does not stand in for one.** This looked
  briefly promising: the 2025 Spanish Grand Prix lists twenty cars in
  qualifying and nineteen in the race. But across seven races that season, six
  had identical qualifying and race fields — and a sport that retires two or
  three cars in a typical Grand Prix would differ far more often than one race
  in seven. The classified list plainly includes the retirements, ordered at
  the back with nothing to mark them.
- **The core API has no competitors resource for a race competition at all**
  (404). Its `/statistics` is a category descriptor carrying no per-driver
  values, and its `/status` is the session's clock and period rather than any
  driver's classification.

So the field is absent rather than merely unread — which is what this section
required the check to establish, and the answer it named a stop for. Nothing is
modelled and no failure rate is invented. `race-model.ts` already stated this
limitation; it now states it as verified, with the date and the three avenues,
so the next person does not re-run the same check blind.

**What would unblock it.** A provider that publishes a per-driver race status,
or lap counts from which a retirement can be inferred. Neither is available on
the feed this application uses, and no substitute source is assumed in its
place — the same rule §4.8 applies to a new sport that fails its discovery
check.

---

### 4.7 Home/away splits into the expected score

**Refused as proposed, and shipped as the effect underneath it.** The blend
this section specifies was measured across thirteen competitions before being
built, and there is nothing there to blend. Baseball's split turned out to be
real and to belong to the ballpark rather than the team, and that is what
shipped. Evidence at the end of the section.

**Why.** `TeamRating.homeAttack` / `awayAttack` are computed today but, per
the model's own documentation, only feed `data_quality`. The venue effect the
model actually prices is one flat `homeAdvantage` constant, identical for
every team in a sport.

**How.** Blend a venue-specific rate into `expectedScores`:

```
venueAttack = leagueAverage + (splitRate − overallRate) × splitTrust
```

`splitTrust` uses a stricter curve than the general `targetGames` trust
weighting — roughly double the games required, since a home or away split is
built from half a team's sample for the same signal a full-season rate gets
from all of it.

**Gate — the double-counting risk.** This cannot be fit in isolation from
`homeAdvantage`. If the split starts capturing what the flat constant already
captures, the model prices the same effect twice — precisely the trap the
NCAAF Elo-margin fit called out explicitly. Backtest with the split active
*and* `homeAdvantage` refit together, in the same change, for each sport;
ships only where combined bias stays flat and margin MAE does not regress.
Recalibration (§4.4) should land first for any sport this touches, since it
refits the same constant.

**Acceptance.**

- No sport ships this without an accompanying `homeAdvantage` refit committed
  in the same change.
- A team below the (stricter) split-trust minimum behaves identically to
  today — the split contributes nothing until it has enough to say something.

**The measurement, run 2026-09-10, and what it refused.**

The premise was tested before the blend was written. Under the null that every
club in a competition shares one league-wide split, the spread of observed team
splits is entirely sampling error — and that error is computable from per-game
scoring variance and games played. Anything beyond it is real between-team
variance, and the ratio is the reliability, which *is* the `splitTrust` this
section asks for. Measured over 1,443 team-seasons:

| | mean split | observed SD | noise SD | reliability | odd/even | season to season |
|---|---|---|---|---|---|---|
| NFL | 2.20 | 4.17 | 4.37 | 0 | — | -0.08 |
| NHL | 0.24 | 0.35 | 0.36 | 0 | -0.12 (t=-1.48) | +0.09 (t=1.03) |
| EPL | 0.27 | 0.37 | 0.39 | 0 | -0.05 (t=-0.42) | +0.24 (t=1.97) |
| NCAAF | 6.34 | 6.52 | 7.21 | 0 | — | +0.14 (t=0.90) |
| WNBA | 2.62 | 5.04 | 5.13 | 0 | — | +0.17 (t=0.80) |
| La Liga | 0.36 | 0.359 | 0.356 | 0.02 | +0.08 (t=0.65) | +0.08 (t=0.65) |
| Bundesliga | 0.36 | 0.44 | 0.43 | 0.06 | -0.08 (t=-0.50) | +0.08 (t=0.62) |
| Serie A | 0.18 | 0.37 | 0.36 | 0.06 | -0.03 (t=-0.27) | -0.14 (t=-1.10) |
| League One | 0.27 | 0.354 | 0.333 | 0.12 | +0.03 (t=0.33) | +0.06 (t=0.49) |
| NBA | 2.10 | 2.81 | 2.60 | 0.14 | +0.07 (t=0.90) | +0.08 (t=0.91) |
| Championship | 0.29 | 0.360 | 0.326 | 0.18 | +0.14 (t=1.48) | +0.08 (t=0.67) |
| **MLB** | 0.03 | 0.76 | 0.59 | **0.40** | **+0.32 (t=4.13)** | **+0.32 (t=3.64)** |

In twelve of the thirteen the observed spread sits at or below what noise alone
produces, and **not one direct test of persistence reaches significance outside
baseball**. There is no split to blend, and a `splitTrust` curve — however
strict — would have been weighting sampling error.

**Baseball's split is the ballpark, not the team.** Two measurements separate
those, and they agree. A club's home *scoring* split and its home *conceding*
split move together at r = +0.275: a genuine home advantage would push them
apart, since a side playing better at home should also concede less there,
whereas a ground that helps hitters helps both sides equally. And the same
ground repeats the following season at r = +0.426, which a property of a roster
would not. The ordering the archive produced is baseball's known one — Coors
Field two runs clear at the top, T-Mobile Park at the bottom — which is a check
on the measurement rather than a claim made for it.

**And the model was not missing a venue effect — it was mis-carrying a rating.**
This is the part that changed what got built. A club's scoring rate is built
from every game it plays, half at its own ground, so a club at an extreme park
carries a rate too low for its home fixtures and too high for its away ones.
The two errors mirror each other at **r = -0.947**: Colorado ran 1.39 runs
light at Coors and 1.23 heavy on the road, Seattle the same in reverse, and
each pair sums to roughly zero. A `venueAttack` term applied to the home side —
which is what this section specifies — would have corrected one half and left
the other untouched, *and* would have moved the margin, when the measurement
says the effect is on the total and falls on both sides equally.

So what shipped is a difference between two carried biases, split evenly:
`clamp((factor[home] - factor[away]) * weight, -cap, cap)`. Fitted as two free
weights the terms came out nearly equal and opposite (+0.20 and -0.25), the
signature a mirrored error must have.

**Gate, met.** Forward-chained — every fixture corrected using only seasons
before its own — over 7,483 held-out fixtures across 2023-2025:

| | before | after |
|---|---|---|
| total MAE | 3.5793 | **3.5681** (paired t **-3.09**) |
| per-ground bias, RMS over 32 grounds | 0.3773 | **0.2943** |
| Coors Field bias | -1.406 | **-0.678** |
| T-Mobile Park bias | +0.710 | **+0.386** |
| margin MAE | 3.4675 | 3.4680 |
| Brier | 0.2457 | 0.2457 |

**This section's stated double-counting risk did not arise, and no
`homeAdvantage` refit was needed.** The acceptance criterion above requires one
because the proposed blend would have competed with the flat constant for the
same effect. What shipped does not: it is a *total* adjustment that preserves
the margin exactly — verified analytically, the margin moved on zero of 7,483
fixtures — while `homeAdvantage` is a *margin* constant that leaves the total
untouched. The two are orthogonal by construction, which is why the criterion
is recorded as inapplicable rather than quietly skipped.

**Baseball only.** Basketball and ice hockey went through the identical
forward-chained test and both came out *worse* — paired t of +0.47 and +0.94,
error moving the wrong way, and their free-weight fits incoherent for a park
mechanism (both terms the same sign for the NHL). Neither carries a `parks`
block.

**Two methodological notes, in the spirit of §4.4's.**

- **Leave-one-season-out lends a later season to an earlier one.** A first pass
  fitted each season's factors from the other four and reported t = -3.64. Park
  factors are stable across years so the leakage is mild, but it is leakage.
  Forward-chaining — factors from strictly earlier seasons only — is what a
  live projection actually has, and it reported t = -2.55 at the same weight.
  The stricter number is the one this shipped on.
- **The harness scores a *simulated* mean, and that costs power.**
  `projection.expected_total` is the mean of the simulated draws, carrying
  sampling noise of about 4.4/sqrt(simulations) runs — roughly 0.09 at the
  default 2,500, which is the same order as the adjustment being measured. It
  does not bias the comparison, but it inflates the paired variance, and an
  early run of this gate read t = -1.93 for that reason alone. `projectGame`
  returns the analytic `expected` beside the distribution; scoring that is the
  noise-free limit of the same measurement, and re-running the simulated path
  at 12,000 draws agreed with it.

**One choice worth stating.** The weight ships at **0.25**, not the 0.30 that
minimises error. The curve is flat from 0.25 to 0.35; 0.25 gives the same error
to three ten-thousandths of a run, a slightly better per-ground bias, and a
materially firmer result (t = -3.09 against -2.67). Where a curve is flat, the
better-established point on it is the one to stand on.

**Not done: a park-neutral rating.** This corrects the *symptom* — the model's
expected total — while the ratings themselves still carry the blend. Neutralising
each result by its ground before the rates are built would fix the cause, and
would also improve the team rates that feed everything else rather than the
total alone. It is a larger change than this phase warranted and it is not
assumed to be an improvement; it would need its own measurement.

---

### 4.8 New sports — boxing, MMA/UFC and tennis

**Why.** All three are entirely absent from the model today. `tennis` exists
as a placeholder in `SportId` with nothing behind it; boxing and MMA/UFC do
not exist in the type system at all. All three also share a shape none of the
existing sports have: **an individual athlete, not a team, and a discrete
win/loss/draw outcome, not a continuous score.** This is the largest single
addition in this spec — two new model families, new selection types threaded
through every exhaustive switch in the projection layer, and coverage that is
entirely unverified against the provider. It is sequenced last for exactly
that reason: it should draw on §4.3's long-run archive, which these sports
need more than any existing one does, and it should follow the recalibration
work rather than compete with it for the same evidence-gathering discipline
while that discipline is still being proven across more sports.

#### 4.8.a Shared groundwork

**Why shared.** Tennis, boxing and MMA are three different sports, but they
fail the existing architecture in the same two ways: no team, and no score.
Rather than bolt each onto the two-sided scoring model, they get their own
lane — the same decision racing already made, and for the same reason. A
Grand Prix "has a field rather than two sides"; a fight or a match has two
sides but no score. Neither is a special case of the team model; both are
different objects.

**How.**

1. **New `ConcreteSportId` members**: `boxing`, `mma`, `tennis`. Because every
   switch on `ConcreteSportId` in the codebase is exhaustive by design —
   `lib/sports/hubs.ts`'s terminology map among them — adding these forces a
   compile error at every place that needs a real decision for the new
   sports, rather than a silent fallback. That is the safety net working as
   intended, not friction to route around.
2. **Catalogue and hub terminology.** New entries in the league catalogue
   (`lib/leagues/registry.ts`) per promotion/tour — UFC and, separately, the
   major boxing sanctioning context if the provider distinguishes them; ATP
   and WTA for tennis, since they are separately ranked. None of the existing
   hub vocabularies fit: there is no "Standings" table for tennis the way a
   league has one — ATP/WTA rankings are a rolling 52-week points system, a
   different kind of object — and no "Transactions" concept for an individual
   athlete. Each gets its own terminology, the same way football already gets
   "Fixtures"/"Clubs"/"Table" instead of the American sports' words.
3. **Provider discovery, per sport, before committing to any of it.** Whether
   ESPN's public site API carries boxing schedules and results at all is
   unverified, and MMA/UFC coverage, while more likely to exist given ESPN's
   public MMA vertical, is equally unconfirmed against this codebase's
   provider client. Tennis fixtures for ATP/WTA are unverified for the same
   reason already stated in the original audit. Check each independently.
   A sport that fails this check does not proceed past this point, and no
   substitute source is assumed in its place.
4. **Ratings are Elo-only — no scoring-rate half.** Every existing sport model
   pairs an Elo correction with an attack/defence rate computed from goals or
   points. None of these three sports has a repeated scoring process a rate
   can be built from — a fight or a match is a single discrete outcome, not
   an accumulation of scoring events. The rating is therefore closer to
   `eloUpdate` / `eloExpectation` in `math.ts` alone, walked forward
   chronologically from results exactly as team Elo already is, with no
   `expectedScores`-style rate model behind it. This makes the individual
   model *simpler* than the team model in one specific respect, and different
   in kind rather than a stripped-down copy of it.
5. **The rating window is measured in years, by construction, and this is not
   the NCAAF mistake.** §4.3 and §5 are emphatic that the per-team rating
   window never gets extended, because a longer window lets a team borrow a
   roster that is no longer the team being projected. That reasoning does not
   transfer here: a boxer's or tennis player's last several fights or matches
   over two or three years are still evidence about the same specific human
   being. A UFC fighter typically has ten to twenty professional fights in a
   whole career; a window of a few hundred days would contain one or two of
   them, nowhere near enough to say anything. These three sports' rating
   window is therefore sport-specific, multi-year, and justified on its own
   terms — the individual does not turn over the way a roster does.
6. **A large fraction of any card will not clear the data-quality floor, and
   that is correct, not a bug.** A prospect with two professional fights, a
   qualifier making a tour debut — the honest answer is "insufficient data,"
   the same standard applied everywhere else in this application. Expect
   `MIN_DATA_QUALITY` to exclude noticeably more of a card here than it does
   for an established league, and do not lower the floor to compensate.
7. **Winner only, first — for all three sports.** Every sport-specific market
   below (method of victory, total games, rounds) is a follow-on increment,
   built and backtested only after match/fight-winner has its own calibration
   proven the same way every team sport's config is proven. This is the same
   staged discipline decision 10 in §3 already states for existing sports,
   applied to a first release rather than a later refit.
8. **Weight class and surface are scoping dimensions, not adjustments.** A
   boxer or MMA fighter's rating is built from results *at their current
   division*, the same way football's rating pool scopes competitions rather
   than blending everything into one number. A fighter who has changed weight
   class is a caution factor, not a blended rating across divisions. Tennis
   ratings carry a surface-specific component alongside the overall rating,
   since hard, clay and grass performance genuinely differ — closer in shape
   to the home/away split idea in §4.7 than to anything else already built.
   **Which is now a warning rather than a precedent.** That split was measured
   before it was built and carried no signal in twelve of thirteen
   competitions: the spread of observed team splits sat at or below what
   sampling noise alone produces. "Hard, clay and grass performance genuinely
   differ" is exactly the kind of claim that sounds obviously true and has to
   be measured anyway, and the reliability calculation §4.7 used — observed
   spread against the spread sampling error alone would produce — is the test
   to run on a surface split before a line of it is written. A
   surface-specific component ships only if that test says there is something
   to weight, and then only if a backtest agrees.

**Gate.** Nothing in this subsection ships on its own — it is the shared
scaffolding §4.8.b and §4.8.c are built on. The first thing that ships is
match/fight-winner for whichever of the three sports passes its provider
check first, backtested exactly like every team sport's config.

**The provider check, run 2026-09-10. Boxing fails; MMA and tennis pass.**

Step 3 above says a sport that fails this check does not proceed and no
substitute source is assumed in its place. That is now load-bearing for one of
the three.

**Boxing is absent from the provider.** Every path shape this codebase uses was
tried: `boxing/scoreboard`, `boxing/news`, `boxing/teams`, `mma/boxing/...`,
`combat/boxing/...` and the core API's `sports/boxing` all return 404 or 400.
The one endpoint that answers at all — `common/v3/sports/boxing/athletes` —
returns a literal empty object, two bytes, where the identical
`common/v3/sports/mma/athletes` returns fifteen kilobytes of real fighters.
That contrast is the evidence: the endpoint *shape* exists for boxing and the
sport behind it does not. **§4.8.c therefore ships for MMA only**, and boxing
stays blocked until a provider carries it. Nothing about boxing is modelled,
and no alternative source is assumed.

**MMA passes comprehensively.** `mma/ufc/scoreboard` accepts the same
`dates=YYYYMMDD-YYYYMMDD` range the team sports use, and returns roughly 570
fights a year consistently from 2019 through 2025 — about four thousand
contests, which is what an Elo needs. Each card is an event whose
`competitions` are the individual fights, and each fight carries:

| | |
|---|---|
| two athletes | `competitors[].id`, with `uid` of the form `s:3301~a:<id>` |
| who won | `competitors[].winner`, a boolean |
| a date | on the competition, not only the card |
| weight class | `type.abbreviation`, e.g. "Lightweight", "W Strawweight" |
| scheduled rounds | `format.regulation.periods` — 3 or 5 |
| career record | `competitors[].records[].summary`, e.g. "13-6-0" |

**Fighter ids are stable**, which had to be checked rather than assumed: a
rating keyed on a per-fixture competitor id would silently reset every contest.
Across 168 fighters appearing in two months of cards, **not one carried more
than a single id**.

**Method of victory is only partly there, and this constrains §4.8.c.**
`status.type.detail` is the bare string "Final" on every completed fight. What
*is* recoverable: `linescores` holds the judges' scorecards and is present for a
decision and null for a finish, and `status.period` / `displayClock` give the
round and time a fight ended. So **decision versus finish is derivable, and so
is `goes_the_distance`** — but **KO/TKO cannot be told from submission**, which
is the one distinction §4.8.c's `method_of_victory` names as the real
difference between the two sports. That market is therefore reduced to what the
data supports, or deferred; it is not invented from a field that does not
exist. Round-betting is answerable — the round is there — but is a follow-on to
winner either way.

**Tennis passes, and corrects two assumptions in this section.**

- **ATP and WTA are not separate feeds.** Step 2 above proposes a catalogue
  entry each "since they are separately ranked". They are, but the provider
  does not split them: `tennis/atp/scoreboard` and `tennis/wta/scoreboard`
  return *the same tournaments* and the same five groupings —
  `mens-singles`, `womens-singles`, `mens-doubles`, `womens-doubles`,
  `mixed-doubles`. The separation that actually exists is per match, on
  `type.slug`. One tennis feed, split downstream.
- **There is no surface in the feed.** Step 8 proposes a surface-specific
  rating component, and the §4.7 note attached to it says to measure before
  building. It does not get that far: the tournament carries `venue:
  {displayName: "Brisbane, Australia"}` and nothing else — no `surface` field,
  no clay/grass/hard anywhere in the payload. **A surface component cannot be
  built from this provider at all**, measured or not, and is dropped rather
  than approximated from a tournament's name or its place in the calendar.

Structure otherwise holds: an event is a *tournament*, its `groupings` hold the
matches, and a completed match carries two competitors with `winner`,
per-set `linescores`, a `round`, and a human-readable `notes` result string.
Singles and doubles are cleanly separable — a singles competitor has `athlete`,
a doubles competitor has `roster` with an `athletes` array — so a doubles pair
never enters an individual rating. Volume is ample at roughly ten thousand
matches a year.

**Order of build.** Both surviving sports pass, so the tie is broken on
structure: **MMA first.** Its fights are a flat list on a card rather than
nested inside tournament groupings, its weight class is present for the scoping
step 8 requires, and its athlete ids are verified stable. Tennis follows.

---

#### 4.8.b Tennis

**Model.** Match-outcome probability comes directly from the Elo difference
via the win-expectation formula already used for every other sport
(`eloExpectation`). Sets, and by extension the match, are simulated the same
way every other sport already is — a seeded random draw, thousands of
trials, every market read off the same simulated set of matches — except the
per-trial generative step draws a *set winner* from a win probability derived
from the rating gap, rather than drawing two scores. This is the existing
simulation architecture (`simulate()` in `model.ts`) with a new per-trial
model behind it, not a new pipeline.

Point-by-point serve modelling — the more detailed approach real tennis
models sometimes use — is deliberately not the starting point. This
application has never modelled a sport from anything but completed results,
and a match-outcome Elo is the same discipline applied here: measured from
what actually happened, not simulated up from serve percentages this
application has no source for. If match-level calibration later shows real
value in going further, that is a v3 question with its own evidence, not a
v2 assumption.

**Selections, in order of what actually gets built.**

| Market | When |
|---|---|
| Match winner | First release |
| Total games (over/under) | Once winner is calibrated |
| Set betting / correct score in sets | Deferred — needs the simulation validated at the set level first, not only the match level |

**Known gap, stated rather than modelled.** Mid-match retirement is a real
outcome this model does not represent — the same category of gap as an F1
DNF, and handled the same way at settlement: a retirement voids the
prediction rather than being scored as a loss for the player who stopped,
exactly as a cancelled or postponed game already voids elsewhere in this
application.

**Acceptance.**

- Match winner backtested with the same rigor as a team sport's config: bias,
  Brier score, calibration bands, before anything else ships.
- A player below the sport's minimum-matches threshold produces no
  projection, not a low-confidence one.
- A retired match settles as void, never as a loss.

---

#### 4.8.c Boxing and MMA/UFC — one model family, two configs

**MMA only. Boxing is blocked at the provider** — see the check recorded at the
end of §4.8.a. The "two configs" framing below is kept as written because it is
still the right shape the day a boxing source exists, but nothing boxing-shaped
is being built now, and the shared-family argument is currently carrying one
member.

**Why together.** Structurally the same problem as NFL and NBA sharing the
Normal-scoring family with different constants: two competitions, one
underlying model, real per-sport differences expressed as configuration
rather than as separate builds.

**What genuinely differs, and is not just a constant.** MMA has a submission
method of victory; boxing does not. Boxing fighters typically carry
substantially longer records — several dozen professional fights is not
unusual — where a UFC roster fighter more often has ten to twenty across a
whole career, so the sample-size floor before a rating means anything will
bind harder for MMA than for boxing. Round counts differ (boxing's scheduled
distance varies by sanctioning body and title status; MMA is three rounds
outside main events, five inside them). Each of these is a configuration
difference inside one shared model, the same way `baselineTotal` differs
between the NFL and the NBA without being a different kind of model.

**New selection types**, threaded through every place a `SettlementRule`
switch already exists exhaustively — `probabilityFor` in `project.ts`,
`satisfiedBy` in `correlation.ts`, `backingFor` in `factors.ts`, and
settlement's own evidence-and-outcome pair — the same four places
`finish_position` and `head_to_head` already had to be added for racing:

- `method_of_victory` — KO/TKO, submission (MMA only), decision, draw
- `goes_the_distance` — yes/no, does the fight reach the final bell

Round-betting (which round a fight ends in) is only buildable if the provider
actually carries round-level finish data, not only a win/loss/method summary
— a discovery question, not an assumption, resolved before it is added to
the list above.

**A no-contest voids, exactly as a cancelled game already does.** Boxing's
historical "no decision" and MMA's "no contest" outcomes are the same
category as a postponed or cancelled fixture elsewhere in this application:
the contest happened, but nothing about who was better was actually settled,
so it counts toward neither side.

**Stated, not modelled.** Style matchup (striker versus grappler, southpaw
versus orthodox), reach and stance are real, widely discussed factors in both
sports with no clean proxy in a win/loss/method record. Left unmodelled and
said so, the same way weight cuts, judging variance and referee stoppage
timing are — real sources of outcome uncertainty this model does not and
should not claim to capture from results alone.

**Acceptance.**

- Fight winner backtested per sport before either ships, same rigor as every
  team sport's config.
- A fighter who has changed weight class carries a stated caution factor
  rather than a rating blended silently across divisions.
- A no-contest or no-decision settles as void.
- MMA's `method_of_victory` includes submission; boxing's does not — enforced
  by the type, not by convention.

---

## 5. Cross-cutting rules

Apply to every phase above, not only the ones that restate them.

- **Never ship on judgment.** Every phase that changes a probability or
  expected score is gated on a stated backtest result. "This should help" is
  not evidence — NCAAF's own fit found the intuitive answer for
  `homeAdvantage` (the raw home margin) was wrong, and the correct one was
  found by checking, not by reasoning better.
- **More history is not automatically better.** Depth is used to calibrate
  constants and to compound evidence across seasons (§4.3) — never to widen a
  *team's* current rating window, which stays exactly as calibrated per
  sport. An individual athlete is the deliberate exception (§4.8): a person's
  own career is still evidence about that person, which is not true of a
  roster. Confusing team and individual here would be its own mistake, in
  the opposite direction.
- **Never invent a signal for a fixture that lacks it.** No confirmed starter,
  no weather data, too little home/away history — the fixture is projected
  exactly as v1 projects it today. Degrade to existing behaviour, never to an
  assumed average standing in for the gap.
- **Status is not impact.** Knowing a player is out is not knowing what their
  absence is worth. §4.2 uses availability as a caution a reader can see, and
  once — for MLB pitchers — as a substitution with a real, defined number
  behind it. It is never used to manufacture a point value the model has no
  basis for.
- **Every new input that fires is a stated `ProjectionFactor`.** A hidden
  input a reader cannot see is functionally the fabrication this project
  exists to avoid, one step removed.
- **`MODEL_VERSION` changes are attributable.** A bump for one competition's
  fit is never reused for a later, unrelated change to the same competition.
- **A phase that regresses its own backtest does not ship**, however good the
  reasoning was going in.

## 6. Display features are not exempt from honesty, even without a backtest gate

§4.2.a changes no probability, so it skips the backtest gate — but it still
answers to the same standing rules as everything else in this application:
never present an unconfirmed depth-chart guess as a confirmed lineup, never
leave a missing section looking like a loading failure, never attribute a
piece of news or an injury note to the wrong side of the fixture. A display
feature that misleads is not a smaller version of fabrication; it is the same
failure in a place that happens not to touch a number.

## 7. Sequencing

| Order | Phase | Why here |
|---|---|---|
| 1 | §4.1 Diagnostics | Cheapest. Prevents the next miscalibration from hiding the way NCAAF's did |
| 2 | §4.2 Player availability | Highest reader-facing value; display half ships without a backtest gate; independent of everything below |
| 3 | §4.3 Long-run history | Strengthens the evidence behind recalibration before it happens; the archive is inert on its own, so it carries no regression risk while it beds in |
| 4 | §4.4 Recalibration | The harness already exists and is proven; best chance of finding another real problem; benefits directly from §4.3 landing first |
| 5 | §4.5 Weather | Free, keyless source; a bounded, well-precedented integration point |
| 6 | §4.6 F1 reliability | Contingent — costs one API check to find out whether it's even possible |
| 7 | §4.7 Home/away splits | Highest double-counting risk on this list; wants §4.4 already landed for the sports it touches. **Outcome:** the risk never arose, because the proposed blend was measured and refused — what shipped is a total-only venue correction, orthogonal to `homeAdvantage` by construction |
| 8 | §4.8 New sports | Largest and riskiest single addition — new model families, new type-system surface, coverage entirely unverified. Wants §4.3's archive already proven, and the existing recalibration methodology already validated across more sports, before extending it to three structurally different ones |

## 8. Acceptance criteria for v2 as a whole

1. Every phase that ships has a backtest result recorded in its commit or in
   `docs/projection-engine.md`, in NCAAF's format — except §4.2.a, which is
   display-only and records what it displays and for which competitions
   instead.
2. No sport's projection is degraded relative to v1 by its own backtest. A
   phase that doesn't clear this for a given sport does not ship for that
   sport, even where it ships for others.
3. `by_league` accuracy (§4.1) is live before any recalibration phase ships,
   so each fitted competition's before/after is visible on its own rather
   than blended into a sport-level number.
4. Every new signal — availability, weather, pitcher, venue split, reliability
   — is inert on any fixture lacking the evidence it needs, provably
   identical to v1's output for that fixture.
5. The long-run archive (§4.3) changes no existing projection on its own —
   only its explicitly gated, optional regression-anchor experiment can, and
   only where it has separately passed a backtest.
6. Boxing, MMA/UFC and tennis each ship match- or fight-winner only first,
   with the same backtest rigor — bias, Brier, calibration — as an existing
   sport's config, before any sport-specific market is added for them.
7. `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass after each
   phase, not only once at the end.
8. A recalibrated sport's tests assert properties, not the old constants — a
   future refit should not have to rewrite its own tests to land.

## 9. Deliberately out of scope

- **Player performance props.** §4.2 adds *status* — who is playing. A prop
  needs *impact* — how much a specific absence is worth — which needs the
  player's own performance history. No such feed exists anywhere in the
  provider layer, confirmed directly against the roster endpoint, which
  carries name, jersey, position, height, weight and age and nothing else.
  Needs its own spec once a stats source, and its cost, is decided.
- **Point-by-point tennis simulation, and style/reach/stance modelling for
  boxing and MMA.** §4.8 measures all three from completed results, the same
  discipline applied everywhere else in this application. Going further than
  a results-based rating is a question for evidence gathered after §4.8
  ships, not an assumption built into it.
- **Round betting for boxing and MMA**, unless the provider is confirmed to
  carry round-level finish data. Not assumed; checked in §4.8.a.
- **Which promotions and sanctioning bodies §4.8 actually covers.** Left open
  — see §10.
- **xG, EPA, pace, advanced ratings.** Not derivable from final scores. The
  realistic sources are either scraping-adjacent, against the project's
  existing rule, or paid. Lowest value against cost of anything considered for
  this version.
- **Precisely quantified injury impact.** Deliberately stopped short of in
  §4.2 for the reason stated there — this is the same blocked problem as
  player props, restated.
- **A unified "injury adjustment" across every sport.** Different sports need
  genuinely different signals and different confidence discounts; one flag
  covering all of them would hide that they are not the same problem.

## 10. Open decisions

### Paid data

Every phase in this spec uses a source that is free or already integrated.
Player performance props, and to a lesser extent xG/EPA, are the two places
where the honest options are "find a free source" or "pay for one." This spec
takes no position on that trade — it is a cost decision, not an engineering
one — and both stay out of scope until it is made either way.

### Persisting the long-run archive: files, not a database

§4.3 recommends writing the completed-season portion of the multi-year
archive to `DATA_DIR`, one small file per league per season, rather than
accepting a full re-fetch from the provider on every redeploy under the
existing in-memory cache. This is the first provider data this application
would persist rather than treat as ephemeral — a real, if narrow,
architecture change — and it is worth being precise about why a file is
still the right answer at this volume rather than the point a real database
becomes necessary.

**The volume.** Five years across every currently tracked league — team
sports, plus tennis, boxing and MMA once §4.8 lands — is roughly
100,000–150,000 completed events, each a small flat record: teams or
competitors, a date, a result. Generously padded, that is on the order of
50–150 MB in total, and a single league's own history is a small fraction of
that. Small enough that a whole league's file loads into memory without
anyone noticing.

**Why that volume doesn't call for a database.** A database earns its
complexity by solving problems this workload doesn't have. There is exactly
one writer — a background refresh, once a season completes — so there is no
concurrent-write problem a transaction would protect against. The access
pattern is "load one league's history, compute in memory," never an ad hoc
query reaching across leagues or seasons; even the one cross-cutting lookup
this archive supports, deep head-to-head, is just filtering two teams out of
a file already loaded, not a join. And the application deploys as a single
container, so there is no second instance needing to share this state over
a network.

**What would change this answer.** Multiple app instances needing shared
state, or a genuine need to query across the whole archive in ways that stop
fitting "one league's file, loaded on demand" — neither is true today, and
neither is implied by anything else in this spec. If either becomes true
later, SQLite is the natural middle step: still just a file, no server
process to run, but indexed — worth knowing it exists, not worth reaching
for now.

Stated as a recommendation, not a decision already made; confirm before §4.3
begins.

### Which promotions and sanctioning bodies

§4.8 does not decide whether "MMA" means UFC alone or also other major
promotions, or which boxing sanctioning bodies' rankings and results count.
Both are genuine scope questions — they change what a boxing or MMA hub even
represents — and are left open pending the provider-discovery step in
§4.8.a, which will also say what is actually available to decide between.

## 11. Documentation

Update `CHANGELOG.md` under Unreleased as each phase ships, not batched at the
end. `docs/projection-engine.md` gains a dated entry per recalibrated
competition, in the NCAAF section's exact format: measured, fitted, and the
actual before/after numbers; a new section describing what §4.2 actually
covers per competition once it ships, since coverage will be uneven and that
unevenness should be stated the same way the odds layer's is; and an update
to "Loading history" describing the two-tier model — the per-team rating
window, unchanged, and the separate long-run archive, so the distinction is
as visible in the docs as it is in §2 and §3 above. §4.8 gets its own docs,
the same way racing has `docs/f1.md` rather than being folded into the main
projection-engine document: `docs/tennis.md` and `docs/combat-sports.md`,
each stating plainly what is modelled, what is deliberately not, and — once
the provider-discovery step runs — exactly what that provider actually
supplies for that sport. This spec's status line moves from **draft** to
**built** phase by phase, since v2 is explicitly not a single cutover.
