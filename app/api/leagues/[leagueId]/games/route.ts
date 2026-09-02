/**
 * GET /api/leagues/:leagueId/games
 *
 * Fixtures for one competition across the hub window: today-7 through today+7,
 * so a hub can show recent results as well as what is coming. The Schedule API
 * stops at today and is unchanged.
 *
 * Returns the shared `Game` model, unmodified. Splitting into live / today /
 * results / upcoming happens on the client from these same objects, so there is
 * one source of truth for a fixture.
 *
 * 404 for an unknown league.
 */

import { json } from '@/lib/home/api';
import { parseLeagueId } from '@/lib/leagues/registry';
import { getLeagueGames } from '@/lib/leagues/games';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ leagueId: string }> },
): Promise<Response> {
  const { leagueId } = await context.params;
  const league = parseLeagueId(leagueId);
  if (!league) {
    return json({ error: 'league_not_found', message: 'No such league.' }, 404);
  }

  const result = await getLeagueGames([league]);

  return json({
    league: { id: league.id, label: league.label },
    start_date: result.start,
    end_date: result.end,
    today: result.today,
    timezone: result.timezone,
    games: result.games,
    ...(result.failed ? { error: 'league_data_unavailable' as const } : {}),
  });
}
