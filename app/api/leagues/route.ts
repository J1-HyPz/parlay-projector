/**
 * GET /api/leagues
 *
 * The league catalogue: every competition Parlay Projector can serve data for,
 * and the sports the projection engine can build a line from.
 *
 * Both blocks come from the registry rather than from a provider, so this
 * answers instantly and never depends on a third party being reachable — which
 * matters, because the Parlays selector loads it on every visit.
 *
 * `leagues` is every tracked competition. `sports` is the subset the engine has
 * a model for, grouped by sport and shaped for a selector: a sport with nothing
 * projectable is still listed, marked unavailable with the reason, rather than
 * quietly disappearing.
 *
 * Static, so it is safe to cache on the client.
 */

import { json } from '@/lib/home/api';
import { sportOptions } from '@/lib/leagues/catalogue';
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
    sports: sportOptions(),
  });
}
