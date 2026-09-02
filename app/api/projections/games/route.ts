/**
 * GET /api/projections/games?sport=
 *
 * Model projections for every eligible upcoming fixture: scheduled, not yet
 * started, inside the schedule window, and with enough history behind it.
 *
 * A fixture the model cannot support simply does not appear. There is no
 * fallback estimate — "projection unavailable" is the honest answer, and a
 * fabricated percentage is not.
 */

import { json, parseSport } from '@/lib/home/api';
import { buildCandidates } from '@/lib/projections/service';
import { MODEL_VERSION } from '@/lib/projections/types';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const sport = parseSport(new URL(request.url).searchParams.get('sport'));
  if (sport === null) {
    return json({ error: 'invalid_sport', message: 'Unknown sport.' }, 400);
  }

  const { projections, failedLeagues } = await buildCandidates(sport);

  return json({
    model_version: MODEL_VERSION,
    count: projections.length,
    projections: projections.map((outcome) => outcome.projection),
    ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
  });
}
