# Builder

`/builder` is the manual line workspace. Home, Schedule, Live and Game Detail link
to a match's markets there. Parlays remains the existing projection workspace.
A match is not a leg: the user must select a bookmaker outcome and threshold.

## Model suggestions

Builder answers "what is this book offering". The **Suggest** mode on the match
list answers the other half — "what does the model think is worth backing" —
using the same projection engine, thresholds and risk profiles as Parlays.

Tick several matches, choose a risk level, and the engine builds the strongest
line it can from exactly those. Three roles stay separate:

| Decision | Whose |
| --- | --- |
| Which matches | Yours |
| Which market on each | The model's |
| Whether it qualifies at all | The risk profile's |

So the same three matches give genuinely different lines at different risk
levels rather than the same line relabelled. Verified live: Low returned two
legs at 67.2%, Medium two legs at 41.3% with different markets on the same
fixtures.

**A suggestion is not a leg.** Nothing in this panel is a bookmaker quote and
nothing enters the line from it. Each suggestion offers *Find this market*,
which opens that match's real markets where the corresponding outcome can be
added as a proper leg — if a book is genuinely offering it. That is still the
only way a leg is ever created, and the rule that Builder never substitutes
model-generated bets for provider quotes is unchanged.

Suggestions need no odds credential: they come from the projection engine and
the sports-information APIs, so the panel works whether or not
`BUILDER_ODDS_API_KEY` is set. What it cannot do without one is turn a
suggestion into a leg, because there are no quotes to add.

Two reasons a ticked match can contribute nothing, reported separately because
they call for different responses:

- **Nothing clears the risk level.** The line is shorter, says which, and says
  a lower risk level would include it. Never padded with a weaker market.
- **Not available to project** — almost always already under way. Builder lists
  in-play matches; a projection is only ever made before kick-off.

Requests: `GET /api/parlays/games` for the matches on offer at a risk level,
`GET /api/parlays?games=id1,id2` for the line. Both are documented in
[docs/parlay-filters.md](parlay-filters.md).

## Provider configuration on TrueNAS

Set these server environment variables on the existing application container:

| Variable                       | Default  | Purpose                                                             |
| ------------------------------ | -------- | ------------------------------------------------------------------- |
| `BUILDER_ODDS_API_KEY`         | empty    | The Odds API v4 credential; required for Builder markets            |
| `BUILDER_ODDS_REGION`          | `uk`     | One of `uk`, `us`, `eu`, `au`; controls bookmakers                  |
| `BUILDER_ODDS_CACHE_SECONDS`   | `120`    | Per-competition request cache, minimum 60 seconds                   |
| `BUILDER_ODDS_MAX_AGE_SECONDS` | `300`    | Price expiry from provider update timestamp, bounded 60–900 seconds |
| `ODDS_ENABLED`                 | `true`   | Existing master odds switch also controls Builder                   |
| `DATA_DIR`                     | `./data` | Existing persistent data volume; `/data` in compose                 |

Credentials are read only by server modules. No key, token, bookmaker login or
bet-placement URL is sent to the browser. Missing configuration produces an
explicit unavailable state. Builder does not substitute model-generated bets or
ESPN reference/opening prices for current provider quotes.

The adapter requests only `h2h`, `spreads`, and `totals` in decimal format, one
region per request. Provider coverage determines the available books and events.
Requests are deduplicated per competition; refresh shares that cache. Revalidation
runs at most three event lookups concurrently. The existing provider registry
backs off after failures and rate limits. Failed-refresh cached data retains its
original timestamps and is explicitly stale, blocking price calculations.

