/**
 * GET /api/live
 *
 * Games currently in progress across the supported sports.
 *
 * Only games whose normalised status is `live` are returned — scheduled,
 * finished, postponed and cancelled games are excluded, so a game leaves the
 * scoreboard on the first refresh after it ends and joins it on the first
 * refresh after it starts.
 *
 * Sports information only: no odds, spreads, totals, bookmakers, markets or
 * predictions.
 */

import { liveConfig } from '@/lib/config';
import { getLive, liveTimezone } from '@/lib/live/service';
import type { LiveResponse } from '@/lib/live/types';
import { json } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const { games, upcoming, updatedAt, failed } = await getLive();

  const body: LiveResponse = {
    updated_at: updatedAt,
    timezone: liveTimezone,
    refresh_interval_ms: liveConfig.refreshIntervalMs,
    games,
    upcoming,
    ...(failed ? { error: 'live_data_unavailable' as const } : {}),
  };

  return json(body);
}
