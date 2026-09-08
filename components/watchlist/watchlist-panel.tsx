'use client';

/**
 * The current watchlist, rendered on the notifications page.
 *
 * This is the answer to "what will actually ping me", so it lives next to the
 * delivery status rather than on a page of its own.
 */

import { Star, X } from 'lucide-react';
import { useWatchlist } from './watchlist-context';

function kickoff(startTime: string | null): string {
  if (!startTime) return 'Time to be confirmed';
  const instant = new Date(startTime);
  if (Number.isNaN(instant.getTime())) return 'Time to be confirmed';

  // Composed from parts: en-GB renders a combined month/day as "1 Sept", which
  // is the wrong order for this layout. See lib/schedule/filters.ts.
  const day = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(
    instant,
  );
  const month = new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(instant);
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(
    instant,
  );
  return `${day} ${month}, ${time}`;
}

export function WatchlistPanel() {
  const watchlist = useWatchlist();
  if (!watchlist) return null;

  const { entries, ready } = watchlist;

  return (
    <section className="mt-6" aria-labelledby="watchlist-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 id="watchlist-heading" className="text-base font-semibold">
            Watchlist
          </h2>
          <p className="mt-1 text-xs text-ink-faint">
            Only these games are announced. Each one drops off once it finishes.
          </p>
        </div>
        {entries.length > 0 && (
          <span className="shrink-0 text-xs text-ink-faint">{entries.length} watched</span>
        )}
      </div>

      {!ready ? (
        <p className="mt-3 text-sm text-ink-faint">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="mt-3 rounded-xl border border-line bg-surface-1 px-4 py-5 text-sm text-ink-subtle">
          Nothing is being watched, so nothing will be sent. Star a game on Schedule, Live or
          Home to add it.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.gameId}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3"
            >
              <Star className="size-4 shrink-0 text-amber-300" fill="currentColor" />

              <a
                href={`/games/${entry.gameId}`}
                className="min-w-0 flex-1 transition hover:text-ink-strong focus-ring"
              >
                <span className="block truncate text-sm text-ink">{entry.label}</span>
                <span className="block truncate text-2xs text-ink-faint">
                  {entry.league ? `${entry.league} · ` : ''}
                  {kickoff(entry.startTime)}
                </span>
              </a>

              <button
                type="button"
                aria-label={`Stop watching ${entry.label}`}
                onClick={() => {
                  void watchlist.remove(entry.gameId);
                }}
                className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-1 text-ink-faint transition hover:border-line-strong hover:text-ink-strong focus-ring"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
