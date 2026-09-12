/**
 * GET /api/parlays?risk=&sport=&league=&legs=&variant=&markets=&type=&date=
 *
 * A generated line for the requested risk profile.
 *
 * `sport` and `league` narrow the candidate pool *before* anything is
 * projected, and they are binding. A request for the Premier League that only
 * two matches qualify for returns two legs and says so; it never reaches into
 * another competition for a third, however much better that leg would score.
 * The filter is the reader's, and nothing here is entitled to overrule it.
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
 * `markets` narrows to what a reader can act on: `available` keeps only lines
 * a bookmaker was confirmed to be offering, `main` keeps the headline markets.
 * `type` chooses between one leg per fixture and several from a single one.
 *
 * `games` hands the fixture choice to the reader — this is what the Slip uses.
 * Given a list of ids, the candidate pool is cut to those fixtures before
 * anything is ranked, and the optimiser picks the strongest market on each. So
 * the reader decides *which matches*, the model decides *what to back on them*,
 * and the risk profile still decides what is allowed at all. A fixture that
 * offers nothing at the chosen risk contributes no leg rather than a weak one.
 *
 * Where a bookmaker's prices are available they are carried through, alongside
 * the implied probability and the gap between it and the model's. That gap is
 * reported as disagreement, never as an assurance of value. Where no price is
 * available the selection says so, and no number is invented to fill the space.
 */

import { json } from '@/lib/home/api';
import { ALL_SPORTS, describeScope, resolveScope } from '@/lib/leagues/catalogue';
import { logger } from '@/lib/logger';
import { invalidateAccuracy } from '@/lib/projections/accuracy';
import { APP_TIMEZONE } from '@/lib/config';
import { scheduleRange } from '@/lib/schedule/range';
import { MAX_LEGS, MIN_LEGS } from '@/lib/projections/config';
import {
  availableDays,
  optimise,
  selectionsForGames,
  selectionsOnDate,
} from '@/lib/projections/optimiser';
import type { MarketFilter } from '@/lib/projections/optimiser';
import { buildMixed, buildSameGame } from '@/lib/projections/same-game';
import type { FixtureBundle } from '@/lib/projections/same-game';
import { buildCandidates, gameCandidates } from '@/lib/projections/service';
import { getGameDetail } from '@/lib/games/service';
import type { Game } from '@/lib/home/types';
import { publishPredictions } from '@/lib/projections/store';
import type { ActualOutcome, PredictionStatus } from '@/lib/projections/types';
import { MODEL_VERSION } from '@/lib/projections/types';
import type { RiskLevel, Selection } from '@/lib/projections/types';

export const dynamic = 'force-dynamic';

/** The tracker's live view of one leg. */
interface LegTracking {
  status: PredictionStatus;
  result: string | null;
  actual: ActualOutcome | null;
  final_pre_game: boolean;
}

const RISKS: readonly RiskLevel[] = ['low', 'medium', 'high'];
const MARKET_FILTERS: readonly MarketFilter[] = ['available', 'main'];

/**
 * The strongest same-game line across the eligible fixtures.
 *
 * Tries fixtures in order of their best selection and stops at the first that
 * yields a combination. Bounded deliberately: each attempt re-simulates a
 * fixture to count joint probabilities, and a page request must not turn into
 * two hundred of those.
 */
const SAME_GAME_ATTEMPTS = 6;

/**
 * How many fixtures a reader may hand-pick.
 *
 * Matches the slip's own cap, and bounded so a crafted query string cannot turn
 * one request into an unbounded scan.
 */
const MAX_CHOSEN_GAMES = 30;

/**
 * How many fixtures a mixed line will re-simulate.
 *
 * Several bets on one match need that match's simulated games to count the
 * joint probability, and the bulk candidate build deliberately does not keep
 * them. Each fixture is therefore re-projected, which is affordable for a
 * handful and not for a card.
 */
const MAX_MIXED_GAMES = 8;

/**
 * Bets a single match may contribute.
 *
 * One is the ordinary rule and the default everywhere. Above that the legs
 * from a fixture are correlated, and the arithmetic changes — see buildMixed.
 */
const MAX_PER_GAME = 3;

/**
 * Candidates and simulations for each chosen fixture.
 *
 * Bounded and sequential-ish by design: this is the expensive path, and it is
 * only reached when a reader has asked for more than one bet on a match.
 */
