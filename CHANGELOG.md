# Changelog

What has been added, changed, fixed and removed in Parlay Projector.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Entries describe what changed *for someone using the application*, not which
files moved — the git history already records that.

**Unreleased** collects work that is merged but not yet deployed to TrueNAS.
When an image is published, move those entries under a dated heading.

Categories, used consistently:

| | |
| --- | --- |
| **Added** | A capability that did not exist before |
| **Changed** | Existing behaviour that now works differently |
| **Fixed** | Something that was broken and now is not |
| **Removed** | A capability deliberately taken away |

---

## Unreleased

The Parlays redesign, a results scroller on Home, Formula 1 as a full sport,
sport and competition filtering for parlays, and a design system that makes the
whole application readable on a phone and a tablet, a fix for CFL fixtures that
had been silently empty, an Accuracy page that finally shows how the model
scores per competition, and injury and starting-pitcher information on the game
page, projections that now say who is missing instead of claiming nobody knows,
MLB projections that account for who is pitching, and a long-run history
archive that survives redeploys. 815 tests.

### Added

**A long-run history archive — several years per competition, kept on disk**

- `pnpm history:backfill` walks each competition back through its recent
  completed seasons and stores them under
  `DATA_DIR/history/<league>/<season>.json`. It survives redeploys, which the
  existing in-memory cache does not, so several years of fixtures are fetched
  once rather than on every restart.
- **It changes no projection.** It is deliberately not wired into team ratings
  and must not be: a rating window long enough to reach into last season lets a
  team with no games yet borrow last year's roster, which is the exact mistake
  NCAA Football's config already made. This is for calibrating league constants
  and answering questions about seasons, not about current form.
- **An empty season is never written.** The first version recorded them, on the
  reasoning that a competition younger than the window really has no fixtures.
  Then the CFL came back empty because the provider rate-limited the request,
  and the archive stored a file asserting that a season which was actually
  played contained no games. Those two cases look identical from outside and
  only one is safe to be wrong about, so neither is stored now.

### Fixed

**The CFL's history was being cut in half by the NFL's calendar**

- Season boundaries were taken from the sport, and the CFL is filed under
  American football — so it inherited an August-to-February window and lost its
  June and July fixtures. A season the league plays 81 games of archived as 27.
- Nothing errored. The file was written faithfully from the wrong question,
  which is why it was caught by the count looking wrong rather than by any
  check. The CFL, and the two European competitions that also play summer
  schedules, now have their own windows.

**A rate-limited request could empty a competition's schedule**

- When the provider returned "too many requests" while fetching the CFL round
  by round, each refused round was counted as a round with no games — so a
  temporary limit produced what looked like a competition that played nothing.
- Rate-limited requests are now retried with a pause between attempts, and a
  round that still cannot be read stops the season instead of quietly reporting
  it as empty.

### Changed

**MLB projections account for the announced starting pitcher**

- A baseball fixture's projected score now uses the **announced starter's own
  runs-allowed rate** in place of part of that side's team defence rate. It is
  the only place in this application where one player changes a projected
  scoreline, and it is deliberately confined to the one sport where a single
  participant pitches most of a side's innings.
- It is a blend, not a swap. A starter covering six of nine innings carries two
  thirds of the weight and the team rate covers the rest, because this
  application has no bullpen rate and will not invent one.
- **Measured before shipping, on 1,795 fixtures across the 2026 season**: the
  same games, the same seed, differing only in whether the pitcher was
  supplied. Margin error fell from 3.591 to 3.556 and total error from 3.605 to
  3.575. The margin improvement is the one that separates from noise; the
  others move the right way but could be chance, and that is stated in the spec
  rather than rounded up into four wins.
- The effect is **small** — about 1% of the margin error, improving the
  individual fixture 915 times out of 1,795. It is not a transformation and is
  not described as one.
- Nothing is hidden. Where a starter moves the projection, the projection says
  so by name, with the pitcher's rate and how many starts stand behind it.
- A fixture with **no announced starter**, or one with fewer than five starts
  on record, is projected exactly as before — the substitution is a
  substitution, never a new default.
