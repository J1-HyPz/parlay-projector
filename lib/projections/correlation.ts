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

    case 'both_teams_to_score':
      return (home > 0 && away > 0) === rule.yes;

    /*
     * Race markets are not decided by a two-sided scoreline and cannot be
     * judged here. They are evaluated against simulated finishing orders in
     * `racing.ts`, and the optimiser takes at most one leg per race so no
     * combination ever needs both paths at once.
     */
    case 'finish_position':
    /*
     * Not answerable from a simulated scoreline.
     *
     * Every other rule here asks something about the score; a player market
     * asks about one person, and the simulated games contain no people.
     *
     * **`false` here is a placeholder, not an answer**, and callers must not
     * reach it: `isCountable` below is the question to ask first. An earlier
     * version relied on a comment saying these "never reach this function",
     * which was simply untrue for any fixture that *does* have a distribution —
     * and the consequence was a 55% player leg reported at 0.5% with an
     * invented explanation attached.
     */
    case 'player_stat':
      return false;

    case 'head_to_head':
      return false;
  }
}

/**
 * Whether a simulated scoreline can answer this rule at all.
 *
 * The distinction `satisfiedBy` returning false could not make, and the reason
 * it could not be left to do so. A total and a handicap are questions about a
 * score, so a simulated game answers them. A race position, a head-to-head and
 * a player's own statistic are not — and `false` for those does not mean "did
 * not happen", it means "cannot be asked here".
 *
 * Conflating the two produced the worst behaviour this feature had: a single
 * player leg put through the bet builder reported a joint probability of 0.005
 * against its own card's 0.55, and the builder then *explained* the gap as the
 * legs pulling against each other. Counting an unanswerable rule as a miss in
 * every simulation is how a model invents a reason for its own artefact.
 */
export function isCountable(rule: SettlementRule): boolean {
  switch (rule.kind) {
    case 'winner':
    case 'double_chance':
    case 'spread':
    case 'total':
    case 'team_total':
    case 'both_teams_to_score':
      return true;
    case 'finish_position':
    case 'head_to_head':
    case 'player_stat':
      return false;
  }
}

/**
 * How often every rule holds in the same simulated game.
 *
 * The measured joint probability. With a single rule it returns that rule's
 * own probability, which is a useful property: the marginal and the joint come
 * from one code path and so cannot drift apart.
 *
 * **Every rule passed here must be countable.** A caller holding a mixture is
 * asking two different questions and has to keep them apart itself — see
 * `evaluateCombination`, which does.
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
  // A rule the simulations cannot ask about is not a contradiction; it is a
  // question for a different set of evidence. Saying otherwise would make every
  // player market incompatible with everything.
  if (!isCountable(a) || !isCountable(b)) return false;
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
  /**
   * Whether the joint figure was actually counted.
   *
   * False when any leg's rule the simulations cannot answer had to be
   * multiplied in instead. The distinction is the difference between a measured
   * relationship and an assumed one, and stating the second as the first is a
   * claim about evidence that does not exist.
   */
  measured = true,
): CorrelationAssessment {
  if (!sameGame) {
    return {
      level: 'low',
      ratio: 1,
      note: 'Each leg comes from a different fixture, so the results do not depend on one another.',
    };
  }

  if (!measured) {
    /*
     * No ratio, because there is nothing to take a ratio of. A player market is
     * read off that person's own record rather than off a simulated scoreline,
     * so the simulations hold no joint distribution these legs are both in.
     * Reported as unmeasured rather than as independent: they are related, and
     * how much is not known.
     */
    return {
      level: 'moderate',
      ratio: null,
      note:
        'These selections come from one fixture, and how much they move together has ' +
        'not been measured — a player market is read off that player’s own record, ' +
        'which the fixture simulations know nothing about. The combined figure ' +
        'multiplies them, so treat it as an estimate rather than a count.',
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
