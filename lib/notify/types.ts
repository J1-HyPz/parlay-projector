/**
 * Notification contract.
 *
 * A notification describes a *transition* a game made between two polls, not a
 * state it is in. That distinction is the whole design: polling reports that a
 * game is live, but only a change from scheduled to live is news.
 */

import type { GameStatus, Score } from '../home/types';

/** Transitions worth announcing. Selected with NOTIFY_EVENTS. */
export const NOTIFY_EVENTS = ['kickoff', 'final', 'postponed', 'cancelled'] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface GameNotification {
  event: NotifyEvent;
  gameId: string;
  /** Catalogue label, e.g. `Premier League`. */
  league: string | null;
  sport: string;
  home: string;
  away: string;
  /** Only meaningful for `final`; null when the provider gave no score. */
  score: Score | null;
}

/**
 * Last status seen per game, keyed by game id.
 *
 * Scoped to a single day: the poller only ever looks at today's fixtures, so
 * yesterday's entries are dropped wholesale rather than pruned individually.
 */
export interface NotifyState {
  /** YYYY-MM-DD in APP_TIMEZONE. A change resets the map. */
  date: string;
  statuses: Record<string, GameStatus>;
}