- MLB predictions are now stamped `projection-v1-mlb-sp`; every other sport
  keeps `projection-v1`, so the accuracy breakdown by model version stays a
  truthful record of what actually changed.

### Fixed

**Projections claimed no injury data existed, hours after it started existing**

- Every projection carried the line *"No lineup, injury or player-availability
  data exists for any competition here."* Shipping the injury report made that
  **untrue** for the NFL, MLB, NBA and NHL, and a standing caveat that is
  simply wrong is worse than no caveat.
- A projection now says one of three things, because they are three different
  claims: nothing is published **for this competition** (still true of
  football), a report exists and **names nobody** (no caveat at all — inventing
  one to fill the space is the habit this application avoids), or it lists
  players, in which case it says how many are out on each side.
- The same news appears as a stated factor on the projection. It changes **no
  number**: not the probability, not the expected score, not the confidence or
  data-quality scores. Counting absences into a quality figure would be
  precisely the manufactured value this is meant to avoid — the model knows who
  is missing, not what they are worth.
- The game page and the projection also disagreed about how many players were
  out, because the page read a **five-per-side** summary while the projection
  read the full report — 5 against 7 and 10 on one MLB fixture, shown inches
  apart. Both now read the same complete report.

### Added

**Who is playing — injuries and probable starters on the game page**

- Game pages now show each side's **injury report**: who is out, who is
  doubtful, what is wrong and when the provider expects them back. Baseball
  fixtures also name each team's **probable starting pitcher**.
- This costs **no extra requests**. The application already downloaded this
  exact payload for the header, records and previous meetings — the injury
  report was sitting in it, unread.
- The page keeps three states apart that are easy to blur and misleading to
  confuse. *No data published for this competition* names the competition and
  says the gap is the source's. *Nobody reported missing* is stated as the real
  finding it is. *Players listed* shows them, worst news first.
- **Football has no injury data at all** — not an empty list, but nothing
  published, checked against five competitions directly. Those fixtures say so
  explicitly rather than showing a blank panel that reads as a failed load.
- A player listed but **expected to play** is shown as exactly that, not as an
  absence. In the NFL that is most of the report — 519 of 800 entries — so
  counting them as absences would have overstated every squad's problems.
- Nothing here changes any projection. This is information for the reader to
  weigh; the model does not yet use it, because knowing a player is out is not
  the same as knowing what their absence is worth.

**Accuracy, per competition — a page for how the model actually scores**

- The application computed a per-sport breakdown, a market breakdown, a
  calibration table, a risk-ordering check and a settled-accuracy trend, and
  **displayed none of them**. Everything a reader could see about the model's
  record was a single percentage on the homepage. All of it is now at
  **/accuracy**.
- The headline addition is **accuracy by competition**, which a sport-level
  figure cannot give. Five competitions — the NFL, NCAA Football, the CFL, the
  American Football League Europe and the European Football Alliance — all
  report under one sport id, so all five were averaged into a single number.
  That is precisely how NCAA Football's miscalibration hid inside a
  healthy-looking figure until it was fitted its own model. Each competition is
  now checkable on its own.
- A rate is still withheld below 20 settled predictions, per competition as
  everywhere else — the row shows its counts instead. **Brier score and the
  probability the model claimed are shown at every sample size**, because both
  mean something where a percentage does not: a row where "claimed" sits well
  above "accuracy" is overconfidence, visible immediately.
- Predictions carrying no competition id are counted under **Unattributed**
  rather than dropped, so the totals still add up. They are not labelled
  "legacy": as well as records written before the field existed, a prediction
  built outside the catalogue-aware path has never carried one either, and
  calling those historical would be untrue.
- The **risk-ordering check** appears here for the first time. It is shown only
  once there is enough settled history to have genuinely run — "not enough data
  to say" and "checked, and fine" are different claims, and the page does not
  let the second stand in for the first.
- Reachable from the primary navigation, and from the homepage accuracy panel —
  which is the route on a phone, where the bottom bar has no room for a seventh
  tab.

**A design system, and readable text**