The [official API guide](https://the-odds-api.com/liveapi/guides/v4/) documents the
request contract and quota costs. Three core markets in one region can consume
three credits per successful odds refresh. There is no background polling of paid
odds; selecting a match or revalidating a line triggers a cached request.

## Identity, availability and calculations

Sports-information APIs and existing `/games/:id` links retain their contracts.
Builder adds:

- `GET /api/builder/markets/:gameId` — provider markets or a specific data gap.
- `POST /api/builder/analyse` with `{ "gameIds": [...] }` — available team context
  and missing-data explanations, maximum 12 events.
- `GET /api/builder/drafts` and `POST /api/builder/drafts` — named server drafts.

ESPN and TheSportsDB identifiers are retained as the application event IDs. The
odds event joins only inside an explicitly mapped competition when both team names,
home/away orientation and kickoff within five minutes agree. Normalization removes
case, accents and punctuation; it does not fuzzy-match abbreviations or swap sides.
Ambiguous events and unmatched names stay unavailable. Same-day doubleheaders are
not joined using date alone.

Stable selection identities include provider event, bookmaker key, market key,
threshold, outcome and settlement identity. Changing a price preserves selection
identity; changing the line creates a different bet. Two-way and three-way featured
markets remain distinct. No player props, extra football markets, tennis tournament
markets or motorsport markets are inferred from core odds.

The provider does not publish authoritative settlement rules. Builder explicitly
labels regulation/overtime coverage unknown and never equates distinct market
identities. This matters particularly for NHL: the provider documents that
[featured markets vary by bookmaker](https://the-odds-api.com/sports/nhl-odds.html).
In-play odds are unavailable because this adapter cannot verify whether an
individual price is genuinely in-play. A pre-match quote expires at kickoff even
if its normal TTL has not elapsed. Disappeared markets are unavailable; the core
feed does not distinguish suspension from withdrawal.

Distinct-match selections from one bookmaker can produce an **indicative
estimate** by multiplying current decimal prices. This is never presented as an
executable accumulator: settlement and bookmaker combination acceptance remain
unconfirmed. Return includes stake; net profit subtracts stake. Single and
multi-match lines are distinguished. Changed prices block calculations pending
acceptance; unavailable, expired and stale prices block them too.

Same-game and mixed lines containing same-game legs do **not** use multiplication.
The provider interface supports a future `quoteCombination` adapter; an exact,
fresh quote must identify every selected leg and the chosen bookmaker. The current
adapter has no combination quote service, so those combined prices remain
unavailable. There is no endpoint or UI for placing wagers.

## Analysis and drafts

Analysis reports exact selections, available team records/recent scores and
specific gaps. It describes concentration and same-game risks, identifies the
largest price multiplier and separates price-implied probability (including margin)
from model confidence. No calibrated model is attached to these exact selections,
so uncertainty ranking and expected value are explicitly unavailable.

Shorter-line comparisons keep the same stake and show the resulting return and
profit before the user accepts removal. Replacement opens only supported provider
outcomes and previews its return before acceptance. Singles comparisons split the
same total stake, allocating remaining pennies explicitly, and label the all-win
scenario. Suggestions never change the line automatically.

Named drafts use `DATA_DIR/builder-drafts.v1.json`, the same atomic temporary-write
and serialized mutation approach as the watchlist. Maximum 50 named drafts, 12 legs
per line. They are shared by users of this server, consistent with the existing
household application; there is no new per-user authentication system. Mount the
existing data volume to retain them across container upgrades. Invalid store data
is reported, not overwritten as an empty store. Browser local storage maintains a
versioned working copy on that device; failures are visible. All restored legs
lose their prior verification status and are revalidated when Builder opens.

Text copy/export includes selections, thresholds, settlement information,
bookmaker, quote and retrieval timestamps, stake, estimated return and net profit.

## Verification

`tests/builder.test.ts` uses clearly labelled synthetic payloads, never shipped to
the UI. It covers selection transitions, duplicate/conflict detection, strict event
matching, bookmaker consistency, same-game quote restrictions, calculations,
changed/missing/stale prices, expiry at kickoff, draft restoration, export and
shorter/singles comparisons. Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and
`pnpm build`. A live paid-provider smoke test requires a configured key.

Related corrections: enrichment now dispatches using the actual fallback
descriptor and retains source provenance; reversed neutral-site provider sides are
oriented before team enrichment; ESPN's inner summary cache no longer holds
upcoming/live state for six hours. The missing-race-order lifecycle test uses a
fixed clock so it cannot accidentally enter the 24-hour abandonment path.
