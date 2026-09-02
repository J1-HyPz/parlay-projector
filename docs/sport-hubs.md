# Competition hubs

`/sports/<competition>` is a dedicated page for each of the sixteen competitions
the application serves. One dynamic route and one component tree cover all of
them; what differs between the NBA and the Premier League is configuration, not
code.

## Slugs

| Sport | Hubs |
| --- | --- |
| American football | `nfl`, `ncaaf` |
| Basketball | `nba`, `wnba`, `ncaab` |
| Baseball | `mlb` |
| Ice hockey | `nhl` |
| Football | `epl`, `championship`, `league-one`, `ucl`, `uel`, `uecl`, `laliga`, `bundesliga`, `seriea` |

Anything else is a **404**, not an empty page. That includes `tennis`: the shared
`SportId` type still contains it, but no verified tennis competition exists in
the league catalogue, so it gets no hub.

## Navigation is not filtering

These were previously the same list, which conflated two jobs:

- **Sidebar shortcuts navigate.** They open `/sports/<slug>`.
- **Schedule and Live chips filter.** They are unchanged, and each hub links
  back with `?sport=<chip>` applied.

The sidebar stays curated — nine entries, not seventeen. The remaining football
competitions are reached from the switcher on any football hub.

## NCAA basketball

`ncaab` is a **UI grouping, not a league**. The catalogue holds `ncaam` and
`ncaaw` separately and the hub carries an All / Men's / Women's selector:

| Selector | Leagues queried |
| --- | --- |
| All | `ncaam` + `ncaaw` |
| Men's | `ncaam` |
| Women's | `ncaaw` |

Fixtures and news span both under All. **Standings and teams require one
division** — there is no meaningful combined table across men's and women's
college basketball, and merging hundreds of teams into one grid helps nobody.

`/sports/ncaam` and `/sports/ncaaw` resolve to the combined hub with that
division already selected, so a link built from any league id lands somewhere
sensible.

## Terminology

Football does not borrow American vocabulary, or the other way round:

| | Games | Teams | Standings | Moves |
| --- | --- | --- | --- | --- |
| Football | Fixtures | Clubs | Table | Transfers |
| NFL / NBA / MLB / NHL | Games | Teams | Standings | Transactions |
| Collegiate | Games | Teams | Standings | Roster Moves |

## Where the data comes from

Nothing new was built for the sports layer. Hubs consume what already existed:

| Section | Source |
| --- | --- |
| Live, today, results, upcoming | `fixturesForLeague` — the same ESPN adapter Schedule and Home use |
| Standings | `GET /api/leagues/:id/standings` |
| Teams, rosters | `GET /api/leagues/:id/teams`, `.../teams/:teamId/roster` |
| News | `GET /api/leagues/:id/news` *(new)* |
| Transactions | `GET /api/leagues/:id/transactions` *(new)* |

`GET /api/leagues/:id/games` is also new. It exists because the Schedule service
covers today through today+7 only, and a hub also needs **recent results**; it
widens the window on the same adapter rather than introducing a second fixture
fetcher.

Game cards keep the shared `Game` model, the shared status vocabulary, the
`/games/:id` detail route and the watchlist button — a game starred from a hub
behaves exactly as it does on Schedule.

## Transactions: what is actually available

The provider was checked before any of this was built.

| League | Transactions |
| --- | --- |
| NFL, NBA, WNBA, MLB, NHL | Published |
| Every football competition | **None** |
| NCAA Football, NCAA Basketball | **None** |

ESPN's core API returns real entries for the five North American professional
leagues and an empty feed for everything else. That is recorded on the league
catalogue as `hasTransactions`, so a football hub says *"Transfers are not
published for this competition by the current data provider"* rather than
showing a permanently empty section that looks broken.

**No transfer fees are shown anywhere, because the feed carries none.** The
model has no fee field for the same reason. What the provider does supply is a
date, a team reference and a free-text description; the description is rendered
verbatim and only *classified* — the opening verb decides whether a row is a
trade, a waiver or a signing, falling back to a neutral label rather than
guessing.

## Standings

One table component for every competition. Groups come from the provider —
two NBA conferences, eleven NCAA Football conferences, one flat football table —
and **columns are chosen from the data present**, so no empty column is
rendered and nothing is fabricated:

- Football: `P W D L GF GA GD Pts`
- Everything else: `W L T PCT GB PF PA Streak`

`games_played`, `points` and `point_differential` were added to the normaliser
for this. ESPN already returned them; they were simply being discarded, which
would have left every football table without a points column.

## Failure and empty states

Each section loads independently, so one provider failing does not take the page
down:

```
Scores        ✓
Standings     ✓
Teams         ✓
News          Unable to load news right now.
Transactions  Transfers are not published for this competition.
```

Empty is distinguished from broken throughout — "No games are currently live" is
not the same message as "Unable to load fixtures right now".

## Limitations

- **No team pages yet.** Team cards link to the roster endpoint. The routing is
  ready for `/teams/[leagueId]/[teamId]` when it is wanted.
- **No player leaders.** The layout leaves room for them; no leader data is
  wired up.
- **NCAA Football conference filtering** is whatever the standings provider
  groups by, rendered dynamically. There is no separate conference selector.