- The interface had grown fifty-three different shades of white across about
  seven hundred usages — twenty-seven of them for text alone. Text now comes
  from a **five-step ramp**, and **every step of it passes WCAG AA** against
  the page background.
- This was not a tidying exercise. The most-used text colour in the
  application measured **2.35:1** where the standard asks 4.5:1, and it was
  carrying the game status, the venue and the kick-off time on every card.
  Measured on Home before the change: **104 elements failed**. After: none.
- The smallest text was 9px. The floor is now **11px**.
- Documented in [docs/design-system.md](docs/design-system.md), together with
  the breakpoints, the shared components and what each replaced.

**More than one bet on the same match**

- **Bets per match** on Slips, taking 1, 2 or 3. One keeps the long-standing
  rule — a leg per match, legs independent. Above one, a match can contribute
  several bets.
- The arithmetic changes with it, and honestly: legs from one match are
  **counted** against that match's simulated games, and only then multiplied
  between matches. Multiplying throughout would understate a match whose legs
  reinforce each other; counting throughout is impossible, since two matches
  share no simulations. Live, three matches at two bets each came out at 17.0%
  counted against 16.1% multiplied.
- Legs are taken round-robin — the best from each match, then the second best —
  so four legs across three matches is 2-1-1, never 3-1. Loading a line onto
  one fixture would concentrate it where correlation is strongest.
- A line where no match ends up doubled is still reported as an ordinary
  multi-game line, and its correlation is not described as measured, because it
  was not.

**Two more markets the model could already see**

- **Both teams to score**, in football and the other low-scoring sports where
  being kept out is a real possibility. Withheld in basketball and American
  football, where both sides score in every simulated game and the market would
  be a certainty dressed as a prediction. Both directions are offered — backing
  "No" is an opinion that one side gets shut out, not the absence of one.
- The probability is counted across paired simulations rather than multiplied,
  so a one-sided rout and a clean sheet arriving together is priced in rather
  than assumed away. It carries no line, so it can never push.
- **Team totals now offer the under side.** Only the over was ever generated,
  which meant the model could say a team would score but never that it would be
  kept quiet — an opinion it held and had no way to express.

**Slips — build a line from matches you choose**

- A new page at `/slips`. Add matches with the `+` beside the watchlist star on
  Home, Schedule, Live or any game page, pick a risk level, and the projection
  engine builds the strongest line it can from exactly those. You choose the
  matches, the model chooses what to back on each, and the risk level decides
  what qualifies at all.
- **Risk levels genuinely change the line, not just its label.** The same three
  matches gave three legs at 56.6% on Low, three legs at 41.5% on Medium with
  entirely different markets, and two legs at 42.5% on High — because one of
  them had nothing in the high band.
- Picks are **stored on the server**, so the slip is the same on your phone and
  your laptop and survives a redeploy.
- Split into **Active** and **Settled**. Only Active matches can produce a leg.
  A settled pick is kept for the rest of the day it finished and then cleared —
  the prediction it produced stays in the accuracy history permanently, so
  nothing is lost.
- **Nothing is padded and nothing is substituted.** A pick that offers nothing
  at your risk level is left out and says so, along with the fact that a lower
  level would include it. A pick that has kicked off is reported as no longer
  projectable rather than silently dropped.
- Generated lines count toward Prediction Accuracy, recorded as hand-picked so
  a curated line can later be measured apart from one the optimiser assembled.
- Documented in [docs/slip.md](docs/slip.md), specified in
  [docs/specs/slip.md](docs/specs/slip.md).

**Bookmaker prices, and the distinction they make possible**

- Market prices are read from the sports feed the application already calls —
  no new provider, no credentials. Prices appear in decimal, fractional and
  American notation.
- Every selection now says whether a bookmaker is genuinely offering it.
  **Verified** names the book and the time the price was read; **Model
  projection — availability not verified** means the line came from our own
  simulations and nobody has confirmed it exists.
- Where prices exist, the model is run against **the book's actual lines**,
  both sides of every market, rather than lines the model chose for itself.
- Implied probability, the bookmaker's margin, the margin-free "fair"
  probability, and the gap between that and the model's own view.

