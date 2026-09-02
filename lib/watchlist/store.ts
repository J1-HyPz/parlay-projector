/**
 * Watchlist persistence.
 *
 * Lives under DATA_DIR next to prediction history and notifier state, and for
 * the same reason: a container filesystem is ephemeral, and losing this file
 * would silently unsubscribe every game.
 *
 * Writes are serialised. Two browser tabs starring games at the same moment
 * would otherwise read the same list, each add one entry, and the second write
 * would discard the first.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config';
import { logger } from '../logger';
import {
  MAX_ENTRIES,
  WATCHLIST_FILENAME,
  parseWatchlist,
  pruneWatchlist,
  sortEntries,
} from './parse';
import type { PruneResult } from './parse';
import type { WatchlistEntry } from './types';

export function watchlistPath(): string {
  return path.join(DATA_DIR, WATCHLIST_FILENAME);
}

/** Empty on any failure: a missing or corrupt file means nothing is watched. */
export async function readWatchlist(): Promise<WatchlistEntry[]> {
  try {
    return parseWatchlist(JSON.parse(await readFile(watchlistPath(), 'utf-8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn('watchlist_unreadable', { reason: code ?? 'parse_error' });
    }
    return [];
  }
}

async function persist(entries: readonly WatchlistEntry[]): Promise<void> {
  const file = watchlistPath();
  const temporary = `${file}.tmp`;

  await mkdir(path.dirname(file), { recursive: true });
  // Temp file then rename, so an interrupted write cannot leave truncated JSON
  // that the next read would discard entirely.
  await writeFile(temporary, JSON.stringify({ entries }), 'utf-8');
  await rename(temporary, file);
}

/**
 * Serialises every mutation behind a single promise chain.
 *
 * The application runs as one container, so an in-process queue is sufficient;
 * a second replica would need a real lock.
 */
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  // Keep the chain alive whatever this operation does, or one rejection would
  // block every later write.
  queue = run.catch(() => undefined);
  return run;
}

export interface MutationResult {
  entries: WatchlistEntry[];
  changed: boolean;
}

/** Add a game. Adding one already present is a no-op, not an error. */
export function addToWatchlist(entry: WatchlistEntry): Promise<MutationResult> {
  return exclusive(async () => {
    const entries = await readWatchlist();
    if (entries.some((existing) => existing.gameId === entry.gameId)) {
      return { entries: sortEntries(entries), changed: false };
    }
    if (entries.length >= MAX_ENTRIES) {
      logger.warn('watchlist_full', { limit: MAX_ENTRIES });
      return { entries: sortEntries(entries), changed: false };
    }

    const next = sortEntries([...entries, entry]);
    await persist(next);
    logger.info('watchlist_added', { game: entry.gameId, size: next.length });
    return { entries: next, changed: true };
  });
}

/** Remove a game. Removing one that is absent is a no-op, not an error. */
export function removeFromWatchlist(gameId: string): Promise<MutationResult> {
  return exclusive(async () => {
    const entries = await readWatchlist();
    const next = entries.filter((entry) => entry.gameId !== gameId);
    if (next.length === entries.length) return { entries: sortEntries(entries), changed: false };

    await persist(next);
    logger.info('watchlist_removed', { game: gameId, size: next.length });
    return { entries: next, changed: true };
  });
}

/**
 * Drop settled and stale entries, used by the poller.
 *
 * Reads *inside* the lock rather than taking a list from the caller: the poller
 * spends seconds fetching fixtures, and a game starred in that window must not
 * be erased by a prune working from a stale copy.
 */
export function pruneStoredWatchlist(
  settled: ReadonlyMap<string, 'finished' | 'cancelled'>,
  now: number = Date.now(),
): Promise<PruneResult> {
  return exclusive(async () => {
    const entries = await readWatchlist();
    const result = pruneWatchlist(entries, settled, now);

    if (result.removed.length > 0) {
      await persist(result.kept);
      logger.info('watchlist_pruned', {
        removed: result.removed.map((item) => ({
          game: item.entry.gameId,
          reason: item.reason,
        })),
        size: result.kept.length,
      });
    }

    return result;
  });
}
