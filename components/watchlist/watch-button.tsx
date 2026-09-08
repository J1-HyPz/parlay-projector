'use client';

/**
 * Star toggle for a game.
 *
 * Rendered as a *sibling* of the card's link, never inside it: a button nested
 * in an anchor is invalid HTML, and the click would fight the navigation. The
 * card wrapper positions this on top.
 */

import { Star } from 'lucide-react';
import { useWatchlist, watchableLabel } from './watchlist-context';
import type { WatchableGame } from './watchlist-context';

export function WatchButton({
  game,
  className = '',
}: {
  game: WatchableGame;
  className?: string;
}) {
  const watchlist = useWatchlist();
  if (!watchlist) return null;

  const watched = watchlist.isWatched(game.id);
  const fixture = watchableLabel(game);

  return (
    <button
      type="button"
      // Amber here is the star's own colour, not a status. It is left literal
      // rather than routed through `--status-warn` so a starred game never
      // reads as a warning.
      aria-pressed={watched}
      aria-label={watched ? `Stop watching ${fixture}` : `Watch ${fixture}`}
      title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
      onClick={(event) => {
        // The card behind this is a link covering the whole row.
        event.preventDefault();
        event.stopPropagation();
        void watchlist.toggle(game);
      }}
      className={`tap-target focus-ring grid size-8 shrink-0 place-items-center rounded-lg border transition ${
        watched
          ? 'border-amber-300/30 bg-amber-400/12 text-amber-300 hover:bg-amber-400/20'
          : 'border-line bg-surface-1 text-ink-faint hover:border-line-strong hover:text-ink'
      } ${className}`}
    >
      <Star className="size-4" fill={watched ? 'currentColor' : 'none'} />
    </button>
  );
}