**Plain English on every selection**

- *What needs to happen* is generated for every market from its settlement
  rule, so it can never contradict how the result is actually judged.
  "Houston must win, or lose by exactly one run. A defeat by two or more loses
  this selection."
- Probabilities are named for what they measure — win, cover, over/under,
  finish, head-to-head — rather than all being "estimated probability".
- A glossary: any betting term can be tapped for a short definition.
- Markets carry the name the sport uses: Run Line, Puck Line, Goal Handicap,
  Match Result.

**Same-game parlays and a bet builder**

- Several selections from one fixture, with the combined chance **counted
  across the shared simulations** rather than multiplied. Both figures are
  shown so the difference correlation makes is visible.
- A market explorer on each game page, grouped the way a betting interface
  groups them, with the model's own ranking at the top.
- Selections can be combined by hand and evaluated live.

**Recent parlay results on Home**

- The accuracy figure now cycles through the last ten settled lines: risk
  level, verdict, every leg with its final score, and a sentence each on what
  went right and wrong.
- Summaries are deterministic, derived from the settlement rule and the real
  scoreline. No generated prose.
- Rotates every 7 seconds, pauses on hover and focus, and stops sliding under
  `prefers-reduced-motion`.

**Formula 1**

- A first-class sport: sidebar, filters, Home, Schedule, Live and its own hub.
- Full season calendar with every session — practice, sprint, qualifying,
  race — each with its own start time and status.
- Finishing order, driver standings and constructor standings.
- A **finishing-order projection model**, separate from the scoring model:
  drivers rated from where they have actually finished, the race simulated
  10,000 times, giving race-winner, podium, top-five, points and head-to-head
  probabilities.
- Race legs combine with other sports in generated lines, one leg per race.
- Settlement against the classified finishing order, including the rule that a
  retirement loses rather than voids.
- Documented in [docs/f1.md](docs/f1.md).

**Finding a game on the Live scoreboard**

- **The sport row is now the sports the application tracks**, always all of
  them, each showing how many of its games are live. It used to be built from
  whatever happened to be in play, so a quiet morning offered a single "All"
  button and gave no hint that six other sports were followed at all.
- **A search box**, matching the same fields the Schedule searches: team names,
  a race and its drivers, the competition and the venue.
- **A competition filter built from what is actually on**, split into the
  competitions this application follows and the ones it does not. The
  scoreboard's provider answers with every live game in a sport worldwide — on
  a normal afternoon that is Chilean, Salvadoran and Venezuelan football — so a
  **Tracked competitions** option gets you from the firehose to the
  twenty-one competitions the rest of the application is about.
- Counts answer "what would I get if I picked this instead": they follow the
  search box but not the sport already chosen, so the row does not collapse to
  zeroes the moment anything is selected.
- **Sports Active** now reads `2/6` rather than `2` — two of the six sports
  actually tracked, rather than a number with nothing to measure it against.
- An empty board says which of three things happened: nothing on anywhere,
  nothing on in the chosen sport, or a search that found nothing. Only the last
  is something a reader can act on, and it now offers a way back.

**Choosing what a parlay is built from**

- A **competition selector** on the Parlays page, alongside the sport. Pick
  Football and then the Premier League, or every football competition; pick
  Formula 1 and get Formula 1. Only the competitions belonging to the chosen
  sport are ever offered.
- **Your choice is binding.** A five-leg request in a competition where three
  matches qualify returns three legs and says so. It never reaches into another
  competition — or another sport — for a fourth, however much better that
  selection scores.
- **Selection counts that cannot be produced are greyed out** before you pick
  one, with the reason: one leg per fixture means three eligible matches cannot
  make a four-leg line. The number of eligible events and model-backed
  selections for the current choice is shown under the buttons.
- The generated line states which sport and competition produced it, and each
  leg names both.
- An empty result names what was filtered to, and suggests what to widen —
  without widening it for you.
- Settled lines on the Home scroller now show which competition they came from.

**Elsewhere**

- Accuracy is broken down by sport crossed with market type, so the model can
  eventually be steered toward what it reads well.
