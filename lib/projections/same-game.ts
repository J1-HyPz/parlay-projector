/**
 * Combinations from a single fixture — a same-game parlay, or bet builder.
 *
 * The reason this can be done honestly is that every probability in the
 * application comes off the same simulated games. Ask for "Astros to win" and
 * "over 8.5 runs" together and the answer is not two numbers multiplied: it is
 * a count of how many of the ten thousand simulated games satisfied both. That
 * is a real joint probability, and it is right whether the legs reinforce each
 * other or fight.
 *
 * The difference is not small. A favourite to win alongside the over is
 * commonly ten to twenty points more likely than the product suggests, and a
 * team to win alongside the under is often less. Publishing the product for
 * either would misstate the line, and in one direction it would flatter it.
 *
 * A leg is accepted only if it is still likely enough *given the legs already
 * chosen*. That single rule does a lot of work: it rejects contradictions
 * automatically, because a selection that can never co-occur has a conditional
 * probability of zero, and it stops a builder quietly assembling something
 * that cannot come in.
 *
 * Pure.
 */

import { describeCorrelation, jointProbability } from './correlation.ts';
import { MAX_LEGS, MIN_LEGS, RISK_PROFILES } from './config.ts';
import { clamp } from './math.ts';
import { eligible, explainRisk, priceParlay } from './optimiser.ts';
import type { MarketFilter, OptimiseResult } from './optimiser.ts';
import { MODEL_VERSION } from './types.ts';
import type {
  CorrelationAssessment,
  Parlay,
  ParlayPrice,
  RiskLevel,
  Selection,
} from './types.ts';
import type { Distribution } from './model.ts';

export interface SameGameOptions {
  risk: RiskLevel;
  legs?: number;
  markets?: MarketFilter;
  variant?: number;
  now?: Date;
}

export interface CombinationAssessment {
  /** What multiplying the legs would have given. Shown for comparison only. */
  independent: number;
  /** The measured joint probability — the figure actually claimed. */
  joint: number;
  correlation: CorrelationAssessment;
}

/**
 * Measure a set of legs against the simulations they all came from.
 *
 * Works for one leg as well as several, in which case the joint and the
 * independent figure agree — a useful property, since it means a single-leg
 * builder shows exactly the number the leg card shows.
 */
export function evaluateCombination(
  legs: readonly Selection[],
  distribution: Distribution,
): CombinationAssessment {
  const independent = legs.reduce((product, leg) => product * leg.probability, 1);
  const joint = jointProbability(
    distribution,
    legs.map((leg) => leg.settlement),
  );

  return {
    independent: Number(independent.toFixed(4)),
    joint: Number(joint.toFixed(4)),
    correlation:
      legs.length > 1
        ? describeCorrelation(joint, independent, true)
        : {
            level: 'low',
            ratio: 1,
            note: 'A single selection has nothing to be correlated with.',
          },
  };
}

/**
 * Whether a leg is worth adding, given what is already in the slip.
 *
 * The test is the *conditional* probability — how often this leg comes in
 * among the simulations where the existing legs already did. A leg that
 * contradicts the slip scores zero and is refused; a leg that rides on the
 * back of the others scores high and is welcome.
 */
export function conditionalProbability(
  chosen: readonly Selection[],
  candidate: Selection,
  distribution: Distribution,
): number {
  const rules = chosen.map((leg) => leg.settlement);
  const base = chosen.length === 0 ? 1 : jointProbability(distribution, rules);
  if (base <= 0) return 0;

  const together = jointProbability(distribution, [...rules, candidate.settlement]);
  return together / base;
}

/**
 * Whether two selections can sit in the same slip at all.
 *
 * Two bets on the same market and line are the same bet or its opposite;
 * neither belongs in one combination. Everything else is left to the
 * conditional test, which catches contradictions on the evidence rather than
 * by enumerating rules that would inevitably miss cases.
 */
