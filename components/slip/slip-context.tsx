'use client';

/**
 * Shared slip state.
 *
 * One fetch per page rather than one per card: a Saturday schedule renders a
 * hundred games, and each asking the server whether it is on the slip would be
 * a hundred requests to answer a question one response already covers.
 *
 * Adding is optimistic. It should feel instant, and the only failure modes are
 * the server being unreachable or the slip being full — both corrected by
 * rolling the change back.
 *
 * Deliberately the same shape as the watchlist's provider. They are the same
 * interaction with a different destination, and two different implementations
 * of it would drift.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { SlipEntry } from '@/lib/slip/types';

/**
 * The minimum a card must supply to be addable.
 *
 * Deliberately narrower than `Game`: the schedule, the live scoreboard and the
 * detail page each hold a different shape, and only these fields are common to
 * all of them.
 */
export interface PickableGame {
  id: string;
  sport: string;
  league: string | null;
  start_time: string | null;
  status?: string;
  /**
   * Both sides, for a fixture that has them.
   *
   * A race weekend does not: it is named for itself and contested by a field.
   * Such an event supplies `title` instead, and `pickableLabel` takes whichever
   * is there.
   */
  home_team?: { name: string };
  away_team?: { name: string };
  title?: string | null;
}

/**
 * What to call a picked event.
 *
 * The two sides where there are two, the event's own name otherwise — a Grand
 * Prix is called the Italian Grand Prix, not a pairing of two of its drivers.
 */
export function pickableLabel(game: PickableGame): string {
  if (game.home_team && game.away_team) {
    return `${game.away_team.name} v ${game.home_team.name}`;
  }
  return game.title ?? game.league ?? 'Event';
}

interface SlipValue {
  entries: SlipEntry[];
  ready: boolean;
  /** Set when the last add was refused, so a button can say why. */
  notice: string | null;
  isPicked: (gameId: string) => boolean;
  toggle: (game: PickableGame) => Promise<void>;
  /** Remove by id, for the slip page where no game object is at hand. */
  remove: (gameId: string) => Promise<void>;
  clear: () => Promise<void>;
}

const SlipContext = createContext<SlipValue | null>(null);

/** Snapshot stored alongside the id, so the page renders without a lookup. */
function snapshot(game: PickableGame): Omit<SlipEntry, 'addedAt'> {
  return {
    gameId: game.id,
    label: pickableLabel(game),
    league: game.league,
    sport: game.sport,
    startTime: game.start_time,
  };
}

export function SlipProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<SlipEntry[]>([]);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/slip', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { active?: SlipEntry[]; settled?: SlipEntry[] };
        // The provider holds every entry; the page decides how to section them.
        setEntries([...(body.active ?? []), ...(body.settled ?? [])]);
      } catch {
        // An unreachable slip is not worth an error state on a schedule page;
        // the buttons render unpicked and a click will retry.
        if (!controller.signal.aborted) setEntries([]);
      } finally {
        if (!controller.signal.aborted) setReady(true);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const pickedIds = useMemo(() => new Set(entries.map((entry) => entry.gameId)), [entries]);

  /**
   * Optimistic mutation: apply locally, then reconcile with what the server
   * stored. Rolls back on failure, so a full slip or an unreachable server
   * leaves the interface telling the truth.
   */
  const mutate = useCallback(
    async (optimistic: SlipEntry[], request: () => Promise<Response>) => {
      const previous = entries;
      setEntries(optimistic);
      setNotice(null);

      try {
        const response = await request();
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as { entries?: SlipEntry[]; reason?: string };
        // The server is the authority: it applies the size cap and de-duplicates.
        if (Array.isArray(body.entries)) setEntries(body.entries);
        if (body.reason === 'full') {
          setNotice('The slip is full. Remove a match before adding another.');
        }
      } catch {
        setEntries(previous);
        setNotice('Could not reach the server. Nothing was changed.');
      }
    },
    [entries],
  );

  const remove = useCallback(
    (gameId: string) =>
      mutate(
        entries.filter((entry) => entry.gameId !== gameId),
        () => fetch(`/api/slip?gameId=${encodeURIComponent(gameId)}`, { method: 'DELETE' }),
      ),
    [entries, mutate],
  );

  const clear = useCallback(
    () => mutate([], () => fetch('/api/slip?all=1', { method: 'DELETE' })),
    [mutate],
  );

  const toggle = useCallback(
    (game: PickableGame) => {
      if (pickedIds.has(game.id)) return remove(game.id);

      const entry = { ...snapshot(game), addedAt: new Date().toISOString() };
      return mutate([...entries, entry], () =>
        fetch('/api/slip', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(snapshot(game)),
        }),
      );
    },
    [entries, pickedIds, mutate, remove],
  );

  const value = useMemo<SlipValue>(
    () => ({
      entries,
      ready,
      notice,
      isPicked: (gameId: string) => pickedIds.has(gameId),
      toggle,
      remove,
      clear,
    }),
    [entries, ready, notice, pickedIds, toggle, remove, clear],
  );

  return <SlipContext.Provider value={value}>{children}</SlipContext.Provider>;
}

/**
 * Null outside a provider rather than throwing.
 *
 * A game card is rendered in several places, and one of them forgetting the
 * provider should drop the button, not blank the page.
 */
export function useSlip(): SlipValue | null {
  return useContext(SlipContext);
}