- Published lines record the sport, competition and leg count they were built
  under, and each prediction records its competition id. Groundwork for success
  rates read per competition rather than only across everything at once.
- A dev-server launch config on a pinned port.
- Documented in [docs/parlay-filters.md](docs/parlay-filters.md).

### Changed

- **The Parlays page has been rebuilt.** A leg now separates the bet from the
  prediction: selection, market, availability, probability, price and what has
  to happen, with the model's internals behind one tap. A five-leg line is a
  screen or two on a phone rather than five.
- **Evidence is oriented per selection.** A fact records what it says and about
  whom, and each selection decides whether that supports it, argues against it,
  or is merely context — so the same fact is correctly a reason on one leg and
  a caution on another.
- **Risk levels explain themselves**, from the legs actually chosen. The
  category is derived from the selections and never reaches back to change a
  probability.
- **Projected scores name the teams** and show a scoreline a game could
  actually finish on, alongside the average it came from.
- **Data quality states why it is not higher**, rather than showing a bare
  rating.
- The domain now supports events contested by a field rather than two sides.
  A race carries its entrants, session and name; `home_team` and `away_team`
  are absent rather than invented.
- Standings rank people as well as clubs, and motorsport tables show
  championship points.
- Predictions store both team names, so a settled leg can read "Arsenal 2–1
  Chelsea" instead of a bare score.
- Bookmaker prices are fetched four competitions at a time rather than one
  after another.
- The Parlays sport list now comes from the league registry instead of being
  held on the page. It had drifted: six sports, with neither tennis nor
  Formula 1, months after both were added. A competition added to the registry
  now appears in the selector on its own.
- The selection count is a row of buttons rather than a dropdown, so a count
  that cannot be produced can say so before it is chosen.
- Tennis is listed and disabled with the reason — no competition is tracked for
  it yet — rather than being absent from a page it belongs on.

### Fixed

**The CFL had no fixtures — the schedule, the hub, and every prediction
downstream saw an empty season**

- Found while checking whether the projection engine's next round of work
  could lean on several years of history: the request the application makes
  for CFL fixtures returned the same five games for every season from 2021
  to 2026, all of them preseason, all from a single week in May — months
  before the CFL's real June-to-November season. The league id and the
  season label were both right; the provider's bulk season endpoint simply
  was not returning what was otherwise there for this competition.
- Confirmed the data was real and reachable: a different call on the same
  provider, asked one round at a time rather than one season at a time,
  returned the actual season — real teams, real scores, correct dates —
  for every year checked back to 2022.
- CFL fixtures are now assembled round by round rather than trusted to the
  broken bulk call. Every other competition on this provider is unaffected;
  their season-level calls were never the problem.
- 2021 is not recovered by this fix and is not claimed to be — that season
  is on record as delayed and shortened, and may use a round numbering this
  fix does not reach.

**The Schedule lost every fixture's status on a tablet**

- The fixture table appeared from 768px, but its columns need about 910px. It
  was therefore rendered into a container too narrow to hold it — and because
  the page suppresses horizontal scrolling, it was **clipped rather than
  scrolled**. Measured on an 805px viewport: the row needed 906px in a 747px
  box, which put Broadcast half off-screen and Status and the watch control
  entirely past the edge.
- The table now waits until there is room for it, and the width it vacated
  gets a **two-column card layout**, which suits a tablet better than a table
  did.

**Prediction accuracy read as broken when it was working**

- The widget showed `--%` beside "12 settled", which looks like a fault: there
  is plainly history, so where is the number? A rate is deliberately withheld
  below twenty settled predictions, because a percentage from a dozen results
  has a margin of error wide enough to cover almost any claim.
- It now says so — "12 of 20 settled needed for a rate" — so the empty state
  reads as the deliberate decision it is. The threshold itself has not changed.

**Controls too small, and too close together, to tap**

- The watch and slip buttons were 32px squares whose centres sat 40px apart.
  Their hit areas are now **44px**, and spaced exactly 44px apart so they abut
  without overlapping. The visible buttons are unchanged.

