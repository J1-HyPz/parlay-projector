/**
 * Building a line from candidate selections.
 *
 * Two rules do most of the work:
 *
 *   One selection per game. Every selection from a fixture shares a
 *   correlation group, and the multi-game optimiser takes at most one. "Chiefs
 *   to win" and "Chiefs -3.5" are close to the same bet; multiplying their
 *   probabilities would report a confidence the model does not have. With one
 *   leg per game the legs are across different fixtures and near enough
 *   independent for the product to mean something. Combinations *within* a
 *   fixture are supported too, but they go through `same-game.ts`, which
 *   measures the dependence rather than assuming it away.
 *
 *   Rank by quality, not probability. Taking the top five probabilities
 *   produces a line built from thin samples and extreme rating gaps. The score
 *   already folds in confidence, data quality and whether the market is one a
 *   bookmaker is actually offering; diversity is applied on top.
 *
 * The risk level is *derived* from what the selections turned out to be. It is
 * never used to reach back and adjust a probability — a category that could
 * change the numbers underneath it would be worthless.
 *
 * Pure, so the optimiser is testable without touching a provider.
 */

import { clamp } from './math.ts';
import { gameDate } from '../schedule/range.ts';
import { MIN_LEGS, MAX_LEGS, RISK_PROFILES } from './config.ts';
import type { RiskProfile } from './config.ts';
import { describeCorrelation } from './correlation.ts';
import { MODEL_VERSION } from './types.ts';
import type { Parlay, ParlayPrice, RiskLevel, Selection } from './types.ts';
import { qualityLabel } from './types.ts';
import { combinedDecimal, decimalToAmerican, decimalToFractional } from '../markets/price.ts';

/**
 * Which markets a reader wants to see.
 *
 *   any        everything the model has an opinion on
 *   available  only markets a bookmaker was confirmed to be offering
 *   main       the headline markets: winner, handicap, total
 */
export type MarketFilter = 'any' | 'available' | 'main';

const MAIN_MARKETS: readonly string[] = ['winner', 'spread', 'total'];

export interface OptimiseOptions {
  risk: RiskLevel;
  legs?: number;
  markets?: MarketFilter;
  /**
   * Which alternative to return. Regenerate steps this on, so a second press
   * yields a genuinely different combination rather than the same one — while
   * leaving every probability untouched.
   */
  variant?: number;
  now?: Date;
}

/** Candidates this risk level will accept at all. */
export function eligible(
  selections: readonly Selection[],
  profile: RiskProfile,
  markets: MarketFilter = 'any',
): Selection[] {
  return selections.filter((selection) => {
    if (selection.probability < profile.minProbability) return false;
    if (selection.probability > profile.maxProbability) return false;
    if (selection.data_quality < profile.minDataQuality) return false;
    if (selection.confidence < profile.minConfidence) return false;
    if (!profile.allowedTypes.includes(selection.type)) return false;

    if (markets === 'available' && selection.market.availability !== 'verified') return false;
    if (markets === 'main' && !MAIN_MARKETS.includes(selection.type)) return false;

    return true;
  });
}

