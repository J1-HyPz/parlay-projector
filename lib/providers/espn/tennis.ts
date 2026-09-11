/**
 * Tennis draws, normalised into the shared fixture shape.
 *
 * A tennis event is a *tournament*, and the thing being projected is a single
 * match inside it. The matches are two levels down — `groupings` splits a
 * tournament into its draws (`mens-singles`, `womens-doubles` and so on) and
 * each grouping holds the matches. So one payload event becomes many `Game`s,
 * the same relationship a fight card has to its fights.
 *
 * **Singles only, and the check is structural rather than by name.** A doubles
 * competitor has no `athlete` at all — it has a `roster` holding two of them —
 * so a pair can never be mistaken for a person and slipped into an individual
 * rating. The grouping slug is used to pick the draw, and the absence of
 * `athlete` is what actually rejects a pair.
 *
 * What the feed carries, verified 2026-09-11 across 2019-2025:
 *
 *   competitors[].id       the player. Checked for stability rather than
 *                          assumed — 588 players across 1,902 singles matches,
 *                          none carrying more than one id.
 *   competitors[].winner   a boolean
 *   competitors[].linescores  GAMES per set, not sets won: a 6-1 6-2 win reads
 *                          as [{value:6},{value:6}] against [{value:1},{value:2}]
 *   status.type.name       STATUS_FINAL, STATUS_RETIRED or STATUS_WALKOVER
 *   round.displayName      "Round 1", "Qualifying 1st Round", "Final"
 *
 * **Retirements and walkovers are distinguishable, and that matters.** §4.8.b
 * requires a retired match to settle as void rather than as a loss for the
 * player who stopped, and unlike F1's missing DNF flag this feed does say so:
 * 79 retirements and 9 walkovers in a single quarter. They are marked with
 * `completion` and carried through rather than flattened into an ordinary win.
 *
 * **There is no surface anywhere in the payload.** A tournament carries a city
 * name and nothing else — no `surface` field, and across an entire quarter's
 * payload the word appears zero times. §4.8.a step 8's surface-specific rating
 * component therefore cannot be built at all, and is dropped rather than
 * guessed at from a tournament's name or its place in the calendar.
 */

import { espnGameId, statusFromEspn } from './fixture-normalise.ts';
import type { Game, Team } from '../../home/types';
import type { League } from '../../leagues/registry';

interface RawPlayer {
  id?: unknown;
  winner?: unknown;
  order?: unknown;
  athlete?: { displayName?: unknown; fullName?: unknown; shortName?: unknown } | null;
  roster?: unknown;
  linescores?: { value?: unknown }[] | null;
}

interface RawMatch {
  id?: unknown;
  date?: unknown;
  competitors?: RawPlayer[];
  status?: { type?: { name?: unknown; state?: unknown; shortDetail?: unknown; completed?: unknown } };
  round?: { displayName?: unknown };
  notes?: { text?: unknown }[] | null;
}

interface RawGrouping {
  grouping?: { slug?: unknown };
  competitions?: RawMatch[] | null;
}

interface RawTournament {
  id?: unknown;
  name?: unknown;
  shortName?: unknown;
  date?: unknown;
  season?: { year?: unknown };
  groupings?: RawGrouping[] | null;
  venue?: { displayName?: unknown } | null;
}

