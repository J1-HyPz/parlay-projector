/**
 * GET /api/schedule
 *
 * Games from today through today + 7 inclusive, in the application timezone.
 *
 * Query: ?sport=all|nfl|nba|mlb|nhl|football|tennis  (default: all)
 *
 * The window is fixed at 8 dates and derived server-side. There are
 * deliberately no caller-supplied date parameters, so no request can widen the
 * range and burn the provider allowance.
 *
 * Sports information only — no odds, spreads, totals, bookmakers or markets.
 */

import { getSchedule } from '@/lib/schedule/service';
import type { ScheduleResponse } from '@/lib/schedule/types';
import { invalidSport, json, parseSport } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const sport = parseSport(new URL(request.url).searchParams.get('sport'));
  if (sport === null) {
    return invalidSport();
  }

  const { range, games, failed } = await getSchedule(sport);

  const body: ScheduleResponse = {
    start_date: range.start,
    end_date: range.end,
    dates: range.dates,
    timezone: range.timezone,
    games,
    ...(failed ? { error: 'schedule_data_unavailable' as const } : {}),
  };

  return json(body);
}
