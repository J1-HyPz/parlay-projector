# ESPN per-player data — live probe findings

All values below were read out of responses actually received on **2026-09-23**.
Nothing is inferred from documentation. Where a request did not answer the
question, the row says "could not determine" and gives the HTTP status.

Hosts and paths are the ones the application already uses:

| purpose | base | source in repo |
| --- | --- | --- |
| scoreboard / summary / teams | `https://site.web.api.espn.com/apis/site/v2/sports` | `lib/config.ts` `espnConfig.baseUrl`, `lib/providers/espn/client.ts` |
| athlete gamelog | `https://site.web.api.espn.com/apis/common/v3/sports` | `lib/providers/espn/pitchers.ts` `COMMON_BASE` |
| core API (only used for the depth-chart cross-check) | `https://sports.core.api.espn.com/v2/sports` | `lib/providers/espn/client.ts` `CORE_ROOT` |

Request headers: `accept: application/json`, `user-agent: parlay-projector`
(same as `lib/http.ts`).

One date per scoreboard request (`?dates=YYYYMMDD&limit=400`), walked backwards
one day at a time, exactly as instructed — no `START-END` range was used.

---

## Probe 1 — per-player, per-game box score

### 1a. The fixture each competition was measured on

| comp | `espnPath` | scoreboard date used | dates scanned before a finished fixture was found | event id | fixture | `summary?event=` status | response bytes | `boxscore.players` present |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nfl | `football/nfl` | 20260913 | 1 | 401872925 | Tampa Bay Buccaneers at Cincinnati Bengals | 200 | 564,944 | yes (2 entries) |
| nba | `basketball/nba` | 20260610 | 1 | 401859966 | San Antonio Spurs at New York Knicks | 200 | 424,056 | yes (2 entries) |
| mlb | `baseball/mlb` | 20260910 | 1 | 401816885 | Tampa Bay Rays at Atlanta Braves | 200 | 858,280 | yes (2 entries) |
| nhl | `hockey/nhl` | 20260609 | 2 (20260610 had no completed event) | 401874174 | Carolina Hurricanes at Vegas Golden Knights | 200 | 452,489 | yes (2 entries) |
| ncaaf | `football/college-football` | 20260912 | 1 | 401856682 | Ohio State Buckeyes at Texas Longhorns | 200 | 551,556 | yes (2 entries) |
| epl | `soccer/eng.1` | 20260913 | 1 | 401879282 | Brighton & Hove Albion at Coventry City (`header.league.name` = "English Premier League") | 200 | 420,885 | **no — `boxscore` carries only `teams`; `boxscore.players` is `null`** |
| laliga | `soccer/esp.1` | 20260913 | 1 | 401882885 | Málaga at Celta Vigo (`header.league.name` = "Spanish LALIGA") | 200 | 393,845 | **no — same** |
| ucl | `soccer/uefa.champions` | 20260910 | 7 | 401915444 | AS Roma at Fenerbahce (`header.league.name` = "UEFA Champions League") | 200 | 439,094 | **no — same** |

### 1b. Stat groups per competition

Observed on the fixtures in 1a. "group has no `name` key" is literal — the key
is absent from the object, not null.

