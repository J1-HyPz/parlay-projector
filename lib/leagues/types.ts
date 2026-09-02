/**
 * League, team, standings and player contracts.
 *
 * Contains no betting or prediction fields.
 */

export interface TeamProfile {
  id: string;
  name: string;
  short_name: string | null;
  abbreviation: string | null;
  location: string | null;
  logo: string | null;
  colour: string | null;
}

export interface StandingsRow {
  team_id: string;
  team_name: string;
  abbreviation: string | null;
  logo: string | null;
  rank: number | null;
  /** Matches played. Football tables lead with this; ESPN calls it gamesPlayed. */
  games_played: number | null;
  wins: number | null;
  losses: number | null;
  ties: number | null;
  win_percent: number | null;
  games_behind: number | null;
  points_for: number | null;
  points_against: number | null;
  /** Goal or point difference, where the provider supplies it. */
  point_differential: number | null;
  /** League points. Football only; null for win/loss competitions. */
  points: number | null;
  /** Provider summary such as `11-2`. */
  record: string | null;
  streak: string | null;
}

/** A conference, division, or the whole league when it has neither. */
export interface StandingsGroup {
  id: string;
  name: string;
  abbreviation: string | null;
  rows: StandingsRow[];
}

export interface PlayerProfile {
  id: string;
  name: string;
  jersey: string | null;
  position: string | null;
  height: string | null;
  weight: number | null;
  age: number | null;
  headshot: string | null;
  experience_years: number | null;
}

export type LeagueErrorCode = 'league_not_found' | 'league_data_unavailable';
