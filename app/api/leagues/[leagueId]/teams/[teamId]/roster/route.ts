/**
 * GET /api/leagues/:leagueId/teams/:teamId/roster
 *
 * Players on a team: name, jersey, position, height, weight, age, headshot.
 *
 * Only what the provider actually supplies — an absent field is null and the
 * UI omits it.
 */

import { json } from '@/lib/home/api';
import { parseLeagueId } from '@/lib/leagues/registry';
import { getRoster } from '@/lib/leagues/service';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ leagueId: string; teamId: string }> },
): Promise<Response> {
  const { leagueId, teamId } = await context.params;

  const league = parseLeagueId(leagueId);
  if (!league) {
    return json({ error: 'league_not_found', message: 'No such league.' }, 404);
  }
  // Provider team ids are numeric; reject anything else before calling out.
  if (!/^[0-9]{1,12}$/.test(teamId.trim())) {
    return json({ error: 'league_not_found', message: 'Invalid team id.' }, 404);
  }

  const players = await getRoster(league, teamId.trim());
  return json({
    league: { id: league.id, label: league.label },
    team_id: teamId.trim(),
    players: players ?? [],
    ...(players ? {} : { error: 'league_data_unavailable' as const }),
  });
}
