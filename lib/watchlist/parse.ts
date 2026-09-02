/**
 * Watchlist validation and pruning.
 *
 * Pure, so the rules that decide when a game leaves the list are testable
 * without touching the filesystem. Those rules are the whole feature: a
 * watchlist that never empties becomes a list of last season's fixtures.
 */

import { isValidGameId } from '../games/normalise.ts';
import type { WatchlistEntry } from './types.ts';

export const WATCHLIST_FILENAME = 'watchlist.json';

/** Generous for one household, low enough that the file stays small. */
export const MAX_ENTRIES = 200;

/** Clamp on stored display text, so a malformed add cannot bloat the file. */
const MAX_TEXT = 120;

/**
 * A game still on the list this long after kick-off is dropped.
 *
 * The safety net for fixtures the poller never sees finish: a postponement
 * that is never rescheduled, or a game that simply falls out of the provider's
 * feed. Generous enough to survive a long rain delay.
 */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function text(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, MAX_TEXT);
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/** One entry, or null if it is not usable. */
export function parseEntry(raw: unknown): WatchlistEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  const gameId = typeof value.gameId === 'string' ? value.gameId : '';
  // The same validator the game routes use, so a watchlist entry can never
  // hold an id that would not resolve to a page.
  if (!isValidGameId(gameId)) return null;

  const label = text(value.label);
  if (!label) return null;

  return {
    gameId,
    addedAt: isoOrNull(value.addedAt) ?? new Date(0).toISOString(),
    label,
    league: text(value.league) || null,
    sport: text(value.sport, 'unknown') || 'unknown',
    startTime: isoOrNull(value.startTime),
  };
}

/**
 * Parse a stored file.
 *
 * Accepts a bare array or `{ "entries": [...] }`, matching the prediction store,
 * so metadata can be added alongside the entries later. Anything unusable is
 * dropped rather than failing the read: a corrupt file must not make the app
 * unable to show a watchlist at all.
 */
export function parseWatchlist(raw: unknown): WatchlistEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
      ? ((raw as { entries: unknown[] }).entries)
      : [];

  const seen = new Set<string>();
  const entries: WatchlistEntry[] = [];

  for (const item of list) {
    if (entries.length >= MAX_ENTRIES) break;
    const entry = parseEntry(item);
    // A duplicate id would notify twice and render twice.
    if (!entry || seen.has(entry.gameId)) continue;
    seen.add(entry.gameId);
    entries.push(entry);
  }

  return entries;
}

/** Kick-off first, then whatever has no time at all. */
export function sortEntries(entries: readonly WatchlistEntry[]): WatchlistEntry[] {
  return [...entries].sort((a, b) => {
    if (a.startTime === b.startTime) return a.label.localeCompare(b.label);
    if (a.startTime === null) return 1;
    if (b.startTime === null) return -1;
    return a.startTime.localeCompare(b.startTime);
  });
}

export interface PruneResult {
  kept: WatchlistEntry[];
  removed: { entry: WatchlistEntry; reason: 'finished' | 'cancelled' | 'stale' }[];
}

/**
 * Drop entries that have run their course.
 *
 * `settled` maps a game id to the terminal state the poller just observed.
 * Removal is driven by the observed status rather than by whether a message
 * was sent, so a game that finishes while notifications are off still leaves
 * the list.
 */
export function pruneWatchlist(
  entries: readonly WatchlistEntry[],
  settled: ReadonlyMap<string, 'finished' | 'cancelled'>,
  now: number = Date.now(),
): PruneResult {
  const kept: WatchlistEntry[] = [];
  const removed: PruneResult['removed'] = [];

  for (const entry of entries) {
    const terminal = settled.get(entry.gameId);
    if (terminal) {
      removed.push({ entry, reason: terminal });
      continue;
    }

    const started = entry.startTime ? Date.parse(entry.startTime) : Number.NaN;
    if (Number.isFinite(started) && now - started > STALE_AFTER_MS) {
      removed.push({ entry, reason: 'stale' });
      continue;
    }

    kept.push(entry);
  }

  return { kept, removed };
}
