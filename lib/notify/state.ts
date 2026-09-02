/**
 * Persisted last-seen game statuses.
 *
 * Lives under DATA_DIR alongside prediction history, for the same reason: a
 * container filesystem is ephemeral, and losing this file makes the next poll
 * treat every game as newly seen. That is handled safely -- an unseen game is
 * never announced -- but it costs a round of genuine notifications, so the file
 * belongs on the mounted volume.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config';
import { logger } from '../logger';
import { NOTIFY_STATE_FILENAME, parseState } from './state-parse';
import type { NotifyState } from './types';

export { NOTIFY_STATE_FILENAME, parseState };

export function notifyStatePath(): string {
  return path.join(DATA_DIR, NOTIFY_STATE_FILENAME);
}

/** Null when there is no usable prior state, for any reason. */
export async function readState(): Promise<NotifyState | null> {
  try {
    return parseState(JSON.parse(await readFile(notifyStatePath(), 'utf-8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // A missing file is the normal first run, not a problem worth logging.
    if (code !== 'ENOENT') {
      logger.warn('notify_state_unreadable', { reason: code ?? 'parse_error' });
    }
    return null;
  }
}

/**
 * Write via a temporary file and rename.
 *
 * A poll interrupted mid-write would otherwise leave truncated JSON behind, and
 * the next start would silently lose every tracked status.
 */
export async function writeState(state: NotifyState): Promise<void> {
  const file = notifyStatePath();
  const temporary = `${file}.tmp`;

  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(temporary, JSON.stringify(state), 'utf-8');
    await rename(temporary, file);
  } catch (error) {
    logger.warn('notify_state_unwritable', {
      reason: (error as NodeJS.ErrnoException)?.code ?? 'unknown',
    });
  }
}
