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
 * `date` narrows the candidates to fixtures kicking off on one day of the
 * schedule window. The response always reports what every day can support, so
 * the selector can show counts and disable days that cannot produce a line —
 * rather than letting someone pick a day and be told afterwards.
 *
 * Contains no bookmaker data and no monetary figures. `implied_odds` on a leg
 * is the model's own probability expressed as a decimal, and is labelled as
 * such throughout.
 */

import { json, parseSport } from '@/lib/home/api';
import { logger } from '@/lib/logger';
import { APP_TIMEZONE } from '@/lib/config';
import { scheduleRange } from '@/lib/schedule/range';
import { MAX_LEGS, MIN_LEGS } from '@/lib/projections/config';
import { availableDays, optimise, selectionsOnDate } from '@/lib/projections/optimiser';
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

  const window = scheduleRange(APP_TIMEZONE);
  const days = availableDays(selections, window.dates, risk, APP_TIMEZONE);

  /*
   * A date outside the window is ignored rather than rejected: the window
   * rolls forward at midnight, and a page left open overnight should quietly
   * fall back to every day rather than start erroring.
   */
  const requestedDate = params.get('date');
  const date =
    requestedDate && window.dates.includes(requestedDate) ? requestedDate : null;

  const pool = date ? selectionsOnDate(selections, date, APP_TIMEZONE) : selections;
  const result = optimise(pool, { risk, legs, variant });

  if (!result.parlay) {
    return json({
      model_version: MODEL_VERSION,
      risk,
      date,
      dates: window.dates,
      days,
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
  try {
    await publishPredictions(result.parlay.legs, risk);
  } catch (error) {
    // Belt and braces: the store already swallows a write failure, but nothing
    // about recording a prediction should be able to withhold the line itself.
    logger.warn('parlay_publish_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  return json({
    model_version: MODEL_VERSION,
    risk,
    date,
    dates: window.dates,
    days,
    parlay: result.parlay,
    eligible: result.eligibleCount,
    games_available: result.gamesAvailable,
    ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
  });
}
