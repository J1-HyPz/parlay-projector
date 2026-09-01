/**
 * ESPN fixtures adapter.
 *
 * Why this exists: TheSportsDB's day feed returns **no NFL games at all** —
 * only NCAA Division 1 and CFL appear under "American Football" — so an NFL
 * filter correctly matched nothing and the league looked empty. ESPN has them.
 *
 * It is also cheaper. ESPN accepts `dates=YYYYMMDD-YYYYMMDD`, so one request
 * covers a league's whole eight-day window. Fifteen leagues cost fifteen
 * requests, against the forty-eight the per-sport-per-day approach needed.
 *
 * Game ids are namespaced `espn-<id>` so they never collide with the primary
 * provider's ids and the detail route can dispatch on the prefix. Existing
 * bare-numeric links keep working.
 */

import { cached } from '../../cache';
import { espnConfig } from '../../config';
import { logger } from '../../logger';
import type { Game, GameStatus } from '../../home/types';
import type { League } from '../../leagues/registry';
import { fetchEspn } from './client';

/** Prefix marking a game id as ESPN-sourced. */
export const ESPN_ID_PREFIX = 'espn-';

/**
 * Game id format: `espn-<leagueId>-<eventId>`.
 *
 * The league is encoded because an ESPN event id alone does not say which
 * competition it belongs to, and the detail endpoint is per league. Carrying it
 * turns detail into one request instead of probing every league in the
 * catalogue.
 *
 * League ids may themselves contain hyphens (`league-one`), so the event id is
 * taken as the final segment and the league as everything between.
 */
export function espnGameId(leagueId: string, eventId: string): string {
  return `${ESPN_ID_PREFIX}${leagueId}-${eventId}`;
}

export function isEspnGameId(id: string): boolean {
  return id.startsWith(ESPN_ID_PREFIX);
}

export interface ParsedEspnGameId {
  leagueId: string;
  eventId: string;
}

export function parseEspnGameId(gameId: string): ParsedEspnGameId | null {
  if (!isEspnGameId(gameId)) return null;

  const parts = gameId.slice(ESPN_ID_PREFIX.length).split('-');
  const eventId = parts.pop();
  const leagueId = parts.join('-');

  if (!eventId || !leagueId) return null;
  if (!/^[0-9]{1,20}$/.test(eventId)) return null;
  if (!/^[a-z0-9-]{1,32}$/.test(leagueId)) return null;

  return { leagueId, eventId };
}

interface RawStatusType {
  name?: unknown;
  state?: unknown;
  completed?: unknown;
  shortDetail?: unknown;
}

export interface RawFixtureEvent {
  id?: unknown;
  date?: unknown;
  season?: { year?: unknown };
  week?: { number?: unknown };
  status?: { type?: RawStatusType };
  competitions?: ({
    venue?: { fullName?: unknown; address?: { city?: unknown; country?: unknown } };
    broadcasts?: { names?: unknown[] }[];
    competitors?: {
      homeAway?: unknown;
      score?: unknown;
      team?: { id?: unknown; displayName?: unknown; abbreviation?: unknown; logo?: unknown };
    }[];
  } & Record<string, unknown>)[];
}

