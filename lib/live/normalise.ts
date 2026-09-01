/**
 * Pure normalisation of TheSportsDB's live feed.
 *
 * Status normalisation is imported from the shared sports module rather than
 * reimplemented — there is one status vocabulary in this codebase.
 *
 * Sport-aware, but only within what the provider actually supplies. `strStatus`
 * is a short period code and `strProgress` is a match minute that in practice
 * only appears for football. Down and distance, outs, possession, shots and
 * tennis set scores are not in this feed and are therefore absent rather than
 * guessed at.
 */

// Explicit .ts extension: runtime import, resolved as a real path by the
// type-stripping test runner. See lib/games/normalise.ts.
import { normaliseStatus } from '../home/sports/normalise.ts';
import type { ConcreteSportId, Game } from '../home/types';
import type { GameState, LiveGame, LiveScore } from './types';

/** A row from `livescore.php`. Every field is treated as untrusted. */
export interface RawLiveRow {
  idEvent?: unknown;
  strSport?: unknown;
  idLeague?: unknown;
  strLeague?: unknown;
  idHomeTeam?: unknown;
  idAwayTeam?: unknown;
  strHomeTeam?: unknown;
  strAwayTeam?: unknown;
  strHomeTeamBadge?: unknown;
  strAwayTeamBadge?: unknown;
  intHomeScore?: unknown;
  intAwayScore?: unknown;
  strStatus?: unknown;
  strProgress?: unknown;
  strTimestamp?: unknown;
  dateEvent?: unknown;
  strEventTime?: unknown;
  updated?: unknown;
}

