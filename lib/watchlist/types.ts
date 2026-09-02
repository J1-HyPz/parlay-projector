/**
 * Watchlist contract.
 *
 * The watchlist is the notification subscription: only games on it are
 * announced to Discord. It is a single shared list, not per-user — the
 * application has no accounts, and this is a self-hosted deployment for one
 * household.
 *
 * Entries carry a snapshot of the fixture rather than only an id, so the list
 * renders without a provider request and still reads correctly after a game
 * has dropped out of the eight-day window.
 */

export interface WatchlistEntry {
  gameId: string;
  /** ISO-8601 instant the game was added. */
  addedAt: string;
  /** Display text, e.g. `Chelsea v Arsenal`. */
  label: string;
  league: string | null;
  sport: string;
  /** ISO-8601 kick-off, or null when the provider gave no usable time. */
  startTime: string | null;
}

/** Why an entry left the list, for the log line. */
export type RemovalReason = 'finished' | 'cancelled' | 'stale' | 'manual';
