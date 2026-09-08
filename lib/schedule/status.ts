/**
 * Shared rendering of the normalised game status.
 *
 * Extracted so Schedule and the sport hubs cannot drift into two status
 * vocabularies. The statuses themselves are defined by the game model; this
 * only decides what they are called and how they are tinted.
 *
 * Colour is never the only signal -- every badge carries its text label too.
 *
 * The one component that draws a badge is components/ui/status-badge.tsx.
 * Four components used to draw their own, from three different tone tables, so
 * a finished game was one grey on Schedule and another on the game page and
 * "live" was rose in two places and violet in a third. Both halves of the
 * decision live here now; the component only arranges them.
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

/**
 * Border, background and text for each status, as a single class string.
 *
 * Every value resolves through the design tokens rather than a raw alpha, so
 * the text in a badge sits on the same contrast ramp as the text outside it.
 */
export const STATUS_TONE: Record<GameStatus, string> = {
  live: 'border-rose-400/25 bg-rose-500/10 text-status-live',
  scheduled: 'border-violet-400/25 bg-violet-500/[.08] text-status-upcoming',
  // Deliberately the quietest of the five: a result is context, not news.
  finished: 'border-line bg-surface-1 text-status-settled',
  postponed: 'border-amber-400/25 bg-amber-500/10 text-status-warn',
  cancelled: 'border-amber-400/25 bg-amber-500/10 text-status-warn',
  // Not evidence of anything. It reads as unresolved, not as a fifth outcome.
  unknown: 'border-line bg-surface-1 text-ink-faint',
};