| comp | group container | group identity | groups observed (one team's side) |
| --- | --- | --- | --- |
| nfl | `boxscore.players[].statistics[]` | `name` | `passing`, `rushing`, `receiving`, `fumbles`, `defensive`, `interceptions`, `kickReturns`, `puntReturns`, `kicking`, `punting` (10) |
| ncaaf | same | `name` | identical 10 group names to NFL |
| nba | same | **no `name` key, no `type` key** | exactly 1 group per team |
| mlb | same | **no `name` key; carries `type`** | 2 groups per team: `type: "batting"`, `type: "pitching"` |
| nhl | same | `name` | `forwards`, `defenses`, `skaters`, `goalies` (4; `skaters` had 0 athletes in this game) |
| epl / laliga / ucl | `boxscore.players` absent | — | — (see 1e) |

Group object keys as observed:

| comp | group object keys |
| --- | --- |
| nfl / ncaaf | `["name","keys","text","labels","descriptions","athletes","totals"]` |
| nba | `["names","keys","labels","descriptions","athletes","totals"]` |
| mlb | `["type","names","keys","labels","descriptions","totals","athletes"]` |
| nhl | `["name","keys","labels","descriptions","athletes"]` (no `totals`) |

### 1c. `keys` / `labels` verbatim, with one athlete's `stats` verbatim

**NFL** — event 401872925, Tampa Bay Buccaneers (team id 27)

| group | `keys` | `labels` | example athlete | `stats` verbatim |
| --- | --- | --- | --- | --- |
| passing | `["completions/passingAttempts","passingYards","yardsPerPassAttempt","passingTouchdowns","interceptions","sacks-sackYardsLost","adjQBR","QBRating"]` | `["C/ATT","YDS","AVG","TD","INT","SACKS","QBR","RTG"]` | Baker Mayfield (id 3052587) | `["23/28","216","7.7","0","0","4-23","37.6","98.8"]` |
| rushing | `["rushingAttempts","rushingYards","yardsPerRushAttempt","rushingTouchdowns","longRushing"]` | `["CAR","YDS","AVG","TD","LONG"]` | Bucky Irving (id 4596448) | `["8","45","5.6","1","10"]` |
| receiving | `["receptions","receivingYards","yardsPerReception","receivingTouchdowns","longReception","receivingTargets"]` | `["REC","YDS","AVG","TD","LONG","TGTS"]` | Emeka Egbuka (id 4567750) | `["5","63","12.6","0","17","6"]` |
| fumbles | `["fumbles","fumblesLost","fumblesRecovered"]` | `["FUM","LOST","REC"]` | Baker Mayfield | `["3","3","0"]` |
| defensive | `["totalTackles","soloTackles","sacks","tacklesForLoss","passesDefended","QBHits","defensiveTouchdowns"]` | `["TOT","SOLO","SACKS","TFL","PD","QB HTS","TD"]` | Josiah Trotter (id 4870998) | `["11","4","1","2","1","1","1"]` |
| interceptions | `["interceptions","interceptionYards","interceptionTouchdowns"]` | `["INT","YDS","TD"]` | Josiah Trotter | `["1","38","1"]` |
| kickReturns | `["kickReturns","kickReturnYards","yardsPerKickReturn","longKickReturn","kickReturnTouchdowns"]` | `["NO","YDS","AVG","LONG","TD"]` | Kameron Johnson (id 5097554) | `["5","137","27.4","32","0"]` |
| puntReturns | `["puntReturns","puntReturnYards","yardsPerPuntReturn","longPuntReturn","puntReturnTouchdowns"]` | `["NO","YDS","AVG","LONG","TD"]` | Tez Johnson (id 4608810) | `["1","13","13.0","13","0"]` |
| kicking | `["fieldGoalsMade/fieldGoalAttempts","fieldGoalPct","longFieldGoalMade","extraPointsMade/extraPointAttempts","totalKickingPoints"]` | `["FG","PCT","LONG","XP","PTS"]` | Chase McLaughlin (id 3150744) | `["2/2","100.0","51","3/3","9"]` |
| punting | `["punts","puntYards","grossAvgPuntYards","touchbacks","puntsInside20","longPunt"]` | `["NO","YDS","AVG","TB","In 20","LONG"]` | — (`athletes: []`, `totals: []`) | — |

**NCAAF** — event 401856682, Ohio State (team id 194). Same 10 group names,
three columns differ from the NFL:

| group | `keys` | `labels` | example athlete | `stats` verbatim |
| --- | --- | --- | --- | --- |
| passing | `["completions/passingAttempts","passingYards","yardsPerPassAttempt","passingTouchdowns","interceptions","adjQBR"]` (no `sacks-sackYardsLost`, no `QBRating`) | `["C/ATT","YDS","AVG","TD","INT","QBR"]` | Julian Sayin (id 5079712) | `["17/32","278","8.7","1","1","88.3"]` |
| receiving | `["receptions","receivingYards","yardsPerReception","receivingTouchdowns","longReception"]` (no `receivingTargets`) | `["REC","YDS","AVG","TD","LONG"]` | — | — |
| defensive | `["totalTackles","soloTackles","sacks","tacklesForLoss","passesDefended","hurries","defensiveTouchdowns"]` (`hurries` where the NFL has `QBHits`) | `["TOT","SOLO","SACKS","TFL","PD","QB HUR","TD"]` | — | — |
| rushing / fumbles / interceptions / kickReturns / puntReturns / kicking / punting | identical `keys` to the NFL rows above | — | — | — |

**NBA** — event 401859966, San Antonio Spurs (team id 24), single group

- `keys`: `["minutes","points","fieldGoalsMade-fieldGoalsAttempted","threePointFieldGoalsMade-threePointFieldGoalsAttempted","freeThrowsMade-freeThrowsAttempted","rebounds","assists","turnovers","steals","blocks","offensiveRebounds","defensiveRebounds","fouls","plusMinus"]`
- `labels` (and `names`, identical): `["MIN","PTS","FG","3PT","FT","REB","AST","TO","STL","BLK","OREB","DREB","PF","+/-"]`
- example athlete — Julian Champagnie (id 4592479): `["33","5","2-9","1-7","0-0","5","3","0","4","0","0","5","1","-4"]`
- second athlete: `["44","24","9-25","2-8","4-7","13","1","0","0","3","5","8","1","+1"]` — note `+/-` arrives as `"+1"` with a leading plus.
- athlete line keys: `["active","athlete","starter","didNotPlay","reason","ejected","stats"]`

**MLB** — event 401816885, Tampa Bay Rays (team id 30)

| group `type` | `keys` | `labels` | example athlete | `stats` verbatim |
| --- | --- | --- | --- | --- |
| batting | `["hits-atBats","atBats","runs","hits","RBIs","homeRuns","walks","strikeouts","pitches","avg","onBasePct","slugAvg"]` | `["H-AB","AB","R","H","RBI","HR","BB","K","#P","AVG","OBP","SLG"]` | Yandy Diaz (id 33481) | `["1-4","4","0","1","0","0","0","1","18",".305",".370",".471"]` |
| pitching | `["fullInnings.partInnings","hits","runs","earnedRuns","walks","strikeouts","homeRuns","pitches-strikes","ERA","pitches"]` | `["IP","H","R","ER","BB","K","HR","PC-ST","ERA","PC"]` | Nick Martinez (id 33372) | `["6.1","2","0","0","0","3","0","68-53","2.92","68"]` |

Batting athlete line keys: `["active","athlete","starter","batOrder","position","atBats","stats"]`.
Pitching athlete line keys: `["active","athlete","starter","batOrder","position","stats"]`.
`avg`/`onBasePct`/`slugAvg` and `ERA` are **season-to-date** values sitting in a
single game's row, not that game's figures.

**NHL** — event 401874174, Carolina Hurricanes (team id 7)

| group | `keys` | `labels` | example athlete | `stats` verbatim |
| --- | --- | --- | --- | --- |
| forwards / defenses / skaters (identical `keys`) | `["blockedShots","hits","takeaways","plusMinus","timeOnIce","powerPlayTimeOnIce","shortHandedTimeOnIce","evenStrengthTimeOnIce","shifts","goals","ytdGoals","assists","shotsTotal","shotsMissed","shootoutGoals","faceoffsWon","faceoffsLost","faceoffPercent","giveaways","penalties","penaltyMinutes"]` | `["BS","HT","TK","+/-","TOI","PPTOI","SHTOI","ESTOI","SHFT","G","YTDG","A","S","SM","SOG","FW","FL","FO%","GV","PN","PIM"]` | Sebastian Aho (id 3904173, `forwards`) | `["2","1","1","-1","18:14","2:43","2:10","13:21","24","0","4","1","3","1","0","5","8","38.5","2","0","0"]` |
| goalies | `["goalsAgainst","shotsAgainst","shootoutSaves","shootoutShotsAgainst","saves","savePct","evenStrengthSaves","powerPlaySaves","shortHandedSaves","timeOnIce","ytdGoals","penaltyMinutes"]` | `["GA","SA","SOS","SOSA","SV","SV%","ESSV","PPSV","SHSV","TOI","YTDG","PIM"]` | Brandon Bussi (id 4996097) | `["3","21","0","0","18",".857","12","5","1","60:00","0","0"]` |

Time columns (`timeOnIce` etc.) arrive as `"18:14"` — **not numeric**.
`ytdGoals` is a season-to-date column inside a single game's row.

### 1d. Athlete identity fields

Counted over **every** athlete line in the fixtures of 1a (not a sample).

| comp | athlete lines | `athlete.id` present | `athlete.displayName` present | `athlete.shortName` present | `athlete.position.abbreviation` present | `athlete` object keys |
| --- | --- | --- | --- | --- | --- | --- |
| nfl | 84 | 84 | 84 | **0** | **0** | `["id","uid","guid","firstName","lastName","displayName","links","headshot","jersey"]` |
| ncaaf | 81 | 81 | 81 | **0** | **0** | same as NFL |
| nba | 30 | 30 | 30 | 30 | 30 | `["id","uid","guid","displayName","shortName","links","headshot","jersey","position"]` |
| mlb | 30 | 30 | 30 | 30 | 30 | `["id","uid","guid","displayName","shortName","links","headshot","position","positions","hotZones"]` (no `jersey`; batting line carries `position` again at line level plus `batOrder`) |
| nhl | 38 | 38 | 38 | 38 | 38 | `["id","uid","guid","lastName","displayName","shortName","links","headshot","jersey","position","active","scratched"]` — `position` is a `$ref` object that also inlines `id`/`name`/`abbreviation` |
| epl / laliga / ucl | n/a in `boxscore.players` | — | — | — | — | see 1e |

**Football (NFL/NCAAF) box scores carry no position and no `shortName` at all**
— `lib/providers/espn/boxscore.ts` reads both and will get `null` for every NFL
and NCAAF athlete.

Team pseudo-athletes exist in NCAAF: event 401856674 carries
`{"id":"-6315","uid":"s:20~l:23~a:-6315","firstName":"","lastName":"Team","displayName":" Team","links":[]}`
in the `passing` group with `stats: ["0/1","0","0.0","0","0","--"]`, and a second
one (`id "-5154"`) in `fumbles`. **Negative id, leading-space display name.**

### 1e. Football (soccer) — what there is instead

`boxscore.players` is `null` for all three soccer competitions. Per-player data
exists, in `rosters[].roster[].stats`, as an array of objects
(`{name, displayName, shortDisplayName, description, abbreviation, value, displayValue}`)
rather than a positional `stats` array.

| comp | `rosters` length | players total | players with a non-empty `stats` array | starters per side | `formation` present | distinct stat `name` values |
| --- | --- | --- | --- | --- | --- | --- |
| epl (401879282) | 2 | 40 (20 + 20) | 40 | 11 / 11 | `"3-4-2-1"`, `"4-2-3-1"` | 15 |
| laliga (401882885) | 2 | 44 (23 + 21) | 44 | 11 / 11 | `"3-4-3"`, `"4-1-4-1"` | 15 |
| ucl (401915444) | 2 | 44 (22 + 22) | 44 | 11 / 11 | `"4-3-3"`, `"3-4-2-1"` | 15 |

The 15 names, identical in all three competitions:
`appearances`, `foulsCommitted`, `foulsSuffered`, `ownGoals`, `redCards`,
`subIns`, `yellowCards`, `goalsConceded`, `saves`, `shotsFaced`, `goalAssists`,
`shotsOnTarget`, `totalGoals`, `totalShots`, `offsides`.

Answering the specific question: **shots = `totalShots`, shots on target =
`shotsOnTarget`, goals = `totalGoals`, assists = `goalAssists` — all four are
present, per player, per match.** There is **no minutes-played stat** and no
passes/touches/tackles/dribbles.

An outfield player carries 14 of the 15 (no `saves`); a goalkeeper carries all
15. Roster entry keys:
`["active","starter","jersey","athlete","position","subbedIn","subbedOut","formationPlace","media","stats"]`.
Verbatim outfield example (Bobby Thomas, id 303931, CD, EPL):
`appearances 1, foulsCommitted 1, foulsSuffered 2, ownGoals 0, redCards 0, subIns 0, yellowCards 0, goalsConceded 5, shotsFaced 0, goalAssists 0, offsides 0, shotsOnTarget 0, totalGoals 0, totalShots 3`.

`boxscore.teams[].statistics` for soccer is team-level only, e.g.
`[{"name":"foulsCommitted","displayValue":"9","label":"Fouls"},{"name":"yellowCards","displayValue":"0","label":"Yellow Cards"},{"name":"redCards","displayValue":"1","label":"Red Cards"},{"name":"offsides","displayValue":"2","label":"Offsides"},{"name":"wonCorners","displayValue":"5","label":"Corner Kicks"},{"name":"saves","displayValue":"2","label":"Saves"}]`.

### 1f. Composite columns

Observed, verbatim key → verbatim value:

| comp | key | example value | separator |
| --- | --- | --- | --- |
| nfl / ncaaf | `completions/passingAttempts` | `"23/28"` | `/` |
| nfl | `sacks-sackYardsLost` | `"4-23"` | `-` |
| nfl / ncaaf | `fieldGoalsMade/fieldGoalAttempts` | `"2/2"` | `/` |
| nfl / ncaaf | `extraPointsMade/extraPointAttempts` | `"3/3"` | `/` |
| nba | `fieldGoalsMade-fieldGoalsAttempted` | `"2-9"` | `-` |
| nba | `threePointFieldGoalsMade-threePointFieldGoalsAttempted` | `"1-7"` | `-` |
| nba | `freeThrowsMade-freeThrowsAttempted` | `"0-0"` | `-` |
| mlb | `hits-atBats` | `"1-4"` | `-` |
| mlb | `pitches-strikes` | `"68-53"` | `-` |
| mlb | `fullInnings.partInnings` | `"6.1"` | **`.` — a separator `splitStatColumn` does not handle; the value parses as the number 6.1, which is not 6⅓ innings** |
| nhl | — | none observed | — |
| soccer | — | none; soccer stats are one named object per value | — |

Also note `plusMinus` in the NBA arrives signed as a string: `"-4"`, `"+1"`.
`Number("+1")` is 1, so it parses, but the raw text is not bare digits.

### 1g. How "did not record a stat" is represented

Counted across whole slates, not a single game.

| comp | slate scanned | games | athlete lines | lines with `stats: []` | `"-"` / `"--"` / `""` / `null` inside an athlete's `stats` |
| --- | --- | --- | --- | --- | --- |
| nfl | 20260913 | 10 | 847 | 0 | `"--"` × 1, in the `adjQBR` column only |
| ncaaf | 20260912 | 10 | 913 | 0 | `"--"` × 6, in the `adjQBR` column only (verified by column index) |
| nba | 20260405 | 8 | 211 | **43** | none |
| mlb | 20260905 | 8 | 234 | 0 | none |
| nhl | 20260609 | 1 | 38 | 0 | none |

So, by competition:

- **NFL / NCAAF / MLB / NHL**: a player who did not record anything in a
  category is simply **absent from that group** — there is no `"-"` row. The
  only placeholder observed at athlete level is `"--"` for `adjQBR`. (`"--"`
  and `""` do also appear in a group's `totals` array: NFL passing totals
  `["23/28","193","7.7","0","0","4-23","--","98.8"]`, NBA totals
  `["","106","36-86",...,"21",""]`.)
- **NBA**: an inactive player is present with `didNotPlay: true`,
  `active: false`, `starter: false`, `reason: "COACH'S DECISION"` and
  **`stats: []`** — an empty array, 43 of 211 lines across 8 games.
- **Soccer**: an unused substitute is present with `active: true`,
  `subbedIn: false` and a full stats array of zeros including
  `appearances: 0` — e.g. Loum Tchaouna, EPL 401879282. A substitute who played
  carries `appearances: 1, subIns: 1`. So "did not play" in soccer is
  `appearances === 0`, not an absent row.

The comment in `lib/providers/espn/boxscore.ts` that "the provider writes `-`
for a column that does not apply to a player" was **not reproduced** on any of
these 2,243 athlete lines; `"--"` for `adjQBR` is the only case, and the
existing `statValue` already handles it.

---

## Probe 2 — per-athlete gamelog

Endpoint: `https://site.web.api.espn.com/apis/common/v3/sports/<sport>/<league>/athletes/<athleteId>/gamelog`

### 2a. Plain request (no query params)

| comp | athlete used | HTTP | bytes | `seasonTypes` entries | `seasonTypes[].displayName` | game rows | rows in `events` map | date range of those rows |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| nfl | 3052587 Baker Mayfield | 200 | 21,567 | 1 | `2026 Regular Season` | **2** | 2 | 2026-09-13 → 2026-09-20 |
| nba | 4592479 Julian Champagnie | 200 | 1,063,626 | 3 | `2025-26 Postseason`, `2025-26 Regular Season`, `2025-26 Preseason` | **111** | 111 | 2025-10-07 → 2026-06-14 |
| mlb | 33481 Yandy Diaz | 200 | 1,348,538 | 1 | `2026 Regular Season` | **150** | 150 | 2026-03-26 → 2026-09-20 |
| nhl | 3904173 Sebastian Aho | 200 | 876,570 | 2 | `2025-26 Postseason`, `2025-26 Regular Season` | **98** | 98 | 2025-10-09 → 2026-06-15 |
| ncaaf | 5079712 Julian Sayin | 200 | 25,747 | 1 | `2026 Regular Season` | **3** | 3 | 2026-09-05 → 2026-09-19 |
| epl | 303931 Bobby Thomas | 200 | 44,800 | 1 | `2026-27 English Premier League` | **5** | 5 | 2026-08-21 → 2026-09-19 |
| laliga | 384643 Yoel Lago | 200 | 59,646 | 1 | `2026-27 LALIGA` | **7** | 7 | 2026-08-22 → 2026-09-19 |
| ucl | 159248 Nathan Aké (Fenerbahce) | 200 | 52,001 | 1 | `2026-27 Turkish Super Lig` | **6** | 6 | 2026-08-15 → 2026-09-20 |

**Every competition returns 200. A plain request serves exactly one season — the
current one.** In September that is 2 games for an NFL quarterback and 3 for a
college one, which is the problem `boxscore.ts` describes.

### 2b. Does each game row carry a date and a game id?

Yes, for every competition tested. The row itself
(`seasonTypes[].categories[].events[]`) carries `eventId` plus a positional
`stats` array; the date lives in the sibling `events` map keyed by that id.

NFL row verbatim: `eventId "401872935"`, `stats` length 16,
first 12 values `["21","34","182","61.8","5.4","1","1","49","3","73.4","53.1","4"]`.
Its `events["401872935"]` entry keys:
`["id","links","week","atVs","gameDate","score","homeTeamId","awayTeamId","homeTeamScore","awayTeamScore","gameResult","opponent","leagueName","leagueAbbreviation","leagueShortName","team"]`
with `gameDate: "2026-09-20T17:00:00.000+00:00"` and `id: "401872935"`.
NBA/NHL entries additionally carry `eventNote`; NHL also `type`; NFL/NCAAF also
`week`. MLB/NBA/NHL carry no `week`.

### 2c. **Does `?season=YYYY` serve a past season? Yes.**

This is the decisive result and it **contradicts the comment currently in
`lib/providers/espn/boxscore.ts`** ("Asked for an earlier season it returns
nothing").

| comp | athlete | `?season=2025` status | season returned | game rows | date range | `?season=2024` status | game rows |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nfl | 3052587 | 200 | `2025 Regular Season` | **17** | 2025-09-07 → 2026-01-03 | 200 | **18** (`2024 Postseason` + `2024 Regular Season`) |
| nba | 4592479 | 200 | `2024-25 Regular Season` + `2024-25 Preseason` | **87** | 2024-10-08 → 2025-04-13 | 200 | **79** (`2023-24`) |
| mlb | 33481 | 200 | `2025 Regular Season` | **150** | 2025-03-28 → 2025-09-27 | 200 | **145** |
| nhl | 3904173 | 200 | `2024-25 Postseason` + `2024-25 Regular Season` | **97** | 2024-10-11 → 2025-05-29 | 200 | **90** (`2023-24`) |
| ncaaf | 5079712 | 200 | `2025 Postseason` + `2025 Regular Season` | **14** | 2025-08-30 → 2026-01-01 | 200 | **4** |
| laliga | 384643 | 200 | `2025-26 LALIGA` | **29** | 2025-08-17 → 2026-05-23 | not tested | — |
| ucl | 159248 | 200 | **none — `seasonTypes: []`, 0 game rows, 902-byte body** | 0 | — | not tested | — |

The value is the **season-ending year** for the winter sports: `season=2025`
returns the NBA's 2024-25 and the NHL's 2024-25.

The response advertises which seasons it will serve, in `filters[]` (a `season`
filter with an `options` array). Observed option lists:

| comp | athlete | season options offered |
| --- | --- | --- |
| nfl | 3052587 | 2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018 (9) |
| nba | 4592479 | 2026 (`2025-26`), 2025, 2024, 2023 (4) |
| mlb | 33481 | 2026 … 2017 (10) |
| nhl | 3904173 | 2026 (`2025-26`) … 2017 (`2016-17`) (10) |
| ncaaf | 5079712 | 2026, 2025, 2024 (3) |
| epl | 303931 | 2026 (`2026-27`), 2021, 2020, 2019 — **non-contiguous** (4) |
| laliga | 384643 | 2026, 2025, 2024, 2023 (4) |
| ucl | 159248 | **2026 only** (1) |

The option list is **per athlete**, not per league: it reflects the seasons that
athlete has in that competition. MLB also exposes a second filter,
`category`, with options `batting` and `pitching`.

### 2d. MLB pitcher gamelog (what `lib/providers/espn/pitchers.ts` depends on)

| request | HTTP | `names` | seasons returned | starts/appearances |
| --- | --- | --- | --- | --- |
| `.../baseball/mlb/athletes/33372/gamelog` | 200 | `["innings","hits","runs","earnedRuns","homeRuns","walks","strikeouts","groundBalls","flyBalls","pitches","battersFaced","avgGameScore","wins-losses","saves-blownSaves-holds","ERA"]` | `2026 Regular Season` | 30 (2026-03-30 → 2026-09-16) |
| `…?category=pitching` | 200 | identical | identical | 30 |
| `…?season=2025&category=pitching` | 200 | identical | `2025 Postseason` + `2025 Regular Season` | **41** (2025-03-30 → 2025-10-02) |

So `innings` and `runs` — the two indices `fetchStarts` looks up — are present,
and a **past season is retrievable for a pitcher too**.

### 2e. Soccer gamelog caveat

`names` for soccer: `["totalGoals","goalAssists","totalShots","shotsOnTarget","foulsCommitted","foulsSuffered","offsides","yellowCards","redCards"]` (9).

The **league segment in the path is ignored**. Athlete 303931 was requested
three ways and all three returned byte-identical EPL data:

| request | HTTP | bytes | season returned | `events[].leagueName` values |
| --- | --- | --- | --- | --- |
| `soccer/eng.1/athletes/303931/gamelog` | 200 | 44,800 | `2026-27 English Premier League` | `["English Premier League"]` |
| `soccer/esp.1/athletes/303931/gamelog` | 200 | 44,800 | `2026-27 English Premier League` | `["English Premier League"]` |
| `soccer/uefa.champions/athletes/303931/gamelog` | 200 | 44,800 | `2026-27 English Premier League` | `["English Premier League"]` |

And a UCL fixture's athlete returns his **domestic** league, not the UCL:
`soccer/uefa.champions/athletes/159248/gamelog` → `2026-27 Turkish Super Lig`,
6 rows, all `leagueName: "Turkish Super Lig"`. **There is no way observed to ask
this endpoint for a player's Champions League matches.**

---

## Probe 3 — participation evidence (nfl, nba, mlb, nhl)

### 3a. The upcoming fixture each was measured on

| comp | first pre-game fixture found walking forward from 2026-09-23 | days ahead | event id | fixture | `status.type.name` | summary HTTP | bytes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| nfl | 20260924 | 1 | 401872948 | Atlanta Falcons at Green Bay Packers | `STATUS_SCHEDULED` | 200 | 123,263 |
| nba | 20261003 | 10 | 401902644 | Miami Heat at Toronto Raptors | `STATUS_SCHEDULED` | 200 | 98,459 |
| mlb | 20260923 | 0 | 401817051 | Washington Nationals at Detroit Tigers | `STATUS_SCHEDULED` | 200 | 220,161 |
| nhl | 20260923 | 0 | 401879650 | Toronto Maple Leafs at Ottawa Senators | `STATUS_SCHEDULED` | 200 | 86,921 |

### 3b. `injuries` on an upcoming fixture's summary

Present in all four, as an array of two sides, each
`{team: {...}, injuries: [...]}`.

| comp | `injuries` present | sides | entries per side |
| --- | --- | --- | --- |
| nfl | yes | 2 | **5, 5** |
| nba | yes | 2 | **4, 5** |
| mlb | yes | 2 | **5, 5** |
| nhl | yes | 2 | **4, 3** |

Entry keys: `["status","date","athlete","type","details"]`. Verbatim NFL entry
(Green Bay): `status "Doubtful"`, `athlete.id "4362249"`,
`athlete.displayName "Jayden Reed"`, `athlete.position.abbreviation "WR"`,
`type {"id":"3","name":"INJURY_STATUS_DOUBTFUL","description":"doubtful","abbreviation":"D"}`,
`details {"fantasyStatus":{...},"type":"Neck","location":"Head","detail":"Not Specified","side":"Not Specified","returnDate":"2026-09-24"}`.

Status vocabulary observed: NFL `Doubtful`, `Questionable`, `Injured Reserve`;
NBA/NHL `Day-To-Day`, `Out`; MLB `10-Day-IL`, `15-Day-IL`, `60-Day-IL`.

**The list looks capped at 5 per side.** Surveyed the whole NFL slate of
2026-09-27 — 12 fixtures, 24 sides: 23 sides returned exactly 5 and one
returned 3. No side anywhere in this probe returned more than 5.

### 3c. MLB `probables`

| where | result |
| --- | --- |
| `summary?event=401817051` top-level `probables` | **absent** — the key does not exist on the summary payload for any of the four leagues |
| scoreboard `events[].competitions[0].competitors[].probables` | **present** — this is where `lib/providers/espn/pitchers.ts` already reads it |

Verbatim from the scoreboard for 401817051: home (team 6, DET)
`probables` length 1, `name "probableStartingPitcher"`,
`athlete.id "36581"`, `athlete.displayName "Framber Valdez"`; away (team 20, WSH)
`probables` **absent**.

Coverage surveyed across full slates:

| comp | date | pre-game fixtures | both sides have `probables` | one side | neither | `probables[].name` values seen |
| --- | --- | --- | --- | --- | --- | --- |
| mlb | 20260924 | 12 | **7** | **5** | 0 | `probableStartingPitcher` |
| nhl | 20260924 | 11 | **11** | 0 | 0 | `probableStartingGoalie` |
| nfl | 20260927 | 14 | 0 | 0 | **14** | none |
| nba | 20261003 | 1 | 0 | 0 | **1** | none |

### 3d. `<sport>/<league>/teams/<teamId>/depthchart`

| comp | request | HTTP | bytes | body |
| --- | --- | --- | --- | --- |
| nfl | `football/nfl/teams/4/depthchart` | **200** | **2** | **`{}`** |
| nba | `basketball/nba/teams/18/depthchart` | **200** | **2** | **`{}`** |
| mlb | `baseball/mlb/teams/15/depthchart` | **200** | **2** | **`{}`** |
| nhl | `hockey/nhl/teams/37/depthchart` | **200** | **2** | **`{}`** |

The team ids are valid — `football/nfl/teams/4` → 200 "Cincinnati Bengals",
`basketball/nba/teams/18` → 200 "New York Knicks",
`baseball/mlb/teams/15` → 200 "Atlanta Braves",
`hockey/nhl/teams/37` → 200 "Vegas Golden Knights". So the empty object is the
endpoint's answer, not a bad id.

Cross-check on a **different** path (recorded for completeness, clearly not the
path asked about): `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/4/depthcharts`
→ **200, 19,126 bytes**, `{"count":3,"pageIndex":1,"pageSize":25,"pageCount":1,"items":[{"id":"16","name":"Base 4-3 D","positions":{"lde":{...`.
Same for `baseball/leagues/mlb/seasons/2026/teams/15/depthcharts` → 200,
13,143 bytes, `count 1`, `items[0].name "Depth Chart"`. Positions are `$ref`
objects, so resolving athletes would cost further requests — not measured.

### 3e. Lineup / starters keys before kick-off

| key | nfl 401872948 | nba 401902644 | mlb 401817051 | nhl 401879650 |
| --- | --- | --- | --- | --- |
| `boxscore` keys | `["teams"]` | `["teams"]` | `["teams","players"]` | `["teams"]` |
| `boxscore.players` | **`null`** | **`null`** | present, 2 teams, **2 groups each, 0 athletes in every group** | **`null`** |
| `rosters` | absent | absent | present, length 2, each entry keys **`["homeAway","team"]` only — no `roster` array** | absent |
| `lineups` | absent | absent | absent | absent |
| `lineup` | absent | absent | absent | absent |
| `starters` | absent | absent | absent | absent |
| `battingOrder` | absent | absent | absent | absent |
| `goalies` | absent | absent | absent | **present** — `{"homeTeam":{"teamId":"14","athletes":[]},"awayTeam":{"teamId":"21","athletes":[{"id":"4697577","displayName":"Artur Akhtyamov",…}]}}` (home side empty, away side 1 athlete) |
| `predictor` | present (`["header","homeTeam","awayTeam"]`) | absent | present | absent |
| `leaders` | present, length 2 | present, length 2 | present, length 2 | present, length 2 |
| `odds` | present but **length 0** | length 0 | length 0 | length 0 |
| `gameInfo` | `["venue","weather"]` | `["venue"]` | `["venue","weather"]` | `["venue","officials"]` |

Full top-level key lists for the upcoming fixtures:

- nfl: `["boxscore","format","gameInfo","lastFiveGames","leaders","injuries","broadcasts","pickcenter","odds","againstTheSpread","news","predictor","winprobability","header","videos","wallclockAvailable","ticketsInfo","meta","standings"]`
- nba: `["boxscore","format","gameInfo","lastFiveGames","leaders","seasonseries","injuries","broadcasts","pickcenter","odds","againstTheSpread","winprobability","news","header","videos","wallclockAvailable","ticketsInfo","meta","standings"]`
- mlb: `["notes","boxscore","format","gameInfo","lastFiveGames","predictor","leaders","seasonseries","injuries","broadcasts","pickcenter","odds","againstTheSpread","rosters","winprobability","news","header","ticketsInfo","videos","wallclockAvailable","meta","standings"]`
- nhl: `["boxscore","format","gameInfo","goalies","lastFiveGames","leaders","injuries","broadcasts","pickcenter","odds","againstTheSpread","news","header","wallclockAvailable","meta","standings"]`

**Conclusion for probe 3:** there is **no starting lineup published before
kick-off** for any of the four. What exists is: an injury list capped at 5 per
side, a single announced starter per side for MLB (pitcher) and NHL (goalie) on
the *scoreboard* payload, and nothing at all for NFL and NBA beyond injuries.

---

## Could not determine

| question | why |
| --- | --- |
| Whether the 5-per-side `injuries` cap is documented or has a paging parameter | no parameter was tried; only the observation that 23 of 24 NFL sides returned exactly 5 and one returned 3 |
| Whether a soccer competition's own gamelog (e.g. a player's UCL matches only) can be requested at all | every path variant tried returned the athlete's domestic league; `?season=2025` for the UCL athlete returned an empty 902-byte body (HTTP 200) |
| Whether the core-API `depthcharts` items resolve to athletes | positions are `$ref` URLs; following them was out of scope |
| NBA `"-"` placeholder behaviour on a mid-season slate with partial stat lines | 20260604 returned 0 completed events; the scan used 20260405 (8 games, 211 lines) instead |

## Requests that failed

None. Every request made in this probe returned HTTP 200. The two "empty"
results — `depthchart` and the soccer `?season=2025` — were 200 responses with
`{}` and an empty payload respectively, not errors.
