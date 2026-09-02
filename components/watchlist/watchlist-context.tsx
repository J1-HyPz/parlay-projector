'use client';

/**
 * Shared watchlist state.
 *
 * One fetch per page rather than one per card: a Saturday schedule renders a
 * hundred games, and each asking the server whether it is watched would be a
 * hundred requests to answer a question one response already covers.
 *
 * Toggling is optimistic. Starring a game should feel instant, and the only
 * failure modes are the server being unreachable or the list being full — both
 * of which are corrected by rolling the change back.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { WatchlistEntry } from '@/lib/watchlist/types';

/**
 * The minimum a card must supply to be watchable.
 *
 * Deliberately narrower than `Game`: the schedule, the live scoreboard and the
 * detail page each hold a different shape, and only these fields are common to
 * all three.
 */
export interface WatchableGame {
  id: string;
  sport: string;
  league: string | null;
  start_time: string | null;
  home_team: { name: string };
  away_team: { name: string };
}

interface WatchlistValue {
  entries: WatchlistEntry[];
  ready: boolean;
  isWatched: (gameId: string) => boolean;
  toggle: (game: WatchableGame) => Promise<void>;
  /** Remove by id, for the watchlist view where no game object is at hand. */
  remove: (gameId: string) => Promise<void>;
}

const WatchlistContext = createContext<WatchlistValue | null>(null);

/** Snapshot stored alongside the id, so the list renders without a lookup. */
function snapshot(game: WatchableGame): Omit<WatchlistEntry, 'addedAt'> {
  return {
    gameId: game.id,
    label: `${game.away_team.name} v ${game.home_team.name}`,
    league: game.league,
    sport: game.sport,
    startTime: game.start_time,
  };
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/watchlist', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { entries?: WatchlistEntry[] };
        setEntries(Array.isArray(body.entries) ? body.entries : []);
      } catch {
        // An unreachable list is not worth an error state on a schedule page;
        // the buttons simply render unstarred and a toggle will retry.
        if (!controller.signal.aborted) setEntries([]);
      } finally {
        if (!controller.signal.aborted) setReady(true);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const watchedIds = useMemo(
    () => new Set(entries.map((entry) => entry.gameId)),
    [entries],
  );

  /**
   * Optimistic mutation: apply locally, then reconcile with what the server
   * stored. Rolls back on failure, so a full list or an unreachable server
   * leaves the UI telling the truth.
   */
  const mutate = useCallback(
    async (optimistic: WatchlistEntry[], request: () => Promise<Response>) => {
      const previous = entries;
      setEntries(optimistic);

      try {
        const response = await request();
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as { entries?: WatchlistEntry[] };
        // The server is the authority: it applies the size cap and de-duplicates.
        if (Array.isArray(body.entries)) setEntries(body.entries);
      } catch {
        setEntries(previous);
      }
    },
    [entries],
  );

  const remove = useCallback(
    (gameId: string) =>
      mutate(
        entries.filter((entry) => entry.gameId !== gameId),
        () =>
          fetch(`/api/watchlist?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' }),
      ),
    [entries, mutate],
  );

  const toggle = useCallback(
    (game: WatchableGame) => {
      if (watchedIds.has(game.id)) return remove(game.id);

      const entry = { ...snapshot(game), addedAt: new Date().toISOString() };
      return mutate([...entries, entry], () =>
        fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(snapshot(game)),
        }),
      );
    },
    [entries, watchedIds, mutate, remove],
  );

  const value = useMemo<WatchlistValue>(
    () => ({
      entries,
      ready,
      isWatched: (gameId: string) => watchedIds.has(gameId),
      toggle,
      remove,
    }),
    [entries, ready, watchedIds, toggle, remove],
  );

  return <WatchlistContext.Provider value={value}>{children}</WatchlistContext.Provider>;
}

/**
 * Null outside a provider rather than throwing.
 *
 * A game card is rendered in several places, and one of them forgetting the
 * provider should drop the star, not blank the page.
 */
export function useWatchlist(): WatchlistValue | null {
  return useContext(WatchlistContext);
}
