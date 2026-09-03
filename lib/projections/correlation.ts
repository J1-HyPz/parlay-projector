/**
 * Combining selections that are not independent.
 *
 * Multiplying probabilities is only valid for independent events. Two
 * selections from the same fixture almost never are: "Chiefs to win" and
 * "Chiefs over 27.5 points" come in together far more often than the product
 * of their individual chances suggests, and "over 8.5 runs" alongside "under
 * 4.5 runs for the home side" far less often.
 *
 * Most systems handle this with a fudge — a fixed haircut applied to any
 * same-game combination. That is not necessary here. Every probability in this
 * application is read off the same set of simulated games, so the joint
 * probability can simply be *counted*: run through the simulations and see how
 * often every leg came in at once. The result is a real joint distribution
 * rather than an adjustment factor, and it is right in both directions.
 *
 * Cross-fixture legs are a different matter. Two different games are not
 * simulated together, and pretending to measure a relationship between them
 * would be worse than assuming they have none — so those stay a product, which
 * is what the one-leg-per-game rule exists to make defensible.
 *
 * Pure.
 */

import { boundProbability } from './math.ts';
import { WINNER_AWAY, WINNER_DRAW, WINNER_HOME } from './model.ts';
import type { Distribution } from './model.ts';
import type { CorrelationAssessment } from './types.ts';
import type { SettlementRule } from '../markets/types.ts';

/**
 * Whether one simulated game satisfies a settlement rule.
 *
 * Mirrors `settlement.ts`, which judges real results, and deliberately so: a
 * probability that is not measured against the same condition the result will
 * be judged by is measuring the wrong thing. A push is not a win.
 */
export function satisfiedBy(
  rule: SettlementRule,
  home: number,
  away: number,
  winner: number,
): boolean {
  switch (rule.kind) {
    case 'winner': {
      if (rule.side === 'home') return winner === WINNER_HOME;
      if (rule.side === 'away') return winner === WINNER_AWAY;
      return winner === WINNER_DRAW;
    }

    case 'double_chance':
      return rule.sides.some((side) =>
        side === 'home'
          ? winner === WINNER_HOME
          : side === 'away'
            ? winner === WINNER_AWAY
            : winner === WINNER_DRAW,
      );

    case 'spread': {
      const margin = rule.side === 'home' ? home - away : away - home;
      return margin + rule.line > 0;
    }

    case 'total': {
      const total = home + away;
      return rule.direction === 'over' ? total > rule.line : total < rule.line;
    }

    case 'team_total': {
      const score = rule.side === 'home' ? home : away;
      return rule.direction === 'over' ? score > rule.line : score < rule.line;
    }
  }
}

/**
 * How often every rule holds in the same simulated game.
 *
 * The measured joint probability. With a single rule it returns that rule's
 * own probability, which is a useful property: the marginal and the joint come
 * from one code path and so cannot drift apart.
 */
export function jointProbability(
  distribution: Distribution,
  rules: readonly SettlementRule[],
): number {
  if (rules.length === 0) return 0;

  const count = distribution.homeScores.length;
  if (count === 0) return 0;

  let hits = 0;

  for (let i = 0; i < count; i += 1) {
    const home = distribution.homeScores[i];
    const away = distribution.awayScores[i];
    const winner = distribution.winners[i];

    let all = true;
    for (const rule of rules) {
      if (!satisfiedBy(rule, home, away, winner)) {
        all = false;
        break;
      }
    }
    if (all) hits += 1;
  }

  return boundProbability(hits / count);
}

/**
 * Two selections that cannot both be true.
 *
 * Not merely correlated — impossible. Over 8.5 and under 8.5 on the same line
 * is the obvious case, but so is a team to win alongside the same team on a
 * handicap it cannot cover while winning. Rather than enumerate the cases,
 * this asks the simulations: a pair that never co-occurs across ten thousand
 * games is a contradiction in practice, whatever the reason.
 */
export function isContradictory(
  distribution: Distribution,
  a: SettlementRule,
  b: SettlementRule,
): boolean {
  return jointProbability(distribution, [a, b]) <= 0.005;
}

// ---------------------------------------------------------------------------
// Describing the relationship
// ---------------------------------------------------------------------------

/** Ratio above which legs are described as meaningfully related. */
const MODERATE = 1.15;
const STRONG = 1.5;
/** Below one, the legs work against each other. */
const MODERATE_NEGATIVE = 0.87;
const STRONG_NEGATIVE = 0.67;

/**
 * Put the measured relationship into words.
 *
 * The ratio is joint over independent: 1.0 means the legs are independent,
 * above means they come in together, below means backing one makes the other
 * harder. It is stated as a fact about the selections rather than as a
 * judgement about the line.
 */
export function describeCorrelation(
  joint: number,
  independent: number,
  sameGame: boolean,
): CorrelationAssessment {
  if (!sameGame) {
    return {
      level: 'low',
      ratio: 1,
      note: 'Each leg comes from a different fixture, so the results do not depend on one another.',
    };
  }

  if (independent <= 0) {
    return {
      level: 'high',
      ratio: null,
      note: 'These selections come from one fixture and are strongly related.',
    };
  }

  const ratio = joint / independent;

  if (ratio >= STRONG) {
    return {
      level: 'high',
      ratio: round(ratio),
      note: 'These selections tend to come in together, so the combined chance is considerably higher than multiplying them would suggest.',
    };
  }
  if (ratio >= MODERATE) {
    return {
      level: 'moderate',
      ratio: round(ratio),
      note: 'These selections are related, so the combined chance has been measured jointly rather than multiplied.',
    };
  }
  if (ratio <= STRONG_NEGATIVE) {
    return {
      level: 'high',
      ratio: round(ratio),
      note: 'These selections pull against each other — what helps one tends to hurt the other — so the combined chance is well below the product of the two.',
    };
  }
  if (ratio <= MODERATE_NEGATIVE) {
    return {
      level: 'moderate',
      ratio: round(ratio),
      note: 'These selections work against each other to a degree, so the combined chance has been measured jointly rather than multiplied.',
    };
  }

  return {
    level: 'low',
    ratio: round(ratio),
    note: 'These selections come from one fixture but barely affect one another.',
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
