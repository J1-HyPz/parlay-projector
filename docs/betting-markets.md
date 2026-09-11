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

**Two sources, and which one answers depends on configuration.** `lib/odds/`
holds both, deliberately and in one place.

With `ODDS_API_KEY` set, prices come from **UK bookmakers** via The Odds API —
Sky Bet, William Hill, Paddy Power, Ladbrokes, Coral, Betfred, BetVictor and
the rest of the `uk` region. Without it, the fallback is the prices the sports
feed carries alongside its fixtures, which an audit of a week's worth found to
be DraftKings and nothing else: real prices, quoted in a country most of this
application's readers are not in. The fallback is kept because it is better
than nothing for a reader who *is* in the United States, but it is second, and
what it is gets said out loud rather than presented as simply "the odds".

Most competitions are one key at the provider. **Tennis is not**, and it is
worth knowing why: this provider keys tennis per *tournament*
(`tennis_atp_us_open`) rather than per tour, and which tournaments exist
changes week to week as the calendar moves on. So the keys in play are read
from the provider's own sports list rather than hard-coded — a fixed list would
price the ATP for a fortnight and then quietly stop. Inactive keys and
outrights are skipped: the first returns nothing, and the second is a
tournament-winner market with no match prices to join to a fixture.

That costs more. A competition with one key is three credits per refresh;
a tour is three per tournament in play, typically two to four at once.
`ODDS_API_CACHE_TTL_SECONDS` is the lever, and on the free tier's 500 credits a
month it is not a small one.

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

Verified against live data:

| Competition | Prices published |
| --- | --- |
| NFL, NCAA football, WNBA | Yes, months ahead |
| Every football competition | Yes, including draw prices — a true 1X2 |
| MLB, NBA, NHL, NCAA basketball | Close to the start only |
| UFC, ATP, WTA | Only with `ODDS_API_KEY`; the fixtures feed carries neither |
| Formula 1 | Never — no motorsport market on either source |

The second group matters: the same competition is priced today and unpriced
next week, so **availability is decided per fixture, never per competition.** A
probe run out of season reported no baseball prices at all; a live run the same
week found most of that day's card quoted.

A fixture with no published prices is not a failure. Its selections are
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

## Both teams to score

Offered only where being kept out is a real possibility — the same low-scoring
sports a draw is a genuine outcome in. In basketball and American football both
sides score in essentially every simulated game, so the market would be a
certainty dressed as a prediction, and it is withheld rather than printed at
99%.

Both directions are generated. Backing "No" is an opinion that one side gets
kept out, not the absence of an opinion, and the risk profiles decide which — if
either — is worth a place in a line.

The probability is **counted across paired simulations, never multiplied**. A
one-sided rout and a blank sheet arrive in the same simulated game, so two
independent "scored at least once" figures would miss that and overstate the
market. `homeScores[i]` and `awayScores[i]` belong to the same simulated
fixture, which is what makes the count possible.

It needs no line, so unlike every other two-sided market here it **cannot
push**: the threshold is one, on both sides, always.

Expect to see it mainly at high risk. Both teams scoring is close to a coin flip
in most fixtures — which is precisely why bookmakers offer it — so it rarely
out-scores an 85% double chance when the optimiser picks one leg per match. It
appears when it genuinely is the strongest thing on a fixture, and not to fill
space.

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

**No second market on a fight or a tennis match.** The winner, and nothing
else. The UK source quotes handicaps and totals on both sports, but the model
produces no probability for either, so there is nothing to set against those
prices — and a market this application cannot price is one it must not appear
to have an opinion on. Some books also quote a drawn fight; the model has no
draw probability, so it says nothing there either.

**No bookmaker is hard-coded as a source.** A price records the book that
quoted it, whichever that turns out to be. From the UK source the best decimal
price per selection is taken across books, and which book gave it travels with
the quote — so a slip never implies one book offered all of it. From the
fixtures feed, where several books appear, the first is taken.

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
ODDS_ENABLED=true              # false reports every selection as model_only
ODDS_CACHE_TTL_SECONDS=600
ODDS_API_KEY=                  # empty means off: no request, no UK prices
ODDS_API_REGION=uk
ODDS_API_CACHE_TTL_SECONDS=1800
```

`ODDS_API_KEY` is a credential: anyone holding it can spend the account's
quota. It is read from the environment only, never committed, never logged and
never sent to the browser — the odds module logs the competition and the
outcome of a call, never its URL, because the key travels in the query string
as that API requires.

Empty means off, and off is a degraded state rather than a broken one: every
selection reports as an unverified model projection, exactly as it does for a
fixture no book has quoted yet. The one visible consequence is that MMA,
tennis and Formula 1 produce no parlay legs at all, because a leg must be a bet
somebody is offering.

See `docs/data-providers.md` for the provider caveat that applies to the
fixtures feed.