export interface RawFixtureResponse {
  events?: RawFixtureEvent[] | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Map ESPN's status vocabulary onto the application's.
 *
 * ESPN reports a coarse `state` (pre / in / post) plus a specific `name`, so the
 * specific value is checked first and `state` is the fallback.
 */
export function statusFromEspn(type: RawStatusType | undefined): GameStatus {
  const name = str(type?.name)?.toUpperCase() ?? '';

  if (name.includes('POSTPONED') || name.includes('DELAYED')) return 'postponed';
  if (name.includes('CANCELED') || name.includes('CANCELLED')) return 'cancelled';
  if (name.includes('FINAL') || name.includes('FULL_TIME')) return 'finished';
  if (name.includes('IN_PROGRESS') || name.includes('HALFTIME') || name.includes('END_PERIOD')) {
    return 'live';
  }
  if (name.includes('SCHEDULED') || name.includes('PRE')) return 'scheduled';

  switch (str(type?.state)?.toLowerCase()) {
    case 'pre':
      return 'scheduled';
    case 'in':
      return 'live';
    case 'post':
      return type?.completed === true ? 'finished' : 'unknown';
    default:
      return 'unknown';
  }
}

/** Normalise one ESPN event into the shared game model. */
export function normaliseFixture(raw: RawFixtureEvent, league: League): Game | null {
  if (!raw || typeof raw !== 'object') return null;

  const eventId = str(raw.id);
  if (!eventId) return null;

  const competition = Array.isArray(raw.competitions) ? raw.competitions[0] : undefined;
  const competitors = competition?.competitors ?? [];

  const homeSide = competitors.find((c) => str(c?.homeAway) === 'home');
  const awaySide = competitors.find((c) => str(c?.homeAway) === 'away');

  const homeName = str(homeSide?.team?.displayName);
  const awayName = str(awaySide?.team?.displayName);
  if (!homeName && !awayName) return null;

  const date = str(raw.date);
  const startTime = date ? new Date(date) : null;

  const broadcast = (competition?.broadcasts ?? [])
    .flatMap((entry) => (Array.isArray(entry?.names) ? entry.names : []))
    .map((name) => str(name))
    .find((name): name is string => name !== null);

  const venue = competition?.venue;

  return {
    id: espnGameId(league.id, eventId),
    sport: league.sport,
    // The catalogue label, not the provider's, so the UI is consistent.
    league: league.label,
    league_badge: null,
    season: str(raw.season?.year),
    round: str(raw.week?.number),
    start_time:
      startTime && !Number.isNaN(startTime.getTime()) ? startTime.toISOString() : null,
    status: statusFromEspn(raw.status?.type),
    provider_status: str(raw.status?.type?.shortDetail) ?? str(raw.status?.type?.name),
    home_team: {
      id: str(homeSide?.team?.id),
      name: homeName ?? 'TBC',
      logo: str(homeSide?.team?.logo),
    },
    away_team: {
      id: str(awaySide?.team?.id),
      name: awayName ?? 'TBC',
      logo: str(awaySide?.team?.logo),
    },
    venue: {
      name: str(venue?.fullName),
      city: str(venue?.address?.city),
      country: str(venue?.address?.country),
    },
    broadcast: broadcast ?? null,
  };
}

export function normaliseFixtures(
  payload: RawFixtureResponse | null | undefined,
  league: League,
): Game[] {
  const events = payload?.events;
  if (!Array.isArray(events)) return [];

  const games: Game[] = [];
  for (const event of events) {
    const game = normaliseFixture(event, league);
    if (game) games.push(game);
  }
  return games;
}

/** `2026-09-02` -> `20260902`, the format ESPN's `dates` parameter wants. */
export function compactDate(date: string): string {
  return date.replace(/-/g, '');
}

/**
 * Every fixture for a league between two dates, inclusive.
 *
 * One request per league for the whole range, cached, so a schedule refresh
 * costs one call per competition rather than one per competition per day.
 */
export async function fixturesForLeague(
  league: League,
  startDate: string,
  endDate: string,
  ttlMs: number,
): Promise<Game[]> {
  if (!espnConfig.enabled) return [];

  const range = `${compactDate(startDate)}-${compactDate(endDate)}`;

  const { value, hit } = await cached(
    `espn:fixtures:${league.id}:${range}`,
    ttlMs,
    async () => {
      const payload = await fetchEspn<RawFixtureResponse>(
        `${league.espnPath}/scoreboard`,
        `dates=${range}&limit=200`,
      );
      return normaliseFixtures(payload, league);
    },
  );

  if (!hit) {
    logger.info('espn_fixtures_refreshed', {
      league: league.id,
      range,
      games: value.length,
    });
  }
  return value;
}