/** The strongest candidate from each fixture, so no two legs share a game. */
export function bestPerGame(selections: readonly Selection[]): Selection[] {
  const best = new Map<string, Selection>();

  for (const selection of selections) {
    const current = best.get(selection.correlation_group);
    if (!current || selection.score > current.score) {
      best.set(selection.correlation_group, selection);
    }
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Product of the leg probabilities.
 *
 * Only sound because the legs come from different fixtures. Same-game
 * combinations go through `same-game.ts`, which counts the joint probability
 * off a shared set of simulations instead.
 */
export function combinedProbability(legs: readonly Selection[]): number {
  if (legs.length === 0) return 0;
  return legs.reduce((product, leg) => product * leg.probability, 1);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Prefer spreading legs across sports when the quality is comparable.
 *
 * Not a hard requirement — quality comes first — but four NBA games on the
 * same night share weather, scheduling and league-wide scoring conditions in a
 * way four games across four sports do not.
 */
function diversify(candidates: readonly Selection[], legs: number, offset: number): Selection[] {
  const chosen: Selection[] = [];
  const bySport = new Map<string, number>();
  const pool = [...candidates];

  // The variant offset rotates the starting point, so Regenerate explores a
  // different valid combination instead of re-emitting the best one.
  const start = pool.length > 0 ? offset % pool.length : 0;
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];

  for (const pass of [1, 2, Number.POSITIVE_INFINITY]) {
    for (const candidate of rotated) {
      if (chosen.length >= legs) break;
      if (chosen.some((leg) => leg.correlation_group === candidate.correlation_group)) continue;
      if ((bySport.get(candidate.sport) ?? 0) >= pass) continue;

      chosen.push(candidate);
      bySport.set(candidate.sport, (bySport.get(candidate.sport) ?? 0) + 1);
    }
    if (chosen.length >= legs) break;
  }

  // Longest odds last reads better, and puts the strongest leg first.
  return chosen.sort((a, b) => b.probability - a.probability);
}

// ---------------------------------------------------------------------------
// Price
// ---------------------------------------------------------------------------

/**
 * The price of the whole line.
 *
 * Null unless every leg carries a real quote. A combined price that silently
 * substituted the model's own probability for a missing one would be a
 * fabricated headline figure, and there would be no way for a reader to tell
 * which legs were real.
 */
export function priceParlay(legs: readonly Selection[], probability: number): ParlayPrice | null {
  const decimal = combinedDecimal(legs.map((leg) => leg.market.price));
  if (decimal === null) return null;

  const american = decimalToAmerican(decimal);
  const fractional = decimalToFractional(decimal);
  if (american === null || fractional === null) return null;

  const implied = Number((1 / decimal).toFixed(4));

  return {
    decimal,
    american,
    fractional,
    implied,
    edge: Number((probability - implied).toFixed(4)),
    sources: [...new Set(legs.map((leg) => leg.market.source).filter((s): s is string => !!s))],
  };
}

// ---------------------------------------------------------------------------
// Why this risk level
// ---------------------------------------------------------------------------

/**
 * Explain the classification, from what the legs actually are.
 *
 * Written after the fact, from measured properties. The category is a
 * consequence of the selections, so the explanation is a description rather
 * than a justification — and if the legs are not what the category implies, the
 * sentence says so.
 */
export function explainRisk(legs: readonly Selection[], risk: RiskLevel): string {
  if (legs.length === 0) return '';

  const probabilities = legs.map((leg) => leg.probability);
  const lowest = Math.min(...probabilities);
  const highest = Math.max(...probabilities);
  const quality = qualityLabel(Math.min(...legs.map((leg) => leg.data_quality)));
  const verified = legs.filter((leg) => leg.market.availability === 'verified').length;
  const fixtures = new Set(legs.map((leg) => leg.correlation_group)).size;

  const shape =
    risk === 'low'
      ? 'the shortest, least specific outcomes the model can stand behind'
      : risk === 'medium'
        ? 'a balance between probability and how specific each outcome is'
        : 'more specific outcomes, which the model rates less likely individually';

  const spread =
    Math.round(lowest * 100) === Math.round(highest * 100)
      ? `every leg at ${Math.round(lowest * 100)}%`
      : `legs ranging from ${Math.round(lowest * 100)}% to ${Math.round(highest * 100)}%`;

  const market =
    verified === legs.length
      ? 'every leg at a line a bookmaker is currently offering'
      : verified === 0
        ? 'no leg confirmed against a bookmaker'
        : `${verified} of ${legs.length} legs confirmed against a bookmaker`;

  return `Classified ${risk} risk because it takes ${shape}: ${spread}, across ${fixtures} ${
    fixtures === 1 ? 'fixture' : 'separate fixtures'
  }, with ${quality.toLowerCase()} data quality on the weakest leg and ${market}.`;
}

// ---------------------------------------------------------------------------
// Optimise
// ---------------------------------------------------------------------------

export interface OptimiseResult {
  parlay: Parlay | null;
  /** How many candidates cleared the risk profile, for the empty-state message. */
  eligibleCount: number;
  /** Distinct fixtures available, which caps how many legs are possible. */
  gamesAvailable: number;
}

/**
 * Build the best line this risk profile allows.
 *
 * Returns no parlay rather than a padded one when too few candidates qualify.
 * Forcing a leg that fails the thresholds would defeat the point of having
 * them.
 */
export function optimise(
  selections: readonly Selection[],
  options: OptimiseOptions,
): OptimiseResult {
  const profile = RISK_PROFILES[options.risk];
  const requested = clamp(options.legs ?? profile.defaultLegs, MIN_LEGS, MAX_LEGS);

  const qualified = eligible(selections, profile, options.markets ?? 'any');
  const perGame = bestPerGame(qualified);

  if (perGame.length < MIN_LEGS) {
    return { parlay: null, eligibleCount: qualified.length, gamesAvailable: perGame.length };
  }

  // Never pad: if only three fixtures qualify, a four-leg request returns three.
  const legs = diversify(perGame, Math.min(requested, perGame.length), options.variant ?? 0);

  if (legs.length < MIN_LEGS) {
    return { parlay: null, eligibleCount: qualified.length, gamesAvailable: perGame.length };
  }

  const independent = Number(combinedProbability(legs).toFixed(4));

  return {
    parlay: {
      risk: options.risk,
      kind: 'multi_game',
      legs,
      independent_probability: independent,
      // Every leg is from a different fixture, so the product is the estimate.
      combined_probability: independent,
      correlation: describeCorrelation(independent, independent, false),
      price: priceParlay(legs, independent),
      average_confidence: Number(mean(legs.map((leg) => leg.confidence)).toFixed(3)),
      average_data_quality: Number(mean(legs.map((leg) => leg.data_quality)).toFixed(3)),
      verified_legs: legs.filter((leg) => leg.market.availability === 'verified').length,
      risk_rationale: explainRisk(legs, options.risk),
      model_version: MODEL_VERSION,
      generated_at: (options.now ?? new Date()).toISOString(),
    },
    eligibleCount: qualified.length,
    gamesAvailable: perGame.length,
  };
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/**
 * Candidates kicking off on one calendar day.
 *
 * The day is the one the fixture falls on in the application's timezone, the
 * same rule Schedule uses — so a 23:00 UTC kick-off is tomorrow in British
 * summer time on both pages rather than only on one.
 */
export function selectionsOnDate(
  selections: readonly Selection[],
  date: string,
  timezone: string,
): Selection[] {
  return selections.filter((selection) => gameDate(selection.start_time, timezone) === date);
}

export interface DayAvailability {
  date: string;
  /** Fixtures with at least one candidate of any strength. */
  games: number;
  /** Fixtures with a candidate this risk profile would actually accept. */
  eligible: number;
  /** Whether a line can be built at all: two qualifying fixtures minimum. */
  buildable: boolean;
}

/**
 * What each day in the window can support, at the current risk level.
 *
 * Computed for every day rather than only the selected one, so the selector can
 * show counts and grey out days that cannot produce a line — better than
 * letting someone pick a day and be told afterwards that nothing qualified.
 *
 * `eligible` counts *fixtures*, not selections: the optimiser takes at most one
 * leg per game, so five candidates across one fixture is still one leg.
 */
export function availableDays(
  selections: readonly Selection[],
  dates: readonly string[],
  risk: RiskLevel,
  timezone: string,
  markets: MarketFilter = 'any',
): DayAvailability[] {
  const profile = RISK_PROFILES[risk];
  const qualified = eligible(selections, profile, markets);

  return dates.map((date) => {
    const onDay = new Set(
      selectionsOnDate(selections, date, timezone).map((s) => s.correlation_group),
    );
    const qualifiedOnDay = new Set(
      selectionsOnDate(qualified, date, timezone).map((s) => s.correlation_group),
    );

    return {
      date,
      games: onDay.size,
      eligible: qualifiedOnDay.size,
      buildable: qualifiedOnDay.size >= MIN_LEGS,
    };
  });
}
