/**
 * GET /api/leagues/:leagueId/teams
 *
 * Every team in a league, with logo, abbreviation and colour.
 */

import { json } from '@/lib/home/api';
import { parseLeagueId } from '@/lib/leagues/registry';
import { getTeams } from '@/lib/leagues/service';

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

  const teams = await getTeams(league);
  return json({
    league: { id: league.id, label: league.label },
    teams: teams ?? [],
    ...(teams ? {} : { error: 'league_data_unavailable' as const }),
  });
}