**Other**

- The primary navigation had **no keyboard focus indicator at all** — the one
  component on every page. It has one now, and so does every other control:
  forty hand-written rings at two different opacities became a single class.
- Team crests reserve their box before loading, so a list no longer reflows as
  the provider's CDN answers, and a badge that 404s leaves the team's initials
  rather than a broken-image icon.
- "View schedule" on Home looked like a link and did nothing. It is a link.
- Loading skeletons ignored `prefers-reduced-motion`. One rule now covers the
  whole application.

- **NCAA Football was being projected with the NFL's model, and it showed.** It
  was the only competition dragging the accuracy figure down: 14 correct from
  25 against a model claiming 84%, with the projected margin out by 21 points a
  game, while MLB, the Premier League, La Liga, Serie A and League One were all
  calibrated. Fitted against 2,021 completed games across two seasons, replayed
  so no projection could see its own result:
  - Mean total 44 to **53.6** — measured. The NFL's baseline centred every
    college scoreline nine points low.
  - Home advantage 1.8 to **4** — fitted, taking the season-long bias from
    +2.85 to −0.28. Deliberately not the raw 9.3-point home margin, which the
    team ratings already carry most of.
  - Score spread 10 to **11.6** — read off the real errors. The model claimed a
    margin spread of 14.1 while missing by 16.5, which is exactly how a handicap
    worth 60% went out at 84%. Its stated width now matches its actual error.
  - History window 400 days to **300**. A whole previous season is reasonable
    where a roster persists; college rosters turn over, and the model was
    treating last year's team as this year's — reporting data quality 0.85 in
    week one while missing by 21 points, which no risk profile could filter.
    Season-opening fixtures now have too little history and are skipped, which
    is the answer this application gives everywhere else. On the live card that
    is 84 fixtures skipped rather than confidently mispredicted.
  - The NFL's own model is untouched, and mid-season college coverage is
    essentially unchanged.

- Game-detail enrichment now uses the actual fallback provider and preserves
  source attribution. Neutral-site home/away reversals no longer attach an
  opponent's record to a team, and ESPN's inner cache no longer holds upcoming
  or live match details for six hours.
- The missing-race-order lifecycle test now fixes its clock, so it consistently
  tests retrying an unsettled race instead of drifting into the 24-hour expiry path.

- **The homepage showed the accuracy as `0.8%` when it was `76.5%`.** Every
  probability in the application is stored as a fraction — `0.7647` — and the
  accuracy widget printed it with a `%` after it instead of converting. The
  ring beside it drew a matching sliver, so a model getting three in four right
  looked like one getting almost nothing right. The figure itself was correct
  the whole time, and so was the API; only the last step was wrong. The
  summary card above it had the same fault. Both now use one shared formatter,
  and the type that said "percentage 0-100" — which is what misled them — now
  says what it actually holds.
- **The settlement function had no test coverage at all.** Every rule around it
  was tested; the function those rules run inside — the one that reads the
  file, decides each outcome and writes back — could not be imported by the
  test runner. That seam is exactly where the Formula 1 defect lived, and no
  pure-rule test could have caught it. It now has eleven tests covering a
  race and a fixture through the real store, including the correction path.
- **Formula 1 predictions were never tracked, and were being deleted.** The
  prediction store kept a hand-written list of the selection types it would
  accept, and it was never updated when motorsport was added. Every F1
  prediction was written to disk and then silently discarded the next time the
  file was read — never settled, never counted, and erased from the file
  outright the next time anything else settled. Nothing errored, which is why
  it went unnoticed. The list is now derived from the type itself, so a new
  market cannot be forgotten: leaving one out fails the build.
- **A race result could never be corrected.** Stewards apply penalties after
  the flag, and the correction path only understood scorelines — so a revised
  finishing order never reached the prediction it changed. It now reads a
  finishing order exactly as the first settlement does. The same fix closes a
  worse latent case: had a provider ever reported a score alongside a race,
  every settled race prediction would have been re-judged against an empty
  field and voided.
- **Accuracy breakdowns had no name for the motorsport markets**, so a settled
  F1 prediction would have appeared under a raw key.
