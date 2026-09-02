/**
 * Building a line from candidate selections.
 *
 * Two rules do most of the work:
 *
 *   One selection per game. Every selection from a fixture shares a
 *   correlation group, and the optimiser takes at most one. "Chiefs to win"
 *   and "Chiefs -3.5" are close to the same bet; multiplying their
 *   probabilities would report a confidence the model does not have. With one
 *   leg per game the legs are across different fixtures and near enough
 *   independent for the product to mean something.
 *
 *   Rank by quality, not probability. Taking the top five probabilities
 *   produces a line built from thin samples and extreme rating gaps. The score
 *   already folds in confidence and data quality, and diversity is applied on
 *   top.
 *
 * Pure, so the optimiser is testable without touching a provider.
 */

import { clamp } from './math.ts';
import { MIN_LEGS, MAX_LEGS, RISK_PROFILES } from './config.ts';
import type { RiskProfile } from './config.ts';
import { MODEL_VERSION } from './types.ts';
import type { Parlay, RiskLevel, Selection } from './types.ts';

export interface OptimiseOptions {
  risk: RiskLevel;
  legs?: number;
  /**
   * Which alternative to return. Regenerate steps this on, so a second press
   * yields a genuinely different combination rather than the same one — while
   * leaving every probability untouched.
   */
  variant?: number;
  now?: Date;
}

/** Candidates this risk level will accept at all. */
export function eligible(selections: readonly Selection[], profile: RiskProfile): Selection[] {
  return selections.filter(
    (selection) =>
      selection.probability >= profile.minProbability &&
      selection.probability <= profile.maxProbability &&
      selection.data_quality >= profile.minDataQuality &&
      selection.confidence >= profile.minConfidence &&
      profile.allowedTypes.includes(selection.type),
  );
}

/** The strongest candidate from each fixture, so no two legs share a game. */
export function bestPerGame(selections: readonly Selection[]): Selection[] {
  const best = new Map<string, Selection>();

  for (const selection of selections) {
    const current = best.get(selection.correlation_group);
    if (!current || selection.score > current.score) best.set(selection.correlation_group, selection);
  }

  return [...best.values()].sort((a, b) => b.score - a.score);
}

/**
 * Product of the leg probabilities.
 *
 * Only sound because the legs come from different fixtures. Same-game
 * combinations would need a joint model and are not produced.
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
 * Not a hard requirement — §99: quality comes first — but four NBA games on the
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

  const qualified = eligible(selections, profile);
  const perGame = bestPerGame(qualified);

  if (perGame.length < MIN_LEGS) {
    return { parlay: null, eligibleCount: qualified.length, gamesAvailable: perGame.length };
  }

  // Never pad: if only three fixtures qualify, a four-leg request returns three.
  const legs = diversify(perGame, Math.min(requested, perGame.length), options.variant ?? 0);

  if (legs.length < MIN_LEGS) {
    return { parlay: null, eligibleCount: qualified.length, gamesAvailable: perGame.length };
  }

  return {
    parlay: {
      risk: options.risk,
      legs,
      combined_probability: Number(combinedProbability(legs).toFixed(4)),
      average_confidence: Number(mean(legs.map((leg) => leg.confidence)).toFixed(3)),
      average_data_quality: Number(mean(legs.map((leg) => leg.data_quality)).toFixed(3)),
      model_version: MODEL_VERSION,
      generated_at: (options.now ?? new Date()).toISOString(),
    },
    eligibleCount: qualified.length,
    gamesAvailable: perGame.length,
  };
}