async function bundlesFor(gameIds: readonly string[]): Promise<FixtureBundle[]> {
  const bundles: FixtureBundle[] = [];

  for (const gameId of gameIds.slice(0, MAX_MIXED_GAMES)) {
    const detail = await getGameDetail(gameId);
    if (detail.kind !== 'ok') continue;

    const candidates = await gameCandidates(detail.game as unknown as Game);
    // A fight or a match has one market and no simulations, so it cannot
    // contribute more than one leg; it is left to the ordinary optimiser.
    if (!candidates || !candidates.outcome) continue;

    bundles.push({
      gameId,
      selections: candidates.selections,
      distribution: candidates.outcome.distribution,
    });
  }

  return bundles;
}

async function bestSameGame(
  selections: readonly Selection[],
  options: { risk: RiskLevel; legs?: number; markets: MarketFilter; variant: number },
) {
  // Rank fixtures by their strongest candidate, so the most promising are
  // tried first rather than whichever happens to come back first.
  const byGame = new Map<string, number>();
  for (const selection of selections) {
    const best = byGame.get(selection.game_id) ?? 0;
    if (selection.score > best) byGame.set(selection.game_id, selection.score);
  }

  const ranked = [...byGame.entries()].sort((a, b) => b[1] - a[1]).map(([gameId]) => gameId);
  // The variant walks the fixture list, so Regenerate moves to another game
  // rather than re-emitting the same builder.
  const start = ranked.length > 0 ? options.variant % ranked.length : 0;
  const rotated = [...ranked.slice(start), ...ranked.slice(0, start)];

  let eligibleCount = 0;

  for (const gameId of rotated.slice(0, SAME_GAME_ATTEMPTS)) {
    const detail = await getGameDetail(gameId);
    if (detail.kind !== 'ok') continue;

    const candidates = await gameCandidates(detail.game as unknown as Game);
    // No same-game line from a fight or a match: one market, two sides that
    // exclude each other, and nothing to count a second leg against.
    if (!candidates || !candidates.outcome) continue;

    const result = buildSameGame(candidates.selections, candidates.outcome.distribution, {
      risk: options.risk,
      legs: options.legs,
      markets: options.markets,
      variant: options.variant,
    });

    eligibleCount = Math.max(eligibleCount, result.eligibleCount);
    if (result.parlay) return { ...result, gamesAvailable: ranked.length };
  }

  return { parlay: null, eligibleCount, gamesAvailable: ranked.length };
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const requestedRisk = (params.get('risk') ?? 'medium').toLowerCase();
  if (!(RISKS as readonly string[]).includes(requestedRisk)) {
    return json({ error: 'invalid_risk', message: 'Risk must be low, medium or high.' }, 400);
  }
  const risk = requestedRisk as RiskLevel;

  /*
   * The sport and competition, resolved together.
   *
   * Rejected rather than widened when either is unknown, or when the
   * competition belongs to another sport. Failing open would mean a stale
   * bookmark quietly returned a line from somewhere the reader did not ask
   * about, which is the one outcome a filter exists to prevent.
   */
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
  const sport = scope.sport;

  const rawLegs = Number.parseInt(params.get('legs') ?? '', 10);
  const legs = Number.isFinite(rawLegs)
    ? Math.min(Math.max(rawLegs, MIN_LEGS), MAX_LEGS)
    : undefined;

  const rawVariant = Number.parseInt(params.get('variant') ?? '', 10);
  const variant = Number.isFinite(rawVariant) ? Math.abs(rawVariant) : 0;

  /*
   * `any` used to mean "include markets nobody offers" and was the default.
   * It is accepted and read as `available` rather than rejected, so a saved
   * link or a bookmarked slip keeps working -- it simply no longer returns
   * legs that cannot be placed.
   */
  const requestedMarkets = (params.get('markets') ?? 'available').toLowerCase();
  const normalisedMarkets = requestedMarkets === 'any' ? 'available' : requestedMarkets;
  if (!(MARKET_FILTERS as readonly string[]).includes(normalisedMarkets)) {
    return json(
      { error: 'invalid_markets', message: 'Markets must be available or main.' },
      400,
    );
  }
  const markets = normalisedMarkets as MarketFilter;

  /*
   * Several legs from one match need a single sport selected, and this is
   * enforced here rather than only offered in the interface.
   *
   * A same-game line is built from one fixture's own simulations, so its legs
   * are counted together rather than multiplied. That reasoning is sound
   * within a sport and misleading across several: asked for "all sports", the
   * engine ranks candidates from football, basketball and baseball against one
   * another and then stacks several legs onto whichever single fixture happens
   * to rank highest, which is a bet about one match wearing the label of a
   * survey of the evening. Narrowing to a sport first is what makes the
   * request mean what it says.
   *
   * A request for several-per-game across every sport is quietly served as one
   * leg per fixture rather than refused, and the response says so, because the
   * honest answer to it is the ordinary parlay.
   */
  const singleSport = sport !== ALL_SPORTS;

  const askedSameGame = (params.get('type') ?? 'multi').toLowerCase() === 'same';
  const sameGame = askedSameGame && singleSport;

  /*
   * How many bets one match may contribute.
   *
   * One keeps the long-standing rule: a leg per fixture, so the product of the
   * legs means something. Above one the legs from a match are correlated and
   * the combined figure is counted within each fixture before being multiplied
   * between them.
   */
  const rawPerGame = Number.parseInt(params.get('per_game') ?? '', 10);
  const askedPerGame = Number.isFinite(rawPerGame)
    ? Math.min(Math.max(rawPerGame, 1), MAX_PER_GAME)
    : 1;
  const perGame = singleSport ? askedPerGame : 1;

  /** Whether a several-per-game request was reduced for want of a single sport. */
  const multiGameNarrowed = (askedSameGame || askedPerGame > 1) && !singleSport;

  /*
   * Fixtures the reader picked, if any.
   *
   * De-duplicated, shape-checked and capped here rather than trusted: these
   * arrive in a query string. An id matching nothing contributes nothing, and
   * is reported back so the interface can say a fixture has gone — which
   * happens when a match kicks off while the page is open.
   */
  const chosenGames = [
    ...new Set(
      (params.get('games') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= 64),
    ),
  ].slice(0, MAX_CHOSEN_GAMES);

  const { selections, failedLeagues, pricedGames } = await buildCandidates({
    sport,
    league: scope.league,
  });

  const window = scheduleRange(APP_TIMEZONE);
  const days = availableDays(selections, window.dates, risk, APP_TIMEZONE, markets);

  /*
   * A date outside the window is ignored rather than rejected: the window
   * rolls forward at midnight, and a page left open overnight should quietly
   * fall back to every day rather than start erroring.
   */
  const requestedDate = params.get('date');
  const date =
    requestedDate && window.dates.includes(requestedDate) ? requestedDate : null;

  const onDay = date ? selectionsOnDate(selections, date, APP_TIMEZONE) : selections;

  /*
   * The reader's fixture choice, applied before anything is ranked.
   *
   * Binding in the same way the sport and competition filters are: there is no
   * later stage that could reach past it for a stronger leg elsewhere. Pick
   * three fixtures and the line has at most three legs, from those three.
   */
  const pool = chosenGames.length > 0 ? selectionsForGames(onDay, chosenGames) : onDay;

  /*
   * Which of the chosen fixtures the engine can actually see.
   *
   * A fixture drops out between the picker and the request when it kicks off,
   * or when it never had enough history to project. Saying which is better than
   * quietly returning a shorter line than was asked for.
   */
  const usableGames = new Set(pool.map((selection) => selection.game_id));
  const missingGames = chosenGames.filter((id) => !usableGames.has(id));

  /*
   * Fixtures the model actually had an opinion about, before any risk gate.
   *
   * Reported beside `games_available`, which counts only the ones whose
   * selections then cleared the reader's risk level, because the difference
   * between the two is a different answer and the page was giving the wrong
   * one. "No event has enough completed history to project" was printed
   * whenever nothing cleared the gate — so a college football card with
   * nineteen projected fixtures, none of them confident enough to stake, read
   * as a competition the model knew nothing about.
   */
  const projectedGames = usableGames.size;

  /*
   * A same-game line needs the fixture's simulations, which the bulk candidate
   * build does not keep — so it re-projects a handful of fixtures rather than
   * holding ten thousand simulated games each for every fixture on the card.
   */
  /*
   * How long the line should be.
   *
   * Choosing fixtures is itself a statement about length: someone who picked
   * four matches wants a four-leg line, not the risk profile's default of three
   * with one of their picks quietly left out. An explicit `legs` still wins, so
   * asking for the best three of five remains possible.
   */
  const requestedLegs =
    legs ?? (chosenGames.length > 0 ? Math.min(usableGames.size, MAX_LEGS) : undefined);

  /*
   * More than one bet per match needs each fixture's simulations, which the
   * bulk build does not keep. Only reached when asked for, and only for
   * fixtures the reader named — re-projecting the whole card would be
   * unaffordable and pointless.
   */
  const mixed = perGame > 1 && !sameGame && usableGames.size > 0;

  const result = sameGame
    ? await bestSameGame(pool, { risk, legs: requestedLegs, markets, variant })
    : mixed
      ? buildMixed(await bundlesFor([...usableGames]), {
          risk,
          perGame,
          legs: legs ?? undefined,
          markets,
          variant,
        })
      : optimise(pool, { risk, legs: requestedLegs, markets, variant });

  /*
   * How many legs this filter can actually support.
   *
   * A multi-game line takes at most one selection per fixture, so the number of
   * qualifying fixtures *is* the ceiling — which lets the selector grey out leg
   * counts it cannot reach rather than accepting a request for five and
   * returning three without explanation. A same-game line draws several legs
   * from one fixture, so no such ceiling applies to it.
   */
  const maxLegs = sameGame
    ? MAX_LEGS
    : Math.min(result.gamesAvailable * perGame, MAX_LEGS);

  const described = describeScope(scope);
  const scopeBlock = {
    sport,
    league: scope.league,
    sport_label: described.sport,
    league_label: described.competition,
  };

  /*
   * The reader's fixture choice, echoed back.
   *
   * Absent when they made none, so a caller can tell "built from the whole
   * card" from "built from the matches I named", which are different claims
   * about a similar-looking line.
   */
  const chosenBlock =
    chosenGames.length > 0
      ? {
          requested: chosenGames.length,
          used: usableGames.size,
          ...(missingGames.length > 0 ? { unavailable: missingGames } : {}),
        }
      : null;

  if (!result.parlay) {
    return json({
      model_version: MODEL_VERSION,
      risk,
      scope: scopeBlock,
      chosen: chosenBlock,
      per_game: perGame,
      // True when several-per-game was asked for without a single sport, so
      // the interface can say why it served an ordinary parlay instead.
      multi_per_game_needs_one_sport: multiGameNarrowed,
      max_legs: maxLegs,
      date,
      dates: window.dates,
      days,
      parlay: null,
      error: 'insufficient_candidates' as const,
      eligible: result.eligibleCount,
      games_available: result.gamesAvailable,
      projected_games: projectedGames,
      markets,
      type: sameGame ? ('same_game' as const) : ('multi_game' as const),
      priced_games: pricedGames,
      ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
    });
  }

  /*
   * Publishing is what makes the accuracy figures mean anything: the
   * probability and the settlement rule are frozen now, and judged later
   * against the real result. Idempotent, so pressing Regenerate does not
   * inflate the sample.
   */
  let tracking: Record<string, LegTracking> = {};

  try {
    const published = await publishPredictions(result.parlay.legs, risk, {
      // Frozen with the line, so a success rate can later be read per
      // competition rather than only across everything at once.
      scope: {
        sport,
        league: scope.league,
        legs: result.parlay.legs.length,
        // Recorded so a curated line can later be measured apart from one the
        // optimiser assembled end to end.
        ...(chosenGames.length > 0 ? { games: usableGames.size } : {}),
      },
      // The claimed figure, not a recomputation. A same-game line's estimate
      // is a measured joint probability; multiplying its legs would store a
      // number the model never gave and then hold it to that.
      combinedProbability: result.parlay.combined_probability,
      kind: result.parlay.kind,
    });
    if (published.created > 0) {
      // A newly published line changes what the accuracy figures are measuring.
      invalidateAccuracy();
    }

    /*
     * The tracker's view of each leg, so the line shows what is actually
     * happening to it: pending, live, won, lost.
     *
     * Status only. The probability on the leg is what the model said before
     * kick-off and is never recomputed — a prediction that looks good at
     * half-time was not a better prediction when it was made.
     */
    // Reusing what publishing already read: a second full read here would
    // grow with the prediction history, on every request.
    const byId = new Map(published.records.map((record) => [record.id, record]));

    for (const leg of result.parlay.legs) {
      const record = byId.get(leg.id);
      if (!record) continue;
      tracking[leg.id] = {
        status: record.status,
        result: record.result,
        actual: record.actual,
        final_pre_game: record.final_pre_game,
      };
    }
  } catch (error) {
    // Belt and braces: the store already swallows a write failure, but nothing
    // about recording a prediction should be able to withhold the line itself.
    logger.warn('parlay_publish_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    tracking = {};
  }

  return json({
    model_version: MODEL_VERSION,
    risk,
    scope: scopeBlock,
    chosen: chosenBlock,
    per_game: perGame,
    // True when several-per-game was asked for without a single sport, so the
    // interface can say why it served an ordinary parlay instead.
    multi_per_game_needs_one_sport: multiGameNarrowed,
    max_legs: maxLegs,
    date,
    dates: window.dates,
    days,
    parlay: result.parlay,
    tracking,
    eligible: result.eligibleCount,
    games_available: result.gamesAvailable,
    projected_games: projectedGames,
    markets,
    type: sameGame ? ('same_game' as const) : ('multi_game' as const),
    priced_games: pricedGames,
    ...(failedLeagues.length > 0 ? { partial_failures: failedLeagues.length } : {}),
  });
}
