/**
 * GET /api/leagues/:leagueId/teams
 *
 * Every team in a league, with logo, abbreviation and colour.
 *
 * `supported` is false where the provider publishes no competitor list for
 * this competition at all — the UFC and both tennis tours, whose team
 * endpoints answer with an empty array. That is a fact about coverage, not a
 * failure, and it is reported separately from one so a hub can say which.
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

  const result = await getTeams(league);
  return json({
    league: { id: league.id, label: league.label },
    teams: result.state === 'ok' ? result.value : [],
    supported: result.state !== 'unsupported',
    ...(result.state === 'failed' ? { error: 'league_data_unavailable' as const } : {}),
  });
}
