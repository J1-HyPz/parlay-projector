/**
 * Slip contract.
 *
 * The slip is a set of matches a reader chose by hand, from which the
 * projection engine builds a line. It is a single shared list, not per-user —
 * the application has no accounts, and this is a self-hosted deployment for one
 * household. The same reasoning as the watchlist, whose shape this follows.
 *
 * Entries carry a snapshot of the fixture rather than only an id, so the page
 * renders without a provider request and still reads correctly once a game has
 * dropped out of the eight-day window.
 */

export interface SlipEntry {
  gameId: string;
  /** ISO-8601 instant the game was added. */
  addedAt: string;
  /** Display text, e.g. `Chelsea v Arsenal`. */
  label: string;
  league: string | null;
  sport: string;
  /** ISO-8601 kick-off, or null when the provider gave no usable time. */
  startTime: string | null;
  /**
   * The calendar date, in the application's timezone, on which the match was
   * first observed to have finished.
   *
   * Absent while a match is still to come or under way. Written once and not
   * revised, because it is what the pruning rule counts from — a result that
   * is corrected days later must not extend the entry's life.
   */
  settledOn?: string | null;
}

/**
 * Where an entry belongs on the page.
 *
 * Derived from the game's current status, never stored as a mood on the entry:
 * a match is active because it has not finished, not because something once
 * wrote `active` next to it.
 */
export type SlipSection = 'active' | 'settled';

/** Why an entry left the slip, for the log line. */
export type SlipRemovalReason = 'expired' | 'stale' | 'manual';
