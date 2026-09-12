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

import type { ConcreteSportId, Entrant, GameStatus, Venue } from '../home/types';
import type { FixtureAvailability } from './availability-normalise';
import type { HeadToHeadRecord } from '../history/head-to-head';

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
  /*
   * The two sides, for a fixture that has two.
   *
   * Absent for an event contested by a field — a race session — exactly as they
   * are on `Game`. Optional rather than filled with a placeholder, because a
   * placeholder is a name, and a name leaks: it reaches the slip, the watchlist
   * and every heading that expects a real one. `detailSides` below is how a
   * caller asks, and the type makes it say what it does without them.
   */
  home_team?: TeamDetail;
  away_team?: TeamDetail;
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
   * The same meetings, tallied, when the long-run archive holds any.
   *
   * Null where the archive has nothing for this competition — which is every
   * competition until a backfill has run for it. Distinct from a record of
   * zero meetings, which means the archive was read and these two have not
   * met inside it.
   */
  head_to_head_record: HeadToHeadRecord | null;
  /**
   * Who is and is not playing, where the provider says so.
   *
   * Null carries meaning and is not the same as empty: it says the provider
   * publishes no availability data for this competition at all — the state
   * every football fixture is in. An object with empty player lists is the
   * provider actively reporting that nobody is missing. The interface must
   * keep those two apart.
   */
  availability: FixtureAvailability | null;
  /**
   * Which provider supplied which enriched field. Recorded for debugging and
   * provider comparison; contains no credentials.
   */
  _sources?: Record<string, string>;

  /*
   * The fields a fight or a tennis match carries and a team fixture does not.
   *
   * Named exactly as `Game` names them, because the projection routes hand a
   * detail to the engine as a `Game` and the engine reads `division` and
   * `winner` off it. Absent for every fixture that has a score, so their
   * presence is what says the detail is a contest between two people. See
   * `lib/home/types.ts` for what each one means.
   */
  /** The card or the tournament, e.g. `UFC 331`. */
  title?: string | null;
  division?: string | null;
  scheduledRounds?: number | null;
  winner?: 'home' | 'away' | null;
  completion?: 'played' | 'retired' | 'walkover';
  setGames?: { home: number[]; away: number[] };

  /*
   * The fields a race session carries, and no fixture with two sides does.
   *
   * A Grand Prix weekend is several sessions, each contested by the whole
   * field. `entrants` is that field — the entry list before it runs and the
   * classified order after — and its presence is what says this detail has no
   * home side and no away side. Named exactly as `Game` names them, because the
   * projection routes hand a detail to the engine as a `Game`.
   */
  entrants?: Entrant[];
  /** Which part of the weekend this is: `Race`, `Qualifying`, `Practice 1`. */
  session?: string | null;
  /**
   * The weekend's other sessions.
   *
   * Not part of the fixture, but part of reading one: a page showing Saturday
   * qualifying with no way through to Sunday's race is a dead end, and the
   * sessions are already in hand from the same fetch that found this one.
   */
  weekend?: SessionLink[];
}

/** One session of a race weekend, as a destination. */
export interface SessionLink {
  id: string;
  session: string | null;
  start_time: string | null;
  status: GameStatus;
}

/**
 * The two sides of a detail, where it has two.
 *
 * The detail-page counterpart to `sidesOf`, and the one place the shape is
 * decided. Null for a race session, so a section built around two teams is made
 * to say what it does instead of reading `undefined.name`.
 */
export function detailSides(game: GameDetail): { home: TeamDetail; away: TeamDetail } | null {
  if (!game.home_team || !game.away_team) return null;
  return { home: game.home_team, away: game.away_team };
}

/** True for a detail contested by a field rather than two sides. */
export function isFieldDetail(game: GameDetail): boolean {
  return Array.isArray(game.entrants);
}

export interface GameDetailResponse {
  game: GameDetail;
}

export type GameErrorCode = 'game_not_found' | 'game_data_unavailable';

export interface GameErrorResponse {
  error: GameErrorCode;
  message: string;
}
