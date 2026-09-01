/**
 * Pure schedule grouping, filtering and formatting.
 *
 * Kept in `lib/` rather than the component so it is directly unit-testable:
 * Node's type-stripping test runner handles `.ts` but not JSX, and this file
 * has no React in it.
 */

// Explicit .ts extension: runtime import, resolved as a real path by the test
// runner. See lib/games/normalise.ts for the same note.
import { gameDate } from './range.ts';
import type { Game, SportId } from '../home/types';

export const ALL_LEAGUES = 'All Leagues';

export interface ScheduleFilters {
  date: string | null;
  sport: SportId;
  league: string;
  search: string;
}

export interface ScheduleSummary {
  games_this_week: number;
  sports_tracked: number;
  today: number;
  tomorrow: number;
}

/** Group games by their calendar date in the schedule's timezone. */
export function groupByDate(games: readonly Game[], timezone: string): Map<string, Game[]> {
  const grouped = new Map<string, Game[]>();
  for (const game of games) {
    const date = gameDate(game.start_time, timezone);
    if (!date) continue;
    const bucket = grouped.get(date);
    if (bucket) bucket.push(game);
    else grouped.set(date, [game]);
  }
  return grouped;
}

/**
 * Leagues actually present in the loaded window.
 *
 * Generated from the data, so the filter never offers a competition that has no
 * games in range.
 */
export function availableLeagues(games: readonly Game[]): string[] {
  const leagues = new Set<string>();
  for (const game of games) {
    if (game.league) leagues.add(game.league);
  }
  return [ALL_LEAGUES, ...[...leagues].sort((a, b) => a.localeCompare(b))];
}

/** Free-text match across the fields a person would plausibly search. */
export function matchesSearch(game: Game, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;

  const haystack = [
    game.home_team.name,
    game.away_team.name,
    game.league,
    game.venue.name,
    game.venue.city,
    game.venue.country,
    game.sport,
  ];

  return haystack.some((field) => field !== null && field.toLowerCase().includes(term));
}

/**
 * Apply every active filter.
 *
 * Filters combine: date, sport, league and search all narrow the same set
 * rather than replacing one another.
 */
export function applyFilters(
  games: readonly Game[],
  filters: ScheduleFilters,
  timezone: string,
): Game[] {
  return games.filter((game) => {
    if (filters.date && gameDate(game.start_time, timezone) !== filters.date) return false;
    if (filters.sport !== 'all' && game.sport !== filters.sport) return false;
    if (filters.league !== ALL_LEAGUES && game.league !== filters.league) return false;
    if (!matchesSearch(game, filters.search)) return false;
    return true;
  });
}

/**
 * Counts for the summary cards.
 *
 * "This week" means today + 7 days for this application — deliberately not
 * Monday to Sunday.
 */
export function summarise(
  games: readonly Game[],
  dates: readonly string[],
  timezone: string,
): ScheduleSummary {
  const grouped = groupByDate(games, timezone);
  const today = dates[0];
  const tomorrow = dates[1];

  return {
    games_this_week: games.length,
    sports_tracked: new Set(games.map((game) => game.sport)).size,
    today: today ? (grouped.get(today)?.length ?? 0) : 0,
    tomorrow: tomorrow ? (grouped.get(tomorrow)?.length ?? 0) : 0,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * A YYYY-MM-DD string is already a calendar date in the app timezone, so it is
 * parsed and formatted as UTC. Re-applying a zone here would shift the day.
 */
function calendarDate(date: string): Date | null {
  const instant = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** `2026-09-01` -> `{ weekday: 'TUE', label: 'SEP 1' }` for the day selector. */
export function formatDayTab(date: string): { weekday: string; label: string } {
  const instant = calendarDate(date);
  if (!instant) return { weekday: '--', label: date };

  return {
    weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' })
      .format(instant)
      .toUpperCase(),
    label: new Intl.DateTimeFormat('en-GB', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    })
      .format(instant)
      .toUpperCase(),
  };
}

/** `2026-09-01` -> `Tuesday, 1 September` for a section heading. */
export function formatDateHeading(date: string): string {
  const instant = calendarDate(date);
  if (!instant) return date;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(instant);
}

/** Kick-off time in the schedule's timezone. */
export function formatKickoff(startTime: string | null, timezone: string): string {
  if (!startTime) return '--:--';
  const instant = new Date(startTime);
  if (Number.isNaN(instant.getTime())) return '--:--';
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: timezone,
  }).format(instant);
}

/** Sport chips, matching the existing filter control. */
export const SPORT_TABS: { id: SportId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'nfl', label: 'NFL' },
  { id: 'nba', label: 'NBA' },
  { id: 'mlb', label: 'MLB' },
  { id: 'nhl', label: 'NHL' },
  { id: 'football', label: 'Football' },
  { id: 'tennis', label: 'Tennis' },
];

export function sportLabel(sport: SportId): string {
  return SPORT_TABS.find((tab) => tab.id === sport)?.label ?? sport.toUpperCase();
}

/** Football and tennis read "vs"; the North American leagues read "@". */
export function separatorFor(sport: SportId): string {
  return sport === 'football' || sport === 'tennis' ? 'vs' : '@';
}
