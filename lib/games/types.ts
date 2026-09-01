/**
 * Game detail contract.
 *
 * Extends the Home page `Game` shape with everything a detail page needs.
 * Same conventions as the existing API: snake_case, ISO-8601 instants, and
 * `null` for anything the provider does not supply — never a zero or an empty
 * string standing in for real data.
 *
 * Deliberately contains no betting fields. There are no odds, spreads, totals,
 * bookmakers or markets anywhere in this contract.
 */

import type { ConcreteSportId, GameStatus, Venue } from '../home/types';

/** Win / draw / loss from one team's point of view. */
export type FormResult = 'W' | 'D' | 'L';

export interface TeamDetail {
  id: string | null;
  name: string;
  /** Provider short code, e.g. `LAA`. Often absent — omitted in the UI when null. */
  abbreviation: string | null;
  logo: string | null;
  stadium: string | null;
  location: string | null;
  formed_year: number | null;
}

/** One team's row in the league table, when the provider publishes one. */
export interface TeamStanding {
  rank: number | null;
  played: number | null;
  wins: number | null;
  draws: number | null;
  losses: number | null;
  goals_for: number | null;
  goals_against: number | null;
  goal_difference: number | null;
  points: number | null;
  /** Most recent results, newest first. Empty when unavailable. */
  form: FormResult[];
  /** Group or conference label, e.g. `Apertura - Group A`. */
  group: string | null;
}

/** A completed game in a team's recent history. */
export interface RecentGame {
  id: string;
  date: string | null;
  opponent: string;
  /** True when the team of interest played at home. */
  home: boolean;
  team_score: number | null;
  opponent_score: number | null;
  result: FormResult | null;
}

export interface ScoreLine {
  home: number | null;
  away: number | null;
}

export interface GameDetail {
  id: string;
  sport: ConcreteSportId;
  league: string | null;
  league_badge: string | null;
  season: string | null;
  round: string | null;
  start_time: string | null;
  status: GameStatus;
  provider_status: string | null;
  home_team: TeamDetail;
  away_team: TeamDetail;
  venue: Venue;
  /** Null for scheduled games — never a fabricated 0-0. */
  score: ScoreLine | null;
  /** Provider-supplied live clock/period text. Null unless genuinely live. */
  game_state: string | null;
  /** No provider field exists for this today; kept so a future one can fill it. */
  broadcast: string | null;
  standings: {
    home: TeamStanding | null;
    away: TeamStanding | null;
  };
  recent_games: {
    home: RecentGame[];
    away: RecentGame[];
  };
  /**
   * Previous meetings. The primary provider returns 404 for head-to-head on the
   * configured tier, so these come from the enrichment provider where the
   * competition is covered; empty otherwise.
   */
  head_to_head: RecentGame[];
  /**
   * Which provider supplied which enriched field. Recorded for debugging and
   * provider comparison; contains no credentials.
   */
  _sources?: Record<string, string>;
}

export interface GameDetailResponse {
  game: GameDetail;
}

export type GameErrorCode = 'game_not_found' | 'game_data_unavailable';

export interface GameErrorResponse {
  error: GameErrorCode;
  message: string;
}