- **Score error was averaged across sports**, blending baseball runs with
  American football points into a figure in no unit at all. Split per sport,
  where the number means something. The blended figure remains as a coverage
  count.
- **`risk_ordering` reported a pass when it had not checked anything.** It now
  reports `checked` separately, so "the ordering holds" and "not enough settled
  history to say" cannot be read as the same claim.
- Sport headings in the accuracy breakdowns read `FOOTBALL`; they now use the
  same names as the rest of the application.
- Two links on the Live page were below the minimum tap target size on a phone.
- **Selections at lines nobody offers.** The model would recommend a handicap
  such as "+3.5" when the only line available was 1.5 — a sound probability
  attached to a bet that did not exist. Where prices are published the model
  now works from the book's own lines.
- **Evidence filed under the wrong heading.** "The Astros have won 4 of their
  last 6" appeared under *Risk Factors* on a bet backing the Astros, because
  polarity was written relative to whichever side the model favoured.
- **Correlated legs multiplied together.** Combining a team to win with the
  same team to cover understated the pair by as much as twenty points.
- **Every sport hub page rendered blank.** A route-level loading boundary never
  handed over to the real content, so `<main>` collapsed to zero height and the
  skeleton showed forever — on every sport, in production. Affected NFL, NBA,
  MLB, NHL, football and Formula 1 alike.
- **Championship tables showed no points.** Motorsport fell through to a
  win/loss column set it populates none of, so every column was dropped.
- **Unlabelled projected scores** — "4.5 – 4.6" with no indication which number
  belonged to which side.
- The accuracy panel could not be scrolled to the bottom on a laptop-height
  screen once results were stacked under it.
- Race cards linked to a game-detail page that does not exist for motorsport,
  landing on an error; they now point at the hub.
- **Controls too small to hit on a phone.** On the Parlays page the Analysis
  toggle — the primary way to open a leg — was 17px tall, and the glossary
  terms 17–18px, below the 24px minimum. Now 33px and 25px. Schedule, the hubs
  and Home were already clean, and the championship tables correctly scroll
  inside their own container rather than pushing the page sideways.
- A build could fail at random. Two diagnostic previews in the CI script piped
  into `head -c 200`, which closes the pipe early; the writer took a broken
  pipe and, under `pipefail`, failed the step. Whether it tripped depended on
  how large that day's payload was.

### Removed

- `components/interactive-controls.tsx`, which was never imported and rendered
  a hardcoded list of seven sports that had nothing to do with the catalogue —
  along with two placeholder components that displayed permanent `--` values.
  In an application with a rule against fabricating data, a component whose
  only job is to show invented values is a liability.

- **The Builder workspace, and the model suggestions added to it.** Both were
  built against a misunderstanding of what was wanted, so they are gone rather
  than left to be worked around: `/builder`, its API routes, its odds-provider
  integration and configuration, the Add-to-Builder buttons across Home,
  Schedule, Live and Game Detail, and the fixture-picking endpoint that fed the
  suggestion panel. Nothing depends on them and the surrounding pages are back
  to how they were.

  Kept from the same work, because they were real fixes that had nothing to do
  with Builder: upcoming and live game details are no longer cached for six
  hours as though settled, game enrichment records the provider it actually
  used, and a neutral-site fixture whose feed reverses home and away is now
  enriched by team rather than by slot.

- Nothing has been taken away.

---

## Earlier work

History before this branch is not catalogued retrospectively. The commit log
covers it, and the notable systems have their own documents:

- [docs/betting-markets.md](docs/betting-markets.md) — markets, prices, correlation
- [docs/f1.md](docs/f1.md) — Formula 1
- [docs/projection-engine.md](docs/projection-engine.md) — the scoring model
- [docs/prediction-accuracy.md](docs/prediction-accuracy.md) — settlement and accuracy
- [docs/data-providers.md](docs/data-providers.md) — where the data comes from
- [docs/notifications.md](docs/notifications.md) — Discord notifications
- [docs/sport-hubs.md](docs/sport-hubs.md) — competition hubs
