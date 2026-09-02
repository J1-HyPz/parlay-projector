/**
 * Validation for the persisted state file.
 *
 * Separated from the file I/O so it can be unit-tested without pulling config
 * and the logger into the test runner. The rule this enforces matters: a
 * truncated or hand-edited file must degrade to "nothing seen yet", never crash
 * a poll and never inject a status the transition rules do not understand.
 */

import type { GameStatus } from '../home/types';
import type { NotifyState } from './types';

export const NOTIFY_STATE_FILENAME = 'notify-state.json';

/** One day of fixtures across every league sits far below this. */
const MAX_TRACKED = 5000;

const STATUSES = new Set<GameStatus>([
  'scheduled',
  'live',
  'finished',
  'postponed',
  'cancelled',
  'unknown',
]);

export function parseState(raw: unknown): NotifyState | null {
  if (!raw || typeof raw !== 'object') return null;

  const { date, statuses } = raw as { date?: unknown; statuses?: unknown };
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!statuses || typeof statuses !== 'object') return null;

  const clean: Record<string, GameStatus> = {};
  let count = 0;
  for (const [id, status] of Object.entries(statuses as Record<string, unknown>)) {
    if (count >= MAX_TRACKED) break;
    if (typeof status === 'string' && STATUSES.has(status as GameStatus)) {
      clean[id] = status as GameStatus;
      count += 1;
    }
  }

  return { date, statuses: clean };
}
