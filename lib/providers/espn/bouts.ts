/**
 * MMA cards, normalised into the shared fixture shape.
 *
 * A UFC event is a *card*, and the thing being projected is a single fight on
 * it. So one payload event becomes many `Game`s — the opposite of the team
 * sports, where one event is one fixture, and the same relationship a race
 * weekend has to its sessions.
 *
 * **A fight has two sides and no score.** The provider gives a `winner`
 * boolean per competitor and nothing to add up, so `score` is left absent and
 * `winner` carries the result. Writing it as 1-0 would invent a scoreline the
 * sport does not have, and would let anything reading `score` treat a fight as
 * a one-nil football match.
 *
 * What the feed carries, verified 2026-09-10 against 2019-2025:
 *
 *   competitors[].id      the athlete, with `uid` of the form `s:3301~a:<id>`.
 *                         Checked for stability across cards rather than
 *                         assumed -- 168 fighters over two months, none with
 *                         more than one id.
 *   competitors[].winner  a boolean, absent from both sides on a draw
 *   type.abbreviation     the weight class, e.g. "Lightweight"
 *   format.regulation     scheduled rounds, 3 or 5
 *
 * What it does not carry: **method of victory**. `status.type.detail` is the
 * bare string "Final" on every completed fight. A decision can be told from a
 * finish, because `linescores` holds the judges' cards and is null when nobody
 * needed them, but KO/TKO cannot be told from submission. Nothing here invents
 * that distinction.
 */

import { espnGameId, statusFromEspn } from './fixture-normalise.ts';
import type { Game, Team } from '../../home/types';
import type { League } from '../../leagues/registry';

interface RawCompetitor {
  id?: unknown;
  winner?: unknown;
  order?: unknown;
  athlete?: { displayName?: unknown; fullName?: unknown; shortName?: unknown; flag?: unknown };
  linescores?: unknown;
}

interface RawFight {
  id?: unknown;
  date?: unknown;
  competitors?: RawCompetitor[];
  status?: { type?: { name?: unknown; state?: unknown; shortDetail?: unknown; completed?: unknown } };
  type?: { abbreviation?: unknown; text?: unknown };
  format?: { regulation?: { periods?: unknown } };
}

interface RawCard {
  id?: unknown;
  name?: unknown;
  shortName?: unknown;
  date?: unknown;
  season?: { year?: unknown };
  competitions?: RawFight[];
  venue?: { fullName?: unknown; address?: { city?: unknown; country?: unknown } };
}

export interface RawBoutResponse {
  events?: RawCard[] | null;
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
 * A fighter is not a team, but the shared shape is what every fixture-shaped
 * consumer already reads, and a person fills it honestly: they have a stable
 * id and a name. Nothing pretends there is a squad behind it.
 */
function fighter(competitor: RawCompetitor): Team | null {
  const id = str(competitor.id);
  const name =
    str(competitor.athlete?.displayName) ??
    str(competitor.athlete?.fullName) ??
    str(competitor.athlete?.shortName);
  if (!id || !name) return null;
  return { id, name, logo: null };
}

/**
 * Which side won, or null.
 *
 * Null covers a draw and a no-contest alike, and both are real outcomes rather
 * than missing data. Neither is a win for anyone, and settlement treats them
 * the same way it treats a cancelled fixture.
 */
function winnerOf(home: RawCompetitor, away: RawCompetitor): 'home' | 'away' | null {
  if (home.winner === true) return 'home';
  if (away.winner === true) return 'away';
  return null;
}

function normaliseFight(card: RawCard, fight: RawFight, league: League): Game | null {
  const competitors = fight.competitors ?? [];
  if (competitors.length !== 2) return null;

  /*
   * `order` 1 is listed first on the card. There is no home side in a fight,
   * so this is presentation order and nothing more -- the model must not read
   * a venue advantage into it, and the bout config carries no home advantage
   * precisely so it cannot.
   */
  const ordered = [...competitors].sort(
    (a, b) => Number(a.order ?? 0) - Number(b.order ?? 0),
  );
  const home = fighter(ordered[0]);
  const away = fighter(ordered[1]);
  if (!home || !away || home.id === away.id) return null;

  const id = str(fight.id);
  if (!id) return null;

  const startTime = str(fight.date) ?? str(card.date);
  const parsed = startTime ? new Date(startTime) : null;

  const rounds = Number(fight.format?.regulation?.periods);

  return {
    id: espnGameId(league.id, id),
    sport: league.sport,
    league: league.label,
    league_badge: null,
    season: str(card.season?.year),
    round: null,
    start_time: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    status: statusFromEspn(fight.status?.type),
    provider_status: str(fight.status?.type?.shortDetail) ?? str(fight.status?.type?.name),
    home_team: home,
    away_team: away,
    // Deliberately no `score`. See the module comment.
    winner: winnerOf(ordered[0], ordered[1]),
    division: str(fight.type?.abbreviation) ?? str(fight.type?.text),
    scheduledRounds: Number.isFinite(rounds) && rounds > 0 ? rounds : null,
    // The card's venue, which every fight on it shares.
    venue: {
      name: str(card.venue?.fullName),
      city: str(card.venue?.address?.city),
      country: str(card.venue?.address?.country),
      // Not published on this path, and treated as covered so no weather
      // adjustment can apply -- which is right anyway, since MMA is indoors.
      indoor: null,
    },
    broadcast: null,
    // The card's own name, so a fight can say which event it belongs to.
    title: str(card.name) ?? str(card.shortName),
  };
}

/** Every fight across every card in a scoreboard payload. */
export function normaliseBoutFixtures(payload: RawBoutResponse, league: League): Game[] {
  const games: Game[] = [];

  for (const card of payload.events ?? []) {
    for (const fight of card.competitions ?? []) {
      const game = normaliseFight(card, fight, league);
      if (game) games.push(game);
    }
  }

  return games;
}
