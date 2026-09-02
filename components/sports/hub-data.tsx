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

import { useEffect, useState } from 'react';
import type { Game, NewsArticle } from '@/lib/home/types';
import type { StandingsGroup, TeamProfile } from '@/lib/leagues/types';
import type { Transaction } from '@/lib/leagues/transactions-normalise';

export type LoadState = 'loading' | 'loaded' | 'error';

interface Loaded<T> {
  state: LoadState;
  data: T | null;
}

/**
 * Fetch JSON from several endpoints and combine them.
 *
 * Takes a list because the combined NCAA basketball hub covers two leagues.
 * `combine` receives only the responses that succeeded, so one division being
 * unavailable does not discard the other.
 */
function useEndpoints<TResponse, TResult>(
  urls: readonly string[],
  combine: (responses: TResponse[]) => TResult,
): Loaded<TResult> {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<TResult | null>(null);
  // Re-run when the set of urls changes, e.g. the NCAA division selector.
  const key = urls.join('|');

  useEffect(() => {
    const controller = new AbortController();
    setState('loading');

    async function load() {
      const settled = await Promise.allSettled(
        urls.map(async (url) => {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
          });
          if (!response.ok) throw new Error(String(response.status));
          return (await response.json()) as TResponse;
        }),
      );

      if (controller.signal.aborted) return;

      const ok = settled
        .filter(
          (outcome): outcome is PromiseFulfilledResult<TResponse> =>
            outcome.status === 'fulfilled',
        )
        .map((outcome) => outcome.value);

      if (ok.length === 0) {
        setState('error');
        return;
      }

      setData(combine(ok));
      setState('loaded');
    }

    void load();
    return () => controller.abort();
    // `combine` is defined inline by callers; `key` captures what actually varies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { state, data };
}

// ---------------------------------------------------------------------------

interface GamesResponse {
  games?: Game[];
  today?: string;
  timezone?: string;
  error?: string;
}

export interface HubGamesData {
  games: Game[];
  today: string;
  timezone: string;
}

export function useHubGames(leagueIds: readonly string[]): Loaded<HubGamesData> {
  return useEndpoints<GamesResponse, HubGamesData>(
    leagueIds.map((id) => `/api/leagues/${encodeURIComponent(id)}/games`),
    (responses) => ({
      games: responses.flatMap((response) => response.games ?? []),
      today: responses[0]?.today ?? '',
      timezone: responses[0]?.timezone ?? 'Europe/London',
    }),
  );
}

interface StandingsResponse {
  groups?: StandingsGroup[];
}

export function useHubStandings(leagueId: string | null): Loaded<StandingsGroup[]> {
  return useEndpoints<StandingsResponse, StandingsGroup[]>(
    leagueId ? [`/api/leagues/${encodeURIComponent(leagueId)}/standings`] : [],
    (responses) => responses.flatMap((response) => response.groups ?? []),
  );
}

interface TeamsResponse {
  teams?: TeamProfile[];
}

export function useHubTeams(leagueId: string | null): Loaded<TeamProfile[]> {
  return useEndpoints<TeamsResponse, TeamProfile[]>(
    leagueId ? [`/api/leagues/${encodeURIComponent(leagueId)}/teams`] : [],
    (responses) => responses.flatMap((response) => response.teams ?? []),
  );
}

interface NewsResponse {
  articles?: NewsArticle[];
}

export function useHubNews(leagueIds: readonly string[], limit: number): Loaded<NewsArticle[]> {
  return useEndpoints<NewsResponse, NewsArticle[]>(
    leagueIds.map((id) => `/api/leagues/${encodeURIComponent(id)}/news?limit=${limit}`),
    (responses) =>
      responses
        .flatMap((response) => response.articles ?? [])
        .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
        .slice(0, limit),
  );
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
  return useEndpoints<TransactionsResponse, HubTransactionsData>(
    leagueIds.map((id) => `/api/leagues/${encodeURIComponent(id)}/transactions?limit=${limit}`),
    (responses) => ({
      // Supported if any league in the hub publishes them.
      supported: responses.some((response) => response.supported === true),
      transactions: responses
        .flatMap((response) => response.transactions ?? [])
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit),
    }),
  );
}
