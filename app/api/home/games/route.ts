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
import { invalidSport, json, parseSport } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const sport = parseSport(new URL(request.url).searchParams.get('sport'));
  if (sport === null) {
    return invalidSport();
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
