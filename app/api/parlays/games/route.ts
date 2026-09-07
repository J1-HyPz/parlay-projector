/**
 * GET /api/parlays/games?risk=&sport=&league=&date=&markets=
 *
 * The fixtures a line could be built from, for a reader choosing between them.
 *
 * The same candidate build the generator uses, narrowed by the same filters,
 * then summarised one fixture at a time: what the model's best idea about it
 * is, how likely it rates it, and how many other markets on the fixture clear
 * the risk profile. Picking a fixture is picking a leg — which market it turns
 * out to be is the model's job, and it is shown so nothing is a surprise.
 *
 * Ordered by the score the optimiser ranks on rather than by kick-off or by
 * raw probability, so working down from the top is agreeing with the model.
 *
 * Risk matters here: a fixture that offers nothing at low risk may offer three
 * things at high, so the list is a property of the profile and not of the day.
 */

import { json } from '@/lib/home/api';
import { APP_TIMEZONE } from '@/lib/config';
import { describeScope, resolveScope } from '@/lib/leagues/catalogue';
import { RISK_PROFILES } from '@/lib/projections/config';
import { fixtureOptions, selectionsOnDate } from '@/lib/projections/optimiser';
import type { MarketFilter } from '@/lib/projections/optimiser';
import { buildCandidates } from '@/lib/projections/service';
import { scheduleRange } from '@/lib/schedule/range';
import { MODEL_VERSION } from '@/lib/projections/types';
import type { RiskLevel } from '@/lib/projections/types';

export const dynamic = 'force-dynamic';

const RISKS: readonly RiskLevel[] = ['low', 'medium', 'high'];
const MARKET_FILTERS: readonly MarketFilter[] = ['any', 'available', 'main'];

/**
 * How many fixtures to offer.
 *
 * Generous enough to cover a full weekend card, bounded so a quiet request
 * cannot return three hundred rows to a phone.
 */
const MAX_FIXTURES = 60;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const requestedRisk = (params.get('risk') ?? 'medium').toLowerCase();
  if (!(RISKS as readonly string[]).includes(requestedRisk)) {
    return json({ error: 'invalid_risk', message: 'Risk must be low, medium or high.' }, 400);
  }
  const risk = requestedRisk as RiskLevel;

  const scope = resolveScope(params.get('sport'), params.get('league'));
  if (scope === null) {
    return json(
      {
        error: 'invalid_scope',
        message: 'Unknown sport or competition, or the two do not belong together.',
      },
      400,
    );
  }

  const requestedMarkets = (params.get('markets') ?? 'any').toLowerCase();
  if (!(MARKET_FILTERS as readonly string[]).includes(requestedMarkets)) {
    return json(
      { error: 'invalid_markets', message: 'Markets must be any, available or main.' },
      400,
    );
  }
  const markets = requestedMarkets as MarketFilter;

  const { selections, failedLeagues } = await buildCandidates({
    sport: scope.sport,
    league: scope.league,
  });

  const window = scheduleRange(APP_TIMEZONE);
  const requestedDate = params.get('date');
  const date = requestedDate && window.dates.includes(requestedDate) ? requestedDate : null;

  const pool = date ? selectionsOnDate(selections, date, APP_TIMEZONE) : selections;
  const options = fixtureOptions(pool, RISK_PROFILES[risk], markets);

  const described = describeScope(scope);

  return json({
    model_version: MODEL_VERSION,
    risk,
    date,
    markets,
    scope: {
      sport: scope.sport,
      league: scope.league,
      sport_label: described.sport,
      league_label: described.competition,
    },
    /** Fixtures beyond the cap, so the interface can say the list is trimmed. */
    total: options.length,
    fixtures: options.slice(0, MAX_FIXTURES).map((option) => ({
      game_id: option.game_id,
      sport: option.sport,
      league: option.league,
      fixture: option.fixture,
      start_time: option.start_time,
      candidates: option.candidates,
      /*
       * What picking this fixture would most likely contribute.
       *
       * The optimiser may still take a different market once the line is
       * assembled — it balances the whole slip — so this is described as the
       * strongest idea rather than promised as the leg.
       */
      best: {
        id: option.best.id,
        label: option.best.label,
        market: option.best.market.label,
        availability: option.best.market.availability,
        probability: option.best.probability,
        probability_label: option.best.probability_label,
        confidence: option.best.confidence,
        data_quality: option.best.data_quality,
        price: option.best.market.price,
      },
    })),
    ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
  });
}
