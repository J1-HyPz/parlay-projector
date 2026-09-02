'use client';

/**
 * Star toggle for a game.
 *
 * Rendered as a *sibling* of the card's link, never inside it: a button nested
 * in an anchor is invalid HTML, and the click would fight the navigation. The
 * card wrapper positions this on top.
 */

import { Star } from 'lucide-react';
import { useWatchlist } from './watchlist-context';
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
  const fixture = `${game.away_team.name} v ${game.home_team.name}`;

  return (
    <button
      type="button"
      aria-pressed={watched}
      aria-label={watched ? `Stop watching ${fixture}` : `Watch ${fixture}`}
      title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
      onClick={(event) => {
        // The card behind this is a link covering the whole row.
        event.preventDefault();
        event.stopPropagation();
        void watchlist.toggle(game);
      }}
      className={`grid size-8 shrink-0 place-items-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
        watched
          ? 'border-amber-300/30 bg-amber-400/12 text-amber-300 hover:bg-amber-400/20'
          : 'border-white/10 bg-white/[.03] text-white/30 hover:border-white/20 hover:text-white/70'
      } ${className}`}
    >
      <Star className="size-4" fill={watched ? 'currentColor' : 'none'} />
    </button>
  );
}
