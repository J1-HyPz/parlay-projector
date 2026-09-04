/**
 * Choosing standings columns from the data actually returned.
 *
 * Pure and testable, because this is where "do not fabricate missing
 * statistics" is enforced. Two rules:
 *
 *   1. The candidate columns depend on the sport. A football table leads with
 *      played / won / drawn / lost / goal difference / points; an American
 *      league leads with wins, losses and percentage. Forcing one shape onto
 *      the other produces a table full of blanks.
 *   2. A candidate is only rendered if at least one row has a value for it.
 *      NCAA Football supplies no games-behind, the Champions League supplies no
 *      streak, and neither should get an empty column.
 */

import type { StandingsRow } from '../leagues/types.ts';

export interface StandingsColumn {
  key: string;
  /** Header text. Short: these are narrow columns. */
  label: string;
  /** Fuller description for the header's title attribute. */
  title: string;
  value: (row: StandingsRow) => string | null;
}

function integer(value: number | null): string | null {
  return value === null ? null : String(value);
}

/** ESPN returns win percentage as a fraction; football-style tables never use it. */
function percentage(value: number | null): string | null {
  if (value === null) return null;
  return value > 1 ? value.toFixed(1) : value.toFixed(3).replace(/^0/, '');
}

function signed(value: number | null): string | null {
  if (value === null) return null;
  return value > 0 ? `+${value}` : String(value);
}

/** Football: a league table. */
const FOOTBALL_COLUMNS: StandingsColumn[] = [
  { key: 'played', label: 'P', title: 'Played', value: (r) => integer(r.games_played) },
  { key: 'wins', label: 'W', title: 'Won', value: (r) => integer(r.wins) },
  { key: 'draws', label: 'D', title: 'Drawn', value: (r) => integer(r.ties) },
  { key: 'losses', label: 'L', title: 'Lost', value: (r) => integer(r.losses) },
  { key: 'for', label: 'GF', title: 'Goals for', value: (r) => integer(r.points_for) },
  { key: 'against', label: 'GA', title: 'Goals against', value: (r) => integer(r.points_against) },
  { key: 'diff', label: 'GD', title: 'Goal difference', value: (r) => signed(r.point_differential) },
  { key: 'points', label: 'Pts', title: 'Points', value: (r) => integer(r.points) },
];

/** Everything else: a win/loss record. */
const RECORD_COLUMNS: StandingsColumn[] = [
  { key: 'wins', label: 'W', title: 'Wins', value: (r) => integer(r.wins) },
  { key: 'losses', label: 'L', title: 'Losses', value: (r) => integer(r.losses) },
  { key: 'ties', label: 'T', title: 'Ties', value: (r) => integer(r.ties) },
  { key: 'pct', label: 'PCT', title: 'Win percentage', value: (r) => percentage(r.win_percent) },
  { key: 'gb', label: 'GB', title: 'Games behind', value: (r) => integer(r.games_behind) },
  { key: 'pf', label: 'PF', title: 'Points for', value: (r) => integer(r.points_for) },
  { key: 'pa', label: 'PA', title: 'Points against', value: (r) => integer(r.points_against) },
  { key: 'streak', label: 'Streak', title: 'Current streak', value: (r) => r.streak },
];

/**
 * Motorsport: a championship is points, and little else.
 *
 * There is no win/loss record to show — a driver does not lose a Grand Prix,
 * they finish it somewhere. Without this the record columns are all empty and
 * every one is filtered out, leaving a table of names and nothing to rank them
 * by, which is precisely what a championship table exists to show.
 */
const CHAMPIONSHIP_COLUMNS: StandingsColumn[] = [
  { key: 'points', label: 'Pts', title: 'Championship points', value: (r) => integer(r.points) },
  { key: 'wins', label: 'Wins', title: 'Wins', value: (r) => integer(r.wins) },
];

/**
 * Columns worth rendering for these rows.
 *
 * The sport selects the table shape; a column with no values in any row is
 * dropped rather than rendered empty.
 */
export function standingsColumns(
  rows: readonly StandingsRow[],
  group: string,
): StandingsColumn[] {
  const candidates =
    group === 'football'
      ? FOOTBALL_COLUMNS
      : group === 'motorsport'
        ? CHAMPIONSHIP_COLUMNS
        : RECORD_COLUMNS;
  return candidates.filter((column) => rows.some((row) => column.value(row) !== null));
}

/**
 * What the competitor column is called.
 *
 * A drivers' championship ranks people and a constructors' championship ranks
 * marques; neither is a "Team". Read from the group's own name, which the
 * provider supplies, rather than assumed from the sport.
 */
export function competitorLabel(group: string, name: string): string {
  if (group !== 'motorsport') return 'Team';
  if (/constructor/i.test(name)) return 'Constructor';
  if (/driver/i.test(name)) return 'Driver';
  return 'Competitor';
}

/**
 * Whether to show a position column.
 *
 * Only when the provider actually ranked the rows. A made-up index would imply
 * an ordering the provider never gave.
 */
export function hasRank(rows: readonly StandingsRow[]): boolean {
  return rows.some((row) => row.rank !== null);
}
