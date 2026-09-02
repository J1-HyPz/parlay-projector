/**
 * GET /api/parlays?risk=&sport=&legs=&variant=
 *
 * A generated line for the requested risk profile.
 *
 * Every leg traces back to real results: fixtures and scores from the shared
 * provider layer, ratings derived from them, a sport-specific model, a
 * simulated distribution, and a threshold the selection had to clear. Nothing
 * is padded to fill the requested number of legs — a request for five that only
 * three candidates support returns three.
 *
 * Contains no bookmaker data and no monetary figures. `implied_odds` on a leg
 * is the model's own probability expressed as a decimal, and is labelled as
 * such throughout.
 */

import { json, parseSport } from '@/lib/home/api';
import { MAX_LEGS, MIN_LEGS } from '@/lib/projections/config';
import { optimise } from '@/lib/projections/optimiser';
import { buildCandidates } from '@/lib/projections/service';
import { publishPredictions } from '@/lib/projections/store';
import { MODEL_VERSION } from '@/lib/projections/types';
import type { RiskLevel } from '@/lib/projections/types';

export const dynamic = 'force-dynamic';

const RISKS: readonly RiskLevel[] = ['low', 'medium', 'high'];

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const requestedRisk = (params.get('risk') ?? 'medium').toLowerCase();
  if (!(RISKS as readonly string[]).includes(requestedRisk)) {
    return json({ error: 'invalid_risk', message: 'Risk must be low, medium or high.' }, 400);
  }
  const risk = requestedRisk as RiskLevel;

  const sport = parseSport(params.get('sport'));
  if (sport === null) {
    return json({ error: 'invalid_sport', message: 'Unknown sport.' }, 400);
  }

  const rawLegs = Number.parseInt(params.get('legs') ?? '', 10);
  const legs = Number.isFinite(rawLegs)
    ? Math.min(Math.max(rawLegs, MIN_LEGS), MAX_LEGS)
    : undefined;

  const rawVariant = Number.parseInt(params.get('variant') ?? '', 10);
  const variant = Number.isFinite(rawVariant) ? Math.abs(rawVariant) : 0;

  const { selections, failedLeagues } = await buildCandidates(sport);
  const result = optimise(selections, { risk, legs, variant });

  if (!result.parlay) {
    return json({
      model_version: MODEL_VERSION,
      risk,
      parlay: null,
      error: 'insufficient_candidates' as const,
      eligible: result.eligibleCount,
      games_available: result.gamesAvailable,
      ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
    });
  }

  /*
   * Publishing is what makes the accuracy figures mean anything: the
   * probability and the settlement rule are frozen now, and judged later
   * against the real result. Idempotent, so pressing Regenerate does not
   * inflate the sample.
   */
  await publishPredictions(result.parlay.legs, risk);

  return json({
    model_version: MODEL_VERSION,
    risk,
    parlay: result.parlay,
    eligible: result.eligibleCount,
    games_available: result.gamesAvailable,
    ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
  });
}
