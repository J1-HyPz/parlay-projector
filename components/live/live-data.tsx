'use client';

/**
 * Live scoreboard polling.
 *
 * Three things this deliberately gets right:
 *
 * - **No overlapping requests.** A refresh in flight blocks another from
 *   starting, so a slow response cannot pile up behind itself.
 * - **Pauses when hidden.** Polling stops while the tab is in the background
 *   and refreshes immediately on return, so a forgotten tab stops costing
 *   provider budget.
 * - **Keeps stale data.** A failed refresh leaves the last good scoreboard on
 *   screen with a warning, rather than blanking the page.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveResponse } from '@/lib/live/types';

export type LiveLoadState = 'loading' | 'loaded' | 'error';

export interface LiveData {
  state: LiveLoadState;
  data: LiveResponse | null;
  /** True when the last refresh failed but earlier data is still shown. */
  stale: boolean;
  refresh: () => void;
}

const FALLBACK_INTERVAL_MS = 30_000;

export function useLive(): LiveData {
  const [state, setState] = useState<LiveLoadState>('loading');
  const [data, setData] = useState<LiveResponse | null>(null);
  const [stale, setStale] = useState(false);

  // Refs rather than state: these coordinate the effect without re-triggering it.
  const inFlight = useRef(false);
  const hasData = useRef(false);
  const intervalMs = useRef(FALLBACK_INTERVAL_MS);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const response = await fetch('/api/live', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`request failed: ${response.status}`);

      const body = (await response.json()) as LiveResponse;

      if (typeof body.refresh_interval_ms === 'number' && body.refresh_interval_ms >= 10_000) {
        intervalMs.current = body.refresh_interval_ms;
      }

      if (body.error) {
        // A total provider failure: keep whatever is already on screen.
        if (hasData.current) setStale(true);
        else setState('error');
        return;
      }

      setData(body);
      hasData.current = true;
      setStale(false);
      setState('loaded');
    } catch {
      if (hasData.current) setStale(true);
      else setState('error');
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        await load();
      }
      if (!cancelled) timer = setTimeout(tick, intervalMs.current);
    };

    void tick();

    // Refresh straight away when the tab comes back, rather than waiting out
    // the remainder of an interval that elapsed while hidden.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  return { state, data, stale, refresh: () => void load() };
}

/** `21:24:30` in the scoreboard's timezone. Never a raw ISO string. */
export function formatUpdatedAt(iso: string | undefined, timezone: string): string | null {
  if (!iso) return null;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: timezone,
  }).format(instant);
}
