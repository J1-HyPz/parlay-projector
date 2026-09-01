/**
 * GET /api/leagues
 *
 * The league catalogue: every competition Parlay Projector can serve data for.
 * Static, so it is safe to cache on the client.
 */

import { json } from '@/lib/home/api';
import { LEAGUES } from '@/lib/leagues/registry';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return json({
    leagues: LEAGUES.map((league) => ({
      id: league.id,
      label: league.label,
      short_label: league.shortLabel,
      group: league.group,
      sport: league.sport,
      collegiate: league.collegiate,
      has_standings: league.hasStandings,
    })),
  });
}
