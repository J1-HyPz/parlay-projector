/**
 * Slip persistence.
 *
 * Lives under DATA_DIR next to prediction history, notifier state and the
 * watchlist, and for the same reason: a container filesystem is ephemeral, and
 * losing this file would silently empty the reader's picks on every redeploy.
 *
 * Writes are serialised. Two tabs adding matches at the same moment would
 * otherwise read the same slip, each add one entry, and the second write would
 * discard the first.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';
import { logger } from '../logger.ts';
import { MAX_ENTRIES, SLIP_FILENAME, parseSlip, sortEntries, updateSlip } from './parse.ts';
import type { SectionedSlip, SlipUpdateOptions } from './parse.ts';
import type { SlipEntry } from './types.ts';

export function slipPath(): string {
  return path.join(DATA_DIR, SLIP_FILENAME);
}

/** Empty on any failure: a missing or corrupt file means nothing is picked. */
export async function readSlip(): Promise<SlipEntry[]> {
  try {
    return parseSlip(JSON.parse(await readFile(slipPath(), 'utf-8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn('slip_unreadable', { reason: code ?? 'parse_error' });
    }
    return [];
  }
}

async function persist(entries: readonly SlipEntry[]): Promise<void> {
  const file = slipPath();
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
  entries: SlipEntry[];
  changed: boolean;
  /** Set when the add was refused, so the interface can say why. */
  reason?: 'duplicate' | 'full';
}

/** Add a match. Adding one already on the slip is a no-op, not an error. */
export function addToSlip(entry: SlipEntry): Promise<MutationResult> {
  return exclusive(async () => {
    const entries = await readSlip();
    if (entries.some((existing) => existing.gameId === entry.gameId)) {
      return { entries: sortEntries(entries), changed: false, reason: 'duplicate' };
    }
    if (entries.length >= MAX_ENTRIES) {
      logger.warn('slip_full', { limit: MAX_ENTRIES });
      return { entries: sortEntries(entries), changed: false, reason: 'full' };
    }

    const next = sortEntries([...entries, entry]);
    await persist(next);
    logger.info('slip_added', { game: entry.gameId, size: next.length });
    return { entries: next, changed: true };
  });
}

/** Remove a match. Removing one that is absent is a no-op, not an error. */
export function removeFromSlip(gameId: string): Promise<MutationResult> {
  return exclusive(async () => {
    const entries = await readSlip();
    const next = entries.filter((entry) => entry.gameId !== gameId);
    if (next.length === entries.length) {
      return { entries: sortEntries(entries), changed: false };
    }

    await persist(next);
    logger.info('slip_removed', { game: gameId, size: next.length });
    return { entries: next, changed: true };
  });
}

/** Empty the slip in one action, for the page's clear control. */
export function clearSlip(): Promise<MutationResult> {
  return exclusive(async () => {
    const entries = await readSlip();
    if (entries.length === 0) return { entries: [], changed: false };

    await persist([]);
    logger.info('slip_cleared', { removed: entries.length });
    return { entries: [], changed: true };
  });
}

/**
 * Section the slip against current statuses, persisting what that changes.
 *
 * Reads *inside* the lock rather than taking a list from the caller: resolving
 * statuses takes provider time, and a match added in that window must not be
 * erased by a write built from a stale copy.
 */
export function refreshSlip(options: SlipUpdateOptions): Promise<SectionedSlip> {
  return exclusive(async () => {
    const entries = await readSlip();
    const result = updateSlip(entries, options);

    if (result.changed) {
      await persist([...result.active, ...result.settled]);
      if (result.removed.length > 0) {
        logger.info('slip_pruned', {
          removed: result.removed.map((item) => ({
            game: item.entry.gameId,
            reason: item.reason,
          })),
          size: result.active.length + result.settled.length,
        });
      }
    }

    return result;
  });
}