export interface RawTennisResponse {
  events?: RawTournament[] | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * One competitor as a `Team`.
 *
 * Null for a doubles pair, which has a `roster` rather than an `athlete`. That
 * is the structural guard: a pair is not an individual and must never reach a
 * rating keyed on one person.
 *
 * Null again for an unfilled draw slot, and that guard matters more than it
 * looks. A tournament that has not started is published as its **whole empty
 * bracket** — 64 first-round slots, 32 second-round, and so on down to the
 * final — every one of them "TBD v TBD". Measured 2026-09-11: of 249 upcoming
 * ATP matches in the forward window, 247 were these. Left in, they would put
 * rows naming nobody on the Schedule, and a slate of them would be reported as
 * matches the model declined for want of history, which is not why.
 *
 * Structural rather than by name, as the doubles guard is: the provider gives
 * a placeholder a **negative** id (`-3` and `-4`, the same pair in every slot
 * of every tournament), where a real player's id is a positive number.
 * Matching on the string "TBD" would be one translation away from breaking.
 */
function player(competitor: RawPlayer): Team | null {
  if (!competitor.athlete) return null;
  const id = str(competitor.id);
  const name =
    str(competitor.athlete.displayName) ??
    str(competitor.athlete.fullName) ??
    str(competitor.athlete.shortName);
  if (!id || !name) return null;
  if (!(Number(id) > 0)) return null;
  return { id, name, logo: null };
}

/** Games won per set, in order. Empty when the provider gave none. */
function gamesPerSet(competitor: RawPlayer): number[] {
  return (competitor.linescores ?? [])
    .map((set) => Number(set?.value))
    .filter((value) => Number.isFinite(value));
}

function completionOf(statusName: string | null): Game['completion'] {
  if (statusName === 'STATUS_RETIRED') return 'retired';
  if (statusName === 'STATUS_WALKOVER') return 'walkover';
  return 'played';
}

function normaliseMatch(
  tournament: RawTournament,
  match: RawMatch,
  league: League,
): Game | null {
  const competitors = match.competitors ?? [];
  if (competitors.length !== 2) return null;

  /*
   * `order` is the draw position, not a home advantage. Neither player is at
   * home in tennis, and the config carries no home advantage precisely so this
   * cannot be read as one.
   */
  const ordered = [...competitors].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  const home = player(ordered[0]);
  const away = player(ordered[1]);
  if (!home || !away || home.id === away.id) return null;

  const id = str(match.id);
  if (!id) return null;

  const startTime = str(match.date) ?? str(tournament.date);
  const parsed = startTime ? new Date(startTime) : null;
  const statusName = str(match.status?.type?.name);

  const winner: 'home' | 'away' | null =
    ordered[0].winner === true ? 'home' : ordered[1].winner === true ? 'away' : null;

  /*
   * A retirement and a walkover are over.
   *
   * The shared status mapper does not know these two names -- they are tennis
   * concepts -- and only reached `finished` for them via the `state` field
   * that live payloads happen to carry alongside. Resting on that would mean a
   * retirement silently became an `unknown` fixture the moment the provider
   * trimmed a field, and 41 of 846 matches in a single quarter are one of
   * these. Said outright instead.
   */
  const completion = completionOf(statusName);
  const status =
    completion === 'played' ? statusFromEspn(match.status?.type) : ('finished' as const);

  return {
    id: espnGameId(league.id, id),
    sport: league.sport,
    league: league.label,
    league_badge: null,
    season: str(tournament.season?.year),
    round: str(match.round?.displayName),
    start_time: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    status,
    provider_status: str(match.status?.type?.shortDetail) ?? statusName,
    home_team: home,
    away_team: away,
    /*
     * No `score`. A tennis match has a score, but it is a set-and-game
     * structure rather than one number per side, and `Score` is two numbers.
     * Flattening it to sets-won would throw away the games the total-games
     * market will need, and flattening it to total games would read as a
     * scoreline nobody recognises. `setGames` carries it whole instead.
     */
    winner,
    completion,
    setGames: { home: gamesPerSet(ordered[0]), away: gamesPerSet(ordered[1]) },
    venue: {
      name: str(tournament.venue?.displayName),
      city: str(tournament.venue?.displayName),
      country: null,
      // Not published, and treated as covered so no weather adjustment applies.
      indoor: null,
    },
    broadcast: null,
    title: str(tournament.name) ?? str(tournament.shortName),
  };
}

/**
 * Every singles match in a scoreboard payload, for one tour's draw.
 *
 * `draw` picks which grouping to read. The two tours are genuinely separate
 * feeds — of 46 tournaments in one quarter only 7 appear in both, and those 7
 * are the combined events, which carry both draws in either feed. Measured
 * rather than assumed: every men's singles match appears in the ATP feed and
 * every women's in the WTA feed, so each tour reads its own feed alone and
 * nothing has to be merged or de-duplicated across them.
 */
export function normaliseTennisFixtures(
  payload: RawTennisResponse,
  league: League,
  draw: string,
): Game[] {
  const games: Game[] = [];

  for (const tournament of payload.events ?? []) {
    for (const grouping of tournament.groupings ?? []) {
      if (str(grouping.grouping?.slug) !== draw) continue;
      for (const match of grouping.competitions ?? []) {
        const game = normaliseMatch(tournament, match, league);
        if (game) games.push(game);
      }
    }
  }

  return games;
}
