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

The Parlays redesign, a results scroller on Home, and Formula 1 as a full
sport. 70 files, 640 tests.

### Added

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

**Elsewhere**

- Accuracy is broken down by sport crossed with market type, so the model can
  eventually be steered toward what it reads well.
- A dev-server launch config on a pinned port.

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

### Fixed

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
