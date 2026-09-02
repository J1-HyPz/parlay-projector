'use client';

/**
 * Hub data loading.
 *
 * One hook per section, each with its own request and its own state. That is
 * the whole point: news failing must leave scores, standings, teams and
 * transactions working. A single combined request would take the page down
 * with any one provider.
 *
 * Every hook follows the same shape as the existing Schedule and Live hooks —
 * fetch on mount, abort on unmount, never throw.
 */

import { useEffect, useMemo, useState } from 'react';
import type { Game, NewsArticle } from '@/lib/home/types';
import type { StandingsGroup, TeamProfile } from '@/lib/leagues/types';
import type { Transaction } from '@/lib/leagues/transactions-normalise';

export type LoadState = 'loading' | 'loaded' | 'error';

export interface Loaded<T> {
  state: LoadState;
  data: T | null;
}

interface Fetched<T> {
  state: LoadState;
  responses: T[];
}

/**
 * Fetch JSON from several endpoints.
 *
 * Takes a list because the combined NCAA basketball hub covers two leagues.
 * Only the responses that succeeded are returned, so one division being
 * unavailable does not discard the other; the state is `error` only when every
 * request failed.
 *
 * The url list is joined into a single string and split back inside the effect.
 * Callers build these arrays inline, so a new array every render would re-fetch
 * forever — the joined key is what actually changes when the selection does.
 */
function useEndpoints<T>(urls: readonly string[]): Fetched<T> {
  const key = urls.join('|');

  // The result is stamped with the key it belongs to, so "loading" is derived
  // during render rather than set synchronously in the effect -- which would
  // cost an extra render pass every time the selection changes.
  const [result, setResult] = useState<{ key: string; responses: T[]; failed: boolean } | null>(
    null,
  );

  useEffect(() => {
    const targets = key.length > 0 ? key.split('|') : [];
    const controller = new AbortController();

    async function load() {
      const settled = await Promise.allSettled(
        targets.map(async (url) => {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
          });
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as T;
        }),
      );

      if (controller.signal.aborted) return;

      const ok: T[] = [];
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled') ok.push(outcome.value);
      }

      // Failed only when every request failed; one league of a combined hub
      // being unavailable must not discard the other.
      setResult({ key, responses: ok, failed: targets.length > 0 && ok.length === 0 });
    }

    void load();
    return () => controller.abort();
  }, [key]);

  const current = result?.key === key ? result : null;
  const state: LoadState = current === null ? 'loading' : current.failed ? 'error' : 'loaded';

  return { state, responses: current?.responses ?? EMPTY };
}

/** Stable empty array, so the callers' useMemo does not re-run every render. */
const EMPTY: never[] = [];

// ---------------------------------------------------------------------------

interface GamesResponse {
  games?: Game[];
  today?: string;
  timezone?: string;
}

export interface HubGamesData {
  games: Game[];
  today: string;
  timezone: string;
}

export function useHubGames(leagueIds: readonly string[]): Loaded<HubGamesData> {
  const { state, responses } = useEndpoints<GamesResponse>(
    leagueIds.map((id) => `/api/leagues/${encodeURIComponent(id)}/games`),
  );

  const data = useMemo<HubGamesData | null>(() => {
    if (responses.length === 0) return null;
    return {
      games: responses.flatMap((response) => response.games ?? []),
      today: responses[0]?.today ?? '',
      timezone: responses[0]?.timezone ?? 'Europe/London',
    };
  }, [responses]);

  return { state, data };
}

interface StandingsResponse {
  groups?: StandingsGroup[];
}

export function useHubStandings(leagueId: string | null): Loaded<StandingsGroup[]> {
  const { state, responses } = useEndpoints<StandingsResponse>(
    leagueId ? [`/api/leagues/${encodeURIComponent(leagueId)}/standings`] : [],
  );

  const data = useMemo(
    () => (responses.length === 0 ? null : responses.flatMap((r) => r.groups ?? [])),
    [responses],
  );

  return { state, data };
}

interface TeamsResponse {
  teams?: TeamProfile[];
}

export function useHubTeams(leagueId: string | null): Loaded<TeamProfile[]> {
  const { state, responses } = useEndpoints<TeamsResponse>(
    leagueId ? [`/api/leagues/${encodeURIComponent(leagueId)}/teams`] : [],
  );

  const data = useMemo(
    () => (responses.length === 0 ? null : responses.flatMap((r) => r.teams ?? [])),
    [responses],
  );

  return { state, data };
}

interface NewsResponse {
  articles?: NewsArticle[];
}

export function useHubNews(leagueIds: readonly string[], limit: number): Loaded<NewsArticle[]> {
  const { state, responses } = useEndpoints<NewsResponse>(
    leagueIds.map((id) => `/api/leagues/${encodeURIComponent(id)}/news?limit=${limit}`),
  );

  const data = useMemo(() => {
    if (responses.length === 0) return null;
    return responses
      .flatMap((response) => response.articles ?? [])
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
      .slice(0, limit);
  }, [responses, limit]);

  return { state, data };
}

interface TransactionsResponse {
  transactions?: Transaction[];
  supported?: boolean;
}

export interface HubTransactionsData {
  transactions: Transaction[];
  /** False when the provider publishes none for this competition at all. */
  supported: boolean;
}

export function useHubTransactions(
  leagueIds: readonly string[],
  limit: number,
): Loaded<HubTransactionsData> {
  const { state, responses } = useEndpoints<TransactionsResponse>(
    leagueIds.map((id) => `/api/leagues/${encodeURIComponent(id)}/transactions?limit=${limit}`),
  );

  const data = useMemo<HubTransactionsData | null>(() => {
    if (responses.length === 0) return null;
    return {
      // Supported if any league in the hub publishes them.
      supported: responses.some((response) => response.supported === true),
      transactions: responses
        .flatMap((response) => response.transactions ?? [])
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit),
    };
  }, [responses, limit]);

  return { state, data };
}
