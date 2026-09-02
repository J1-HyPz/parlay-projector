/**
 * Shared rendering of the normalised game status.
 *
 * Extracted so Schedule and the sport hubs cannot drift into two status
 * vocabularies. The statuses themselves are defined by the game model; this
 * only decides what they are called and how they are tinted.
 *
 * Colour is never the only signal -- every badge carries its text label too.
 */

import type { GameStatus } from '../home/types';

export const STATUS_LABEL: Record<GameStatus, string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  finished: 'Finished',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
  unknown: 'Unknown',
};

export function statusTone(status: GameStatus): string {
  if (status === 'live') return 'border-rose-400/20 bg-rose-500/10 text-rose-300';
  if (status === 'finished') return 'border-white/8 text-white/40';
  if (status === 'postponed' || status === 'cancelled') {
    return 'border-amber-400/20 bg-amber-500/10 text-amber-300';
  }
  return 'border-violet-400/20 bg-violet-500/[.08] text-violet-300';
}
