/**
 * GET /api/leagues/:leagueId/standings
 *
 * Standings grouped by conference or division. NCAA Football returns eleven
 * conferences; the NBA returns two.
 *
 * 404 for an unknown league; 200 with `groups: []` when the provider publishes
 * no table — never a fabricated one.
 *
 * `supported` separates the two ways that list comes back empty: false when no
 * table is published for this competition, true when one is and this request
 * did not bring it back. Only the second is a fault.
 */

import { json } from '@/lib/home/api';
import { parseLeagueId } from '@/lib/leagues/registry';
import { getStandings } from '@/lib/leagues/service';

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

  const result = await getStandings(league);
  return json({
    league: { id: league.id, label: league.label },
    groups: result.state === 'ok' ? result.value : [],
    supported: result.state !== 'unsupported',
    ...(result.state === 'failed' ? { error: 'league_data_unavailable' as const } : {}),
  });
}
