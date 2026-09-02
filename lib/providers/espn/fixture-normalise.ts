/**
 * Pure fixture normalisation and game-id helpers.
 *
 * Split from `fixtures.ts` so it carries no runtime imports and is directly
 * unit-testable: the type-stripping test runner resolves real file paths, and
 * the fetching module pulls in config, caching and logging.
 */

import type { Game, GameStatus } from '../../home/types';
import type { League } from '../../leagues/registry';

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

/** ESPN sends scores as strings, and as "0" for a game that has not started. */
function score(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
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

/**
 * Split a date range into windows the provider will actually answer.
 *
 * Two undocumented limits make this necessary, both of which fail silently:
 *
 *   - A range longer than roughly a year returns an *empty* list rather than an
 *     error, so a two-season request looks like a competition with no fixtures.
 *   - A range is capped at `limit` events, and the ones returned are the
 *     *earliest*. A 200-day MLB request therefore came back as a fortnight of
 *     spring training with everything recent missing.
 *
 * Returned oldest first. Dates are inclusive at both ends.
 */
export function splitRange(
  start: string,
  end: string,
  maxDays: number,
): { start: string; end: string }[] {
  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];

  const span = Math.max(1, Math.floor(maxDays));
  const day = 86_400_000;
  const windows: { start: string; end: string }[] = [];

  for (let cursor = from; cursor <= to; cursor += span * day) {
    const last = Math.min(cursor + (span - 1) * day, to);
    windows.push({
      start: new Date(cursor).toISOString().slice(0, 10),
      end: new Date(last).toISOString().slice(0, 10),
    });
  }

  return windows;
}

/** Halve a window, for retrying one that came back capped. */
export function halveRange(range: { start: string; end: string }): {
  start: string;
  end: string;
}[] {
  const from = Date.parse(`${range.start}T00:00:00Z`);
  const to = Date.parse(`${range.end}T00:00:00Z`);
  const day = 86_400_000;
  const days = Math.round((to - from) / day) + 1;
  if (!Number.isFinite(days) || days < 2) return [range];

  const half = Math.floor(days / 2);
  const middle = from + (half - 1) * day;

  return [
    { start: range.start, end: new Date(middle).toISOString().slice(0, 10) },
    { start: new Date(middle + day).toISOString().slice(0, 10), end: range.end },
  ];
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

  // A scheduled fixture reports 0-0, which is not a score. Only a started game
  // gets one, so nothing downstream has to distinguish "nil-nil" from "not yet".
  const status = statusFromEspn(raw.status?.type);
  const started = status === 'live' || status === 'finished';

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
    status,
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
    ...(started
      ? { score: { home: score(homeSide?.score), away: score(awaySide?.score) } }
      : {}),
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

