'use client';

/**
 * Schedule data hook.
 *
 * One request to `/api/schedule` loads the whole eight-day window. Every
 * subsequent interaction — switching day, sport, league, or typing in the
 * search box — filters that in-memory dataset via `lib/schedule/filters`. No
 * provider request is made per keystroke or per button press.
 */

import { useEffect, useState } from 'react';
import type { ScheduleResponse } from '@/lib/schedule/types';

export type ScheduleLoadState = 'loading' | 'loaded' | 'error';

export function useSchedule() {
  const [state, setState] = useState<ScheduleLoadState>('loading');
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/schedule', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`request failed: ${response.status}`);
        const body = (await response.json()) as ScheduleResponse;
        setData(body);
        // A total provider failure arrives as 200 with an error code.
        setState(body.error ? 'error' : 'loaded');
      } catch {
        if (controller.signal.aborted) return;
        setState('error');
      }
    }

    void load();
    return () => controller.abort();
  }, [reloadToken]);

  return {
    state,
    data,
    retry: () => {
      setState('loading');
      setReloadToken((token) => token + 1);
    },
  };
}
