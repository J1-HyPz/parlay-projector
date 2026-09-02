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
import { LEAGUES } from '../leagues/registry.ts';
import type { Game, SportId } from '../home/types';

export const ALL_LEAGUES = 'All Leagues';

export interface ScheduleFilters {
  date: string | null;
  /** Chip id from SPORT_TABS, not a sport id — see SportChip. */
  sport: string;
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

/** Catalogue order, so the dropdown reads NFL before NCAA Football. */
const LEAGUE_ORDER = new Map(LEAGUES.map((league, index) => [league.label, index]));

/**
 * Leagues actually present in the loaded games.
 *
 * Generated from the data, so the filter never offers a competition with no
 * games in range. Pass games already narrowed by sport and the dropdown narrows
 * with it — picking Basketball should not still offer the Premier League.
 *
 * Ordered by the catalogue rather than alphabetically, so the senior
 * competition in each sport comes first.
 */
export function availableLeagues(games: readonly Game[]): string[] {
  const leagues = new Set<string>();
  for (const game of games) {
    if (game.league) leagues.add(game.league);
  }

  const ordered = [...leagues].sort((a, b) => {
    const left = LEAGUE_ORDER.get(a);
    const right = LEAGUE_ORDER.get(b);
    // Anything outside the catalogue sorts after it, alphabetically.
    if (left === undefined && right === undefined) return a.localeCompare(b);
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    return left - right;
  });

  return [ALL_LEAGUES, ...ordered];
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
    if (!chipMatches(game, filters.sport)) return false;
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

function part(instant: Date, options: Intl.DateTimeFormatOptions, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(instant);
}

/**
 * `2026-09-01` -> `{ weekday: 'TUE', label: 'SEP 1' }` for the day selector.
 *
 * Composed from parts rather than one format call: `en-GB` renders a combined
 * month/day as `1 Sept`, which is both the wrong order for this design and
 * locale-brittle. `en-US` is used only for the three-letter abbreviations.
 */
export function formatDayTab(date: string): { weekday: string; label: string } {
  const instant = calendarDate(date);
  if (!instant) return { weekday: '--', label: date };

  const month = part(instant, { month: 'short' }, 'en-US').toUpperCase();
  const day = part(instant, { day: 'numeric' }, 'en-US');

  return {
    weekday: part(instant, { weekday: 'short' }, 'en-US').toUpperCase(),
    label: `${month} ${day}`,
  };
}

/** `2026-09-01` -> `Tuesday, 1 September` for a section heading. */
export function formatDateHeading(date: string): string {
  const instant = calendarDate(date);
  if (!instant) return date;

  const weekday = part(instant, { weekday: 'long' });
  const day = part(instant, { day: 'numeric' });
  const month = part(instant, { month: 'long' });
  return `${weekday}, ${day} ${month}`;
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

/**
 * Filter chips.
 *
 * Keyed on leagues rather than sport ids, because NFL and NCAA Football share
 * the sport id `nfl` and the four basketball competitions share `nba` — a
 * sport-id filter cannot tell them apart.
 *
 * The emoji marks which sport a chip belongs to, so the two "NCAA" chips are
 * distinguishable at a glance without a longer label.
 */
export interface SportChip {
  /** Unique filter key. Two chips may share a label, never an id. */
  id: string;
  label: string;
  /** Decorative only — hidden from screen readers, which read the label. */
  emoji: string | null;
  /** Catalogue league ids this chip selects. Empty means "everything". */
  leagues: readonly string[];
}

/** Football league ids, read from the catalogue so the two stay in step. */
const FOOTBALL_LEAGUE_IDS = LEAGUES.filter((league) => league.group === 'football').map(
  (league) => league.id,
);

export const SPORT_TABS: readonly SportChip[] = [
  { id: 'all', label: 'All', emoji: null, leagues: [] },
  { id: 'nfl', label: 'NFL', emoji: '🏈', leagues: ['nfl'] },
  { id: 'ncaaf', label: 'NCAA', emoji: '🏈', leagues: ['ncaaf'] },
  { id: 'nba', label: 'NBA', emoji: '🏀', leagues: ['nba'] },
  { id: 'wnba', label: 'WNBA', emoji: '🏀', leagues: ['wnba'] },
  // Men's and women's college basketball share one chip; the league dropdown
  // separates them.
  { id: 'ncaab', label: 'NCAA', emoji: '🏀', leagues: ['ncaam', 'ncaaw'] },
  { id: 'mlb', label: 'MLB', emoji: '⚾', leagues: ['mlb'] },
  { id: 'nhl', label: 'NHL', emoji: '🏒', leagues: ['nhl'] },
  { id: 'football', label: 'Football', emoji: '⚽', leagues: FOOTBALL_LEAGUE_IDS },
];

/** League *labels* each chip accepts — games carry the label, not the id. */
const CHIP_LEAGUE_LABELS = new Map<string, Set<string>>(
  SPORT_TABS.map((chip) => [
    chip.id,
    new Set(
      chip.leagues
        .map((id) => LEAGUES.find((league) => league.id === id)?.label)
        .filter((label): label is string => label !== undefined),
    ),
  ]),
);

export const ALL_SPORTS = 'all';

/** Whether a game belongs to a chip. */
export function chipMatches(game: Game, chipId: string): boolean {
  if (chipId === ALL_SPORTS) return true;
  const labels = CHIP_LEAGUE_LABELS.get(chipId);
  if (!labels || labels.size === 0) return false;
  return game.league !== null && labels.has(game.league);
}

export function chipLabel(chipId: string): string {
  const chip = SPORT_TABS.find((tab) => tab.id === chipId);
  if (!chip) return chipId;
  return chip.emoji ? `${chip.emoji} ${chip.label}` : chip.label;
}

/**
 * Display name for a game's sport.
 *
 * Separate from the chips: a chip is a league selection, this is what a card
 * shows when it has no league of its own.
 */
const SPORT_LABELS: Record<SportId, string> = {
  all: 'All',
  nfl: 'American Football',
  nba: 'Basketball',
  mlb: 'Baseball',
  nhl: 'Hockey',
  football: 'Football',
  tennis: 'Tennis',
};

export function sportLabel(sport: SportId): string {
  return SPORT_LABELS[sport] ?? String(sport).toUpperCase();
}

/** Catalogue short labels, keyed by the full label games carry. */
const SHORT_LABELS = new Map(LEAGUES.map((league) => [league.label, league.shortLabel]));

/**
 * Compact badge text for a game.
 *
 * Uses the catalogue short label (`NCAAF`, `EPL`) rather than truncating the
 * sport name, which produced things like "Ame" and "Bas".
 */
export function badgeLabel(league: string | null, sport: SportId): string {
  if (league) {
    const short = SHORT_LABELS.get(league);
    if (short) return short;
    return league.length <= 5 ? league : league.slice(0, 5);
  }
  return sportLabel(sport).slice(0, 5);
}

/** Football and tennis read "vs"; the North American leagues read "@". */
export function separatorFor(sport: SportId): string {
  return sport === 'football' || sport === 'tennis' ? 'vs' : '@';
}
