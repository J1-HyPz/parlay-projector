/**
 * Live scoreboard contract.
 *
 * Extends the shared `Game` model with the two things a scoreboard needs and a
 * fixture list does not: a score, and the current game state.
 *
 * Contains no betting fields and no prediction fields. The Live page is a
 * scoreboard.
 */

import type { Game, Score } from '../home/types';

/**
 * Current state of play.
 *
 * Every field is nullable because the provider supplies very different amounts
 * per sport — `clock` in particular is only available for football. Nothing is
 * inferred to fill a gap.
 */
export interface GameState {
  /** Ready-to-render summary, e.g. `68' • Second Half`. Null when unknown. */
  display: string | null;
  /** Period label, e.g. `Second Half`, `Q3`, `2nd Period`. */
  period: string | null;
  /** Elapsed clock or match minute, e.g. `68'`. Null for most sports. */
  clock: string | null;
}

/** Alias of the shared score shape; kept as a name the Live code reads well with. */
export type LiveScore = Score;

export interface LiveGame extends Game {
  score: LiveScore;
  game_state: GameState;
}

export type LiveErrorCode = 'live_data_unavailable';

export interface LiveResponse {
  /** ISO-8601 instant this payload was assembled. */
  updated_at: string;
  timezone: string;
  /** How often the client should poll, in milliseconds. */
  refresh_interval_ms: number;
  games: LiveGame[];
  /**
   * Games still to start today. Today-only by design — the Live page is a
   * scoreboard with a short "what's next" tail, not a second Schedule.
   */
  upcoming: Game[];
  /** Present only when every provider request failed. */
  error?: LiveErrorCode;
}