export function conflicts(a: Selection, b: Selection): boolean {
  if (a.id === b.id) return true;
  return a.market.type === b.market.type && a.market.line === b.market.line;
}

/**
 * Build the strongest combination from one fixture.
 *
 * Greedy on the same score the multi-game optimiser uses, then filtered by the
 * conditional test. Greedy rather than exhaustive because the candidate set for
 * one fixture is small and the ordering is already quality-first — and because
 * an exhaustive search over correlated legs would spend its time discovering
 * that the highest joint probability belongs to the two legs that are nearly
 * the same bet.
 */
export function buildSameGame(
  selections: readonly Selection[],
  distribution: Distribution,
  options: SameGameOptions,
): OptimiseResult {
  const profile = RISK_PROFILES[options.risk];
  const requested = clamp(options.legs ?? profile.defaultLegs, MIN_LEGS, MAX_LEGS);

  const qualified = eligible(selections, profile, options.markets ?? 'any').sort(
    (a, b) => b.score - a.score,
  );

  if (qualified.length < MIN_LEGS) {
    return { parlay: null, eligibleCount: qualified.length, gamesAvailable: 0 };
  }

  const offset = (options.variant ?? 0) % qualified.length;
  const rotated = [...qualified.slice(offset), ...qualified.slice(0, offset)];

  const chosen: Selection[] = [];
  for (const candidate of rotated) {
    if (chosen.length >= requested) break;
    if (chosen.some((leg) => conflicts(leg, candidate))) continue;

    // Must still be likely enough given what is already in the slip. This is
    // what refuses a contradiction, without needing to know it is one.
    if (conditionalProbability(chosen, candidate, distribution) < profile.minProbability) continue;

    chosen.push(candidate);
  }

  if (chosen.length < MIN_LEGS) {
    return { parlay: null, eligibleCount: qualified.length, gamesAvailable: 1 };
  }

  const legs = [...chosen].sort((a, b) => b.probability - a.probability);
  const assessment = evaluateCombination(legs, distribution);

  const parlay: Parlay = {
    risk: options.risk,
    kind: 'same_game',
    legs,
    independent_probability: assessment.independent,
    combined_probability: assessment.joint,
    correlation: assessment.correlation,
    price: priceParlay(legs, assessment.joint),
    average_confidence: Number(
      (legs.reduce((sum, leg) => sum + leg.confidence, 0) / legs.length).toFixed(3),
    ),
    average_data_quality: Number(
      (legs.reduce((sum, leg) => sum + leg.data_quality, 0) / legs.length).toFixed(3),
    ),
    verified_legs: legs.filter((leg) => leg.market.availability === 'verified').length,
    risk_rationale: explainRisk(legs, options.risk),
    model_version: MODEL_VERSION,
    generated_at: (options.now ?? new Date()).toISOString(),
  };

  return { parlay, eligibleCount: qualified.length, gamesAvailable: 1 };
}

/**
 * Assemble a slip the reader chose themselves.
 *
 * No thresholds and no filtering: these are their selections, and the model's
 * job is to say what it thinks of them, not to overrule the choice. Conflicting
 * legs are dropped, because a slip containing both sides of a market cannot be
 * priced or measured — and the caller is told how many were dropped rather than
 * left to wonder.
 */
export interface CustomSlip {
  legs: Selection[];
  dropped: number;
  assessment: CombinationAssessment;
  price: ParlayPrice | null;
  verified_legs: number;
}

export function assembleSlip(
  selections: readonly Selection[],
  distribution: Distribution,
): CustomSlip {
  const legs: Selection[] = [];
  let dropped = 0;

  for (const candidate of selections) {
    if (legs.some((leg) => conflicts(leg, candidate))) {
      dropped += 1;
      continue;
    }
    legs.push(candidate);
  }

  const assessment = evaluateCombination(legs, distribution);

  return {
    legs,
    dropped,
    assessment,
    price: priceParlay(legs, assessment.joint),
    verified_legs: legs.filter((leg) => leg.market.availability === 'verified').length,
  };
}
