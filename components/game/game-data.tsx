'use client';

/**
 * Game detail data + shared formatters.
 *
 * One request to `/api/games/:id` supplies every section on the page, so no
 * component fetches anything of its own.
 */

import { useEffect, useState } from 'react';
import type { ConcreteSportId } from '@/lib/home/types';
import type { GameDetail } from '@/lib/games/types';

export type GameLoadState = 'loading' | 'loaded' | 'not_found' | 'error';

export interface GameDataResult {
  state: GameLoadState;
  game: GameDetail | null;
}

export function useGameDetail(gameId: string): GameDataResult {
  const [result, setResult] = useState<GameDataResult>({ state: 'loading', game: null });

  // No synchronous reset here: the page keys this component on gameId, so a
  // different game mounts a fresh instance already in the loading state.
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });

        if (response.status === 404) {
          setResult({ state: 'not_found', game: null });
          return;
        }
        if (!response.ok) {
          setResult({ state: 'error', game: null });
          return;
        }

        const body = (await response.json()) as { game: GameDetail };
        setResult({ state: 'loaded', game: body.game });
      } catch {
        if (controller.signal.aborted) return;
        setResult({ state: 'error', game: null });
      }
    }

    void load();
    return () => controller.abort();
  }, [gameId]);

  return result;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/** Display timezone. Matches the server's APP_TIMEZONE default. */
const DISPLAY_TZ = 'Europe/London';

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: DISPLAY_TZ,
  }).format(date);
}

export function formatTime(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: DISPLAY_TZ,
  }).format(date);
}

export const STATUS_LABEL: Record<GameDetail['status'], string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  finished: 'Finished',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
  unknown: 'Status unavailable',
};

/** A game shows a score only once it has actually started. */
export function hasScore(game: GameDetail): boolean {
  return (
    game.score !== null && (game.score.home !== null || game.score.away !== null)
  );
}

/**
 * Sport-aware label for the "goals" column of a league table.
 *
 * The provider publishes one shared stat set for every sport, so only the
 * wording changes — no per-sport statistic is invented.
 */
export function scoreNoun(sport: ConcreteSportId): { for: string; against: string } {
  switch (sport) {
    case 'football':
      return { for: 'Goals For', against: 'Goals Against' };
    case 'nhl':
      return { for: 'Goals For', against: 'Goals Against' };
    case 'mlb':
      return { for: 'Runs For', against: 'Runs Against' };
    default:
      return { for: 'Points For', against: 'Points Against' };
  }
}

/**
 * Win-draw-loss record.
 *
 * Draws are omitted for sports that do not have them, rather than printing a
 * misleading `-0-`.
 */
export function formatRecord(
  wins: number | null,
  draws: number | null,
  losses: number | null,
  sport: ConcreteSportId,
): string | null {
  if (wins === null && losses === null) return null;
  const w = wins ?? 0;
  const l = losses ?? 0;
  const showDraws = sport === 'football' || (draws !== null && draws > 0);
  return showDraws ? `${w}-${draws ?? 0}-${l}` : `${w}-${l}`;
}

/** `1` -> `1st`, `2` -> `2nd`. */
export function ordinal(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}
