# Betting markets

How Parlay Projector separates what the model thinks from what a bookmaker is
offering, and what it will not claim about either.

## The distinction everything rests on

Four different things used to be printed as one line of text:

```
Houston Astros +3.5
Estimated Probability: 87%
```

That is a selection, a market, a line and a probability, run together — and the
line was one the model had invented for itself. No bookmaker was offering
Houston at +3.5; the run line was 1.5. The probability was perfectly sound and
the bet did not exist.

They are now separate objects:

| Thing | Where it lives | Example |
| --- | --- | --- |
| Market | `MarketContext.type` / `.label` | Run Line |
| Selection | `MarketContext.selection` | Houston Astros +1.5 |
| Line | `MarketContext.line` | 1.5 |
| Availability | `MarketContext.availability` | verified / model_only |
| Price | `MarketContext.price` | 1.40 · 2/5 · −250 |
| Model probability | `Selection.probability` | 68% |
| What it measures | `Selection.probability_label` | Cover probability |
| What must happen | `Selection.explanation` | Houston must win, or lose by exactly one run. |

## Where prices come from

The sports feed the application already calls carries bookmaker prices
alongside the fixtures. `lib/odds/` reads them, deliberately and in one place.

This does not undo the betting-data strip in the fixtures adapter. That
boundary still holds: a `Game` has no odds on it and never will. Prices live in
their own model, keyed by game id, so nothing downstream can read a price it
did not ask for.

**Three markets are read**, and nothing beyond them:

- moneyline — home, away, and the draw where the sport has one
- point spread — both sides, with the line each is quoted at
- total — over and under, with the line

Deep links into a sportsbook's bet slip are dropped. This application is not a
route to placing a bet and passing those through would make it one.

### Coverage is partial, and that is designed for

Verified at the time of writing:

| Competition | Prices published |
| --- | --- |
| NFL, NCAA football, WNBA | Yes, months ahead |
| Every football competition | Yes, including draw prices — a true 1X2 |
| NBA | Patchy; near to tip-off |
| MLB, NHL, NCAA basketball | None |

A competition with no published prices is not a failure. Its selections are
reported as model projections whose availability is unverified, which is the
truth. **Prices enrich a projection; they are never a precondition for one.**

### Freshness

A quote is only evidence of availability while it is current. Past
`MAX_QUOTE_AGE_MS` (30 minutes) a market stops being treated as verified and
falls back to being described as a model projection. Every verified badge
carries the time the price was read, so the reader can judge for themselves.

## Two states, never blurred

**`verified`** — a named bookmaker was quoting this exact line when we last
looked. The badge names the book and the time.

**`model_only`** — Parlay Projector derived the line from its own simulations
and *nobody has confirmed it is offered anywhere*. Legitimate analysis, marked
"Model projection — availability not verified", and never presented as a
placeable bet.

Where a fixture has published prices, the model is run against **those exact
lines**, both sides of every market. Markets the feed does not carry — team
totals, double chance — are still modelled, and are always `model_only`.

## Prices and probabilities are different quantities

A price implies a probability, `1 / decimal`. Those implied figures sum to more
than 100% across a market; the excess is the bookmaker's margin. Comparing a
model probability against the raw implied number therefore charges the model
for the margin before it starts.

Both are produced. `removeMargin` strips the margin proportionally — the
standard first approximation, and the one that does not require assuming which
side the book has loaded. It needs *every* side of the market and returns
nothing for a partial one.

**"Model edge" is disagreement, not an advantage.** A positive edge means the
model rates an outcome more likely than the price does. Either party can be
wrong, and the model is the one with nothing at stake. The interface never
calls it value.

## Correlation is measured, not assumed

Multiplying probabilities is only valid for independent events. Two selections
from one fixture almost never are.

Because every probability is read off the same simulated games, the joint
probability can simply be **counted**: run through the simulations and see how
often every leg came in at once. That is a real joint distribution rather than
an adjustment factor, and it is right in both directions — a favourite
alongside the over is commonly more likely than the product; a favourite
alongside the under, less.

- **Multi-game lines** take at most one selection per fixture, so the legs are
  across different games and the product is defensible. Correlation is reported
  as low without being measured, because two fixtures are not simulated
  together and pretending to measure a relationship between them would be worse
  than assuming there is none.
- **Same-game lines** report the measured joint probability *and* what
  multiplying would have given, so the difference is visible rather than hidden
  inside one number.

A leg is only added to a same-game combination if it is still likely enough
*given the legs already chosen*. That one rule rejects contradictions
automatically: a selection that can never co-occur has a conditional
probability of zero.

## What is not offered, and why

**No player markets.** Not points, rebounds, assists, strikeouts, passing
yards, anytime touchdown or anytime goalscorer.

The application has no player statistics, no lineups, no expected starters and
no injury feed, and the price feed carries no player markets either. There is
nothing to model and nothing to verify against. Producing them would be
invention on both counts.

**No half or quarter markets.** The model simulates whole games. It has no
notion of a first half, so a first-half line would be a number with nothing
behind it.

**No alternate lines beyond what is quoted.** Generating a ladder of
handicaps the model can price but nobody offers is the exact failure this work
set out to fix.

**No bookmaker is hard-coded as a source.** A price records the book that
quoted it, whichever that turns out to be. Where a feed lists several books the
first is taken rather than the best price being hunted across them: presenting
the most generous quote from each as though it were one offer would describe a
bet that exists nowhere.

## Safeguards

- Odds are never fabricated. A price that cannot be read is a market we do not
  have, not a market at evens.
- A handicap without its line is discarded — a price alone does not describe a
  bet.
- A combined price is null the moment one leg is unpriced. Substituting the
  model's own probability for a missing quote would fabricate the headline
  figure with nothing to show which leg was invented.
- Risk level is *derived* from the selections. It never reaches back and
  adjusts a probability; a category that could change the numbers underneath it
  would be worthless.
- The probability stored with a published line is the one it actually claimed.
  For a same-game line that is the measured joint probability — recomputing the
  product at settlement would judge the optimiser against a number it never
  gave.
- Nothing is described as safe or guaranteed. "Low risk" is a relative
  analytical category, and the interface says so.

## Configuration

```
ODDS_ENABLED=true          # false reports every selection as model_only
ODDS_CACHE_TTL_SECONDS=600
```

No credentials are involved. See `docs/data-providers.md` for the provider
caveat that applies to the whole feed.
