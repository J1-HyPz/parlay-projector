/**
 * Slip validation, sectioning and pruning.
 *
 * Pure, so the rules that decide where a pick appears and when it leaves are
 * testable without a filesystem or a provider. Those rules are most of the
 * feature: a slip that never empties becomes a list of last month's fixtures,
 * and one that empties too eagerly loses the results a reader came back to see.
 */

import { isValidGameId } from '../games/normalise.ts';
import type { GameStatus } from '../home/types.ts';
import type { SlipEntry, SlipRemovalReason } from './types.ts';

export const SLIP_FILENAME = 'slip.json';

/**
 * Bounded deliberately low.
 *
 * Every entry costs a game lookup when the slip is read, and a line is at most
 * six legs. Thirty is far more than anyone builds from and keeps the read cheap.
 */
export const MAX_ENTRIES = 30;

/** Clamp on stored display text, so a malformed add cannot bloat the file. */
const MAX_TEXT = 120;

/**
 * A match still on the slip this long after kick-off, with no observed result,
 * is dropped.
 *
 * The safety net for fixtures the provider never reports as finished: a
 * postponement that is never rescheduled, or a game that falls out of the feed.
 * Generous enough to survive a long rain delay, and the same window the
 * watchlist uses.
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

/** `2026-09-08`, or null for anything that is not one. */
function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

/** One entry, or null if it is not usable. */
export function parseEntry(raw: unknown): SlipEntry | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  const gameId = typeof value.gameId === 'string' ? value.gameId : '';
  // The same validator the game routes use, so a slip entry can never hold an
  // id that would not resolve to a page.
  if (!isValidGameId(gameId)) return null;

  const label = text(value.label);
  if (!label) return null;

  const settledOn = dateOrNull(value.settledOn);

  return {
    gameId,
    addedAt: isoOrNull(value.addedAt) ?? new Date(0).toISOString(),
    label,
    league: text(value.league) || null,
    sport: text(value.sport, 'unknown') || 'unknown',
    startTime: isoOrNull(value.startTime),
    ...(settledOn ? { settledOn } : {}),
  };
}

/**
 * Parse a stored file.
 *
 * Accepts a bare array or `{ "entries": [...] }`, matching the other stores.
 * Anything unusable is dropped rather than failing the read: a corrupt file
 * must not make the page unable to show a slip at all.
 */
export function parseSlip(raw: unknown): SlipEntry[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { entries?: unknown }).entries)
      ? (raw as { entries: unknown[] }).entries
      : [];

  const seen = new Set<string>();
  const entries: SlipEntry[] = [];

  for (const item of list) {
    if (entries.length >= MAX_ENTRIES) break;
    const entry = parseEntry(item);
    // A duplicate id would render twice and could contribute two legs.
    if (!entry || seen.has(entry.gameId)) continue;
    seen.add(entry.gameId);
    entries.push(entry);
  }

  return entries;
}

/** Kick-off first, then whatever has no time at all. */
export function sortEntries(entries: readonly SlipEntry[]): SlipEntry[] {
  return [...entries].sort((a, b) => {
    if (a.startTime === b.startTime) return a.label.localeCompare(b.label);
    if (a.startTime === null) return 1;
    if (b.startTime === null) return -1;
    return a.startTime.localeCompare(b.startTime);
  });
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * A match is settled once it can no longer be projected.
 *
 * Cancelled and postponed count: both mean no line will ever be built from it,
 * which is the question this answers. `unknown` does not — an unreadable status
 * is not evidence a game is over, and treating it as one would retire a fixture
 * that is still to be played.
 */
export function isSettledStatus(status: GameStatus): boolean {
  return status === 'finished' || status === 'cancelled' || status === 'postponed';
}

export interface SectionedSlip {
  /** Still to come or under way. Only these can produce a leg. */
  active: SlipEntry[];
  /** Finished, cancelled or postponed, newest result first. */
  settled: SlipEntry[];
  /** Entries dropped by this pass, with the reason, for the log. */
  removed: { entry: SlipEntry; reason: SlipRemovalReason }[];
  /** True when anything was reclassified or dropped and must be persisted. */
  changed: boolean;
}

export interface SlipUpdateOptions {
  /** Current status per game id. A game absent from the map is left as it is. */
  statuses: ReadonlyMap<string, GameStatus>;
  /** Today's calendar date in the application's timezone, `2026-09-08`. */
  today: string;
  now?: number;
}

/**
 * Split the slip, stamp newly settled entries, and drop what has run its course.
 *
 * One pass, because the three are the same question asked at different points:
 * where does this entry belong, and does it still belong at all.
 *
 * A settled entry keeps its original `settledOn`. Stamping it again on a later
 * read would restart the clock every time the page was opened, and the entry
 * would never expire.
 */
export function updateSlip(
  entries: readonly SlipEntry[],
  options: SlipUpdateOptions,
): SectionedSlip {
  const now = options.now ?? Date.now();
  const active: SlipEntry[] = [];
  const settled: SlipEntry[] = [];
  const removed: SectionedSlip['removed'] = [];
  let changed = false;

  for (const entry of entries) {
    const status = options.statuses.get(entry.gameId);
    const nowSettled = status !== undefined && isSettledStatus(status);

    if (nowSettled || entry.settledOn) {
      // Stamped on the first read that observes the result, then left alone.
      const settledOn = entry.settledOn ?? options.today;
      if (settledOn !== entry.settledOn) changed = true;

      /*
       * Gone once the date has moved past the day it finished.
       *
       * Nothing is lost: the prediction it produced lives in the accuracy
       * history permanently, and settled lines appear on the home page. This
       * section is a short-lived view of how the picks went, not the record of
       * them.
       */
      if (settledOn < options.today) {
        removed.push({ entry: { ...entry, settledOn }, reason: 'expired' });
        changed = true;
        continue;
      }

      settled.push({ ...entry, settledOn });
      continue;
    }

    /*
     * Never observed to finish, and long past kick-off.
     *
     * A postponement that was never rescheduled, or a fixture the provider
     * dropped. Removed rather than left to sit in Active for ever, claiming a
     * line could still be built from it.
     */
    const started = entry.startTime ? Date.parse(entry.startTime) : Number.NaN;
    if (Number.isFinite(started) && now - started > STALE_AFTER_MS) {
      removed.push({ entry, reason: 'stale' });
      changed = true;
      continue;
    }

    active.push(entry);
  }

  return {
    active: sortEntries(active),
    // Most recent result first: the last thing that happened is the thing a
    // reader came back to look at.
    settled: sortEntries(settled).reverse(),
    removed,
    changed,
  };
}
