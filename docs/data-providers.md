# Data providers

Parlay Projector consumes several external providers behind one internal data
layer. The frontend only ever sees the Parlay Projector model — it never knows
which provider supplied a field.

```
TheSportsDB ──┐
ESPN ─────────┼──> Provider registry ──> Sports services ──> Home / Schedule / Live / Game Details
RSS news ─────┘
```

---

## Provider audit

### TheSportsDB — primary

| | |
|---|---|
| Purpose | Fixtures, live scores, base game record |
| Sports | NFL, NBA, MLB, NHL, Football, Tennis |
| Auth | API key in the URL path (`SPORTS_API_KEY`) |
| Cost | Free public test key `3`; paid tiers available |
| Capabilities | `schedules`, `live_scores`, `game_details`, `standings`*, `team_records`*, `recent_form`* |

**Measured limitations on the public test key:**

- Rate limits hard — the 8-day schedule window (up to 48 requests) returns 429
  in a burst. A real key is needed for full Schedule coverage.
- `lookuptable.php` returns only ~5 rows, so standings are usually unusable.
- `eventsh2h.php` returns 404 — no head-to-head.
- No broadcast/TV field anywhere in the event payload.
- Live feed returns **no rows at all** for NFL and Tennis.
- No player data.

`*` marked capabilities exist but are weak, which is why ESPN outranks it for them.

### ESPN — enrichment

| | |
|---|---|
| Purpose | Team records, recent form, head-to-head, broadcast, venue, abbreviations |
| Sports | NFL, NBA, MLB, NHL, Football (major competitions), Tennis |
| Auth | **None** |
| Cost | Free |
| Capabilities | `team_records`, `recent_form`, `head_to_head`, `broadcasts`, `standings`, `player_leaders` |
| Enable/disable | `ESPN_ENABLED` (default `true`) |

Host note: `site.api.espn.com` returns **403** to server-side callers;
`site.web.api.espn.com` serves the same payloads and is what the adapter uses.

**Licensing caveat.** This is ESPN's public web API. It is undocumented and
carries no published terms of use, so it could change or restrict access
without notice. It is therefore used strictly as *optional enrichment*: every
feature degrades cleanly to the primary provider's data if ESPN is disabled or
unreachable. Do not make it load-bearing.

**Betting data is stripped at the adapter boundary.** ESPN includes `odds`,
`pickcenter`, `hasOdds` and `ticketsInfo`; these are removed in
`lib/providers/espn/normalise.ts` before anything enters the application, and a
test asserts no odds terms survive.

Football competitions covered: Premier League, Champions League, Europa League,
La Liga, Bundesliga, Serie A, Ligue 1, Championship, MLS. An uncovered
competition simply gets no enrichment.

### RSS — news

| | |
|---|---|
| Purpose | Sports headlines |
| Auth | None |
| Capabilities | `news` |
| Config | `NEWS_FEED_URLS` (default BBC Sport) |

Metadata, short provider summaries and source links only — never article bodies.

---

## Provider priority

Declared once, in `lib/providers/registry.ts`:

| Capability | Order |
|---|---|
| `schedules` | thesportsdb |
| `live_scores` | thesportsdb |
| `game_details` | thesportsdb |
| `standings` | **espn**, thesportsdb |
| `team_records` | **espn**, thesportsdb |
| `recent_form` | **espn**, thesportsdb |
| `head_to_head` | **espn** |
| `broadcasts` | **espn** |
| `player_leaders` | **espn** |
| `news` | rss |

Services request a *capability*, never a named provider.

## Fallback and health

`withFallback()` tries providers in priority order and stops at the first
success. Failures are recorded: a rate-limited provider is skipped for 5
minutes, an otherwise-failing one for 60 seconds, then retried. Fallback exists
for when a preferred provider is unavailable — not as an excuse to call every
provider on every request.

If no provider can serve a capability, the result is simply absent. That is
never an error.

## Conflict rules

| Field | Rule |
|---|---|
| Live score, status, start time | Primary provider always wins — enrichment never overwrites them |
| Team record, recent form | Enrichment provider wins (the primary provider's is truncated) |
| Venue | First trusted non-empty value: primary first, enrichment fills a blank |
| Broadcast | Enrichment only — the primary provider has no such field |
| Head-to-head | Enrichment only |

Nothing is overwritten by whichever request happens to finish last.

## Entity matching

Providers share no identifiers, so a fixture is matched on:

```
same sport  AND  same calendar day  AND  BOTH teams match
```

Team names are reduced to token sets (accents, punctuation and words like `FC`
removed, with aliases for `Man Utd`, `Spurs`, `Wolves`). A single-team match is
never enough, and an ambiguous match is treated as **no match** — attaching the
wrong club's record is far worse than showing none.

Existing `/games/:id` links are unaffected: the primary provider's event id
remains the canonical game id.

## Provenance

Enriched game details carry `_sources`, recording which provider supplied which
field:

```json
"_sources": { "game": "thesportsdb", "standings": "espn", "broadcast": "espn" }
```

Contains no credentials.

## Caching

| Data | TTL |
|---|---|
| Live scores | 20s |
| Today's fixtures | 2 min |
| Schedule window | 15 min |
| ESPN scoreboard (enrichment) | 15 min |
| Head-to-head | 6 hours |
| Game detail (finished) | 6 hours |
| Game detail (scheduled) | 10 min |
| Game detail (live) | 1 min |
| News | 10 min |

ESPN scoreboards are cached per competition-day, so enriching several fixtures
from the same competition costs one request, not one per game.

## API efficiency

Enrichment is **lazy**: it runs only for `/games/:id`, never across a schedule.
A Game Details page costs at most two ESPN requests (scoreboard, then
head-to-head), both cached. Schedule and Live are untouched by enrichment.

## Diagnostics

`GET /api/internal/providers` reports id, label, enabled state, health and
capabilities. It returns **no credentials, URLs or request details** — only the
*name* of the environment variable a provider would need.

## Environment variables

See `.env.example`. No provider requires credentials today; `SPORTS_API_KEY` is
strongly recommended to lift TheSportsDB's rate limits.

## Not yet integrated

Adapters were deliberately **not** written for providers whose credentials are
unavailable — no fake keys, no dead configuration. Candidates for later:

| Provider | Would add | Notes |
|---|---|---|
| API-Football / API-Sports | Deep football stats, lineups, injuries | Free tier, requires registration |
| football-data.org | Competition standings and fixtures | Returned 403 without a token |
| balldontlie | NBA player statistics | Now requires a key |

Adding one is: a new adapter, a `ProviderDescriptor`, and an entry in the
priority table. No page or service changes.
