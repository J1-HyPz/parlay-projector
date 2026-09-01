/**
 * GET /api/home/games
 *
 * Games scheduled for today in the configured timezone.
 *
 * Query: ?sport=all|nfl|nba|mlb|nhl|football   (default: all)
 *
 * Sports information only — no odds, spreads, totals or bookmaker data.
 */

import { APP_TIMEZONE } from '@/lib/config';
import { getGamesToday } from '@/lib/home/sports/service';
import type { GamesResponse } from '@/lib/home/types';
import { badRequest, json, parseSport } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const sport = parseSport(new URL(request.url).searchParams.get('sport'));
  if (sport === null) {
    return badRequest('sport must be one of: all, nfl, nba, mlb, nhl, football');
  }

  const { date, games, failed } = await getGamesToday(sport);

  const body: GamesResponse = {
    date,
    timezone: APP_TIMEZONE,
    sport,
    games,
    ...(failed ? { error: 'sports_data_unavailable' as const } : {}),
  };

  return json(body);
}
