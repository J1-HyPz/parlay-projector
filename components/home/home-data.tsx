'use client';

/**
 * Homepage data provider.
 *
 * One request to `/api/home` feeds all four sections. Sections then read the
 * shared state and decide independently whether they are loading, loaded, empty
 * or unavailable — a news outage must not blank out games or accuracy.
 */

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { HomeErrorCode, HomeResponse } from '@/lib/home/types';

export type LoadState = 'loading' | 'loaded' | 'error';

interface HomeData {
  state: LoadState;
  data: HomeResponse | null;
}

const HomeDataContext = createContext<HomeData>({ state: 'loading', data: null });

export function useHomeData(): HomeData {
  return useContext(HomeDataContext);
}

/** True when the whole request failed, or when this specific section degraded. */
export function useSectionFailed(code: HomeErrorCode): boolean {
  const { state, data } = useHomeData();
  if (state === 'error') return true;
  return data?.errors.includes(code) ?? false;
}

export function HomeDataProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<HomeData>({ state: 'loading', data: null });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/home', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`request failed: ${response.status}`);
        const body = (await response.json()) as HomeResponse;
        setValue({ state: 'loaded', data: body });
      } catch {
        if (controller.signal.aborted) return;
        setValue({ state: 'error', data: null });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  return <HomeDataContext.Provider value={value}>{children}</HomeDataContext.Provider>;
}

/** Short time in the response's timezone, e.g. `19:45`. */
export function formatTime(iso: string | null, timeZone: string): string {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    }).format(date);
  } catch {
    return '--';
  }
}

/** Compact relative age, e.g. `2h ago`. */
export function formatRelative(iso: string | null): string {
  if (!iso) return '--';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '--';

  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  return `${Math.round(hours / 24)}d ago`;
}
