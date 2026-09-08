'use client';

/**
 * Add-to-slip toggle for a game.
 *
 * Rendered as a *sibling* of the card's link, never inside it: a button nested
 * in an anchor is invalid HTML, and the click would fight the navigation. The
 * card wrapper positions this on top. Same rule as the watchlist star, which
 * sits beside it.
 *
 * A finished match is not offered. A line cannot be built from a result, and a
 * control that adds something the generator will refuse is worse than no
 * control.
 */

import { Check, Plus } from 'lucide-react';
import { useSlip, pickableLabel } from './slip-context';
import type { PickableGame } from './slip-context';

export function SlipButton({
  game,
  className = '',
}: {
  game: PickableGame;
  className?: string;
}) {
  const slip = useSlip();
  if (!slip) return null;

  // Nothing can be projected from a match that has been played.
  if (game.status === 'finished' || game.status === 'cancelled') return null;

  const picked = slip.isPicked(game.id);
  const fixture = pickableLabel(game);

  return (
    <button
      type="button"
      aria-pressed={picked}
      aria-label={picked ? `Remove ${fixture} from the slip` : `Add ${fixture} to the slip`}
      title={picked ? 'Remove from slip' : 'Add to slip'}
      onClick={(event) => {
        // The card behind this is a link covering the whole row.
        event.preventDefault();
        event.stopPropagation();
        void slip.toggle(game);
      }}
      className={`tap-target focus-ring grid size-8 shrink-0 place-items-center rounded-lg border transition ${
        picked
          ? 'border-violet-400/40 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30'
          : 'border-line bg-surface-1 text-ink-faint hover:border-line-strong hover:text-ink'
      } ${className}`}
    >
      {picked ? <Check className="size-4" /> : <Plus className="size-4" />}
    </button>
  );
}
