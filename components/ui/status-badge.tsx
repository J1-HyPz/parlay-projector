/**
 * One status badge for the whole application.
 *
 * Schedule, Live and the game header each drew their own, and they disagreed:
 * a finished game was `white/40` on Schedule and `white/55` on the game page,
 * live was rose in two places and violet in a third, and only one
 * of the three carried the pulsing dot. The status vocabulary was already
 * shared in lib/schedule/status.ts; only the rendering had drifted.
 *
 * Colour is never the only signal. Every badge carries its text label, and the
 * live dot is a second, non-colour cue for the one status that matters most.
 */

import type { GameStatus } from '@/lib/home/types';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/schedule/status';

/**
 * @param label Overrides the status word, for the one caller that says
 *   "Status unavailable" rather than "Unknown".
 */
export function StatusBadge({
  status,
  label,
  className = '',
}: {
  status: GameStatus;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1 text-2xs font-medium ${STATUS_TONE[status]} ${className}`}
    >
      {status === 'live' && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-current motion-safe:animate-pulse"
        />
      )}
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}