export interface RawLiveResponse {
  livescore?: RawLiveRow[] | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Empty provider strings must become null, never a fabricated 0. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Human label for a period code.
 *
 * Returns null for anything unrecognised rather than echoing a raw code the
 * reader cannot interpret.
 */
export function periodLabel(sport: ConcreteSportId, status: string | null): string | null {
  if (!status) return null;
  const value = status.toUpperCase();

  if (value === 'HT' || value === 'HALF TIME') return 'Half Time';
  if (value === 'ET') return 'Extra Time';
  if (value === 'P') return 'Penalties';
  if (value === 'BT') return 'Break';

  if (sport === 'football') {
    if (value === '1H') return 'First Half';
    if (value === '2H') return 'Second Half';
  }

  // Q1-Q4 for gridiron and basketball.
  const quarter = /^Q([1-4])$/.exec(value);
  if (quarter) return `Q${quarter[1]}`;

  // P1-P3 for hockey periods.
  const period = /^P([1-9])$/.exec(value);
  if (period) return `Period ${period[1]}`;

  // Baseball innings arrive as 1I..9I on this feed.
  const inning = /^([1-9][0-9]?)I$/.exec(value);
  if (inning) return `Inning ${inning[1]}`;

  // Generic halves for any other sport.
  if (value === '1H') return 'First Half';
  if (value === '2H') return 'Second Half';

  return null;
}

/**
 * Elapsed clock.
 *
 * The provider only populates `strProgress` for football, where it is the match
 * minute. Anything non-numeric is passed through as-is; anything absent yields
 * null rather than a zero.
 */
export function clockLabel(sport: ConcreteSportId, progress: unknown): string | null {
  const text = str(progress);
  if (!text) return null;

  if (sport === 'football') {
    const minute = num(text);
    return minute === null ? text : `${minute}'`;
  }
  return text;
}

/** Combine clock and period into one display string, skipping absent parts. */
export function describeGameState(
  sport: ConcreteSportId,
  status: string | null,
  progress: unknown,
): GameState {
  const period = periodLabel(sport, status);
  const clock = clockLabel(sport, progress);

  const parts = [clock, period].filter((part): part is string => part !== null);
  return {
    display: parts.length > 0 ? parts.join(' • ') : null,
    period,
    clock,
  };
}

/**
 * Whether a live-feed row is actually in progress.
 *
 * The feed also carries `NS` (not started) and `FT` (finished) rows, so this
 * filter is what keeps scheduled and finished games off the Live page.
 */
export function isLiveRow(row: RawLiveRow): boolean {
  return normaliseStatus(row.strStatus) === 'live';
}

/** ISO-8601 instant from the provider's zoneless UTC timestamp. */
function startTime(row: RawLiveRow): string | null {
  const timestamp = str(row.strTimestamp);
  if (timestamp) {
    const withZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
    const parsed = new Date(withZone);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const date = str(row.dateEvent);
  if (date) {
    const time = str(row.strEventTime) ?? '00:00:00';
    const parsed = new Date(`${date}T${time.length === 5 ? `${time}:00` : time}Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/**
 * Normalise one live row.
 *
 * Returns null when the row is not live, or lacks the minimum to be a real
 * game, so malformed rows never reach the scoreboard.
 */
export function normaliseLiveRow(row: RawLiveRow, sport: ConcreteSportId): LiveGame | null {
  if (!row || typeof row !== 'object') return null;
  if (!isLiveRow(row)) return null;

  const id = str(row.idEvent);
  if (!id) return null;

  const home = str(row.strHomeTeam);
  const away = str(row.strAwayTeam);
  if (!home && !away) return null;

  const providerStatus = str(row.strStatus);
  const score: LiveScore = {
    home: num(row.intHomeScore),
    away: num(row.intAwayScore),
  };

  return {
    id,
    sport,
    league: str(row.strLeague),
    league_badge: null,
    season: null,
    round: null,
    start_time: startTime(row),
    status: 'live',
    provider_status: providerStatus,
    home_team: {
      id: str(row.idHomeTeam),
      name: home ?? 'TBC',
      logo: str(row.strHomeTeamBadge),
    },
    away_team: {
      id: str(row.idAwayTeam),
      name: away ?? 'TBC',
      logo: str(row.strAwayTeamBadge),
    },
    // The live feed carries no venue; it is filled in from today's fixtures
    // where those are already cached.
    venue: { name: null, city: null, country: null },
    broadcast: null,
    score,
    game_state: describeGameState(sport, providerStatus, row.strProgress),
  };
}

/** Normalise a whole live response for one sport. */
export function normaliseLiveResponse(
  payload: RawLiveResponse | null | undefined,
  sport: ConcreteSportId,
): LiveGame[] {
  const rows = payload?.livescore;
  if (!Array.isArray(rows)) return [];

  const games: LiveGame[] = [];
  for (const row of rows) {
    const game = normaliseLiveRow(row, sport);
    if (game) games.push(game);
  }
  return games;
}

/**
 * Fill in details the live feed omits, from a fixture already loaded elsewhere.
 *
 * Only ever adds context (venue, season, round, league badge); it never
 * overwrites live score or state.
 */
export function enrichFromFixture(game: LiveGame, fixture: Game | undefined): LiveGame {
  if (!fixture) return game;
  return {
    ...game,
    league: game.league ?? fixture.league,
    league_badge: fixture.league_badge,
    season: fixture.season,
    round: fixture.round,
    venue: fixture.venue,
    broadcast: fixture.broadcast,
    start_time: game.start_time ?? fixture.start_time,
  };
}

/**
 * Stable ordering.
 *
 * Sorted by sport, then league, then kick-off, then id — deliberately not by
 * score or clock, so cards do not jump around between refreshes.
 */
export function sortLiveGames(games: LiveGame[]): LiveGame[] {
  return [...games].sort((a, b) => {
    const sport = a.sport.localeCompare(b.sport);
    if (sport !== 0) return sport;

    const league = (a.league ?? '').localeCompare(b.league ?? '');
    if (league !== 0) return league;

    const start = (a.start_time ?? '').localeCompare(b.start_time ?? '');
    if (start !== 0) return start;

    return a.id.localeCompare(b.id);
  });
}
