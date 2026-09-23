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

import { describeCorrelation, isCountable, jointProbability } from './correlation.ts';
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

  /*
   * Counted where the simulations can answer, multiplied where they cannot.
   *
   * The same division `buildMixed` already makes across fixtures — "counted
   * within each fixture, multiplied between them" — applied to a second place
   * the simulations fall silent. A player market asks about one person and the
   * simulated games contain no people, so its probability is genuine and its
   * *relationship* to the scoreline legs is unmeasured.
   *
   * Handing the whole set to `jointProbability` is what produced 0.005 for a
   * single 55% player leg: an unanswerable rule counted as a miss in every
   * simulation.
   */
  const countable = legs.filter((leg) => isCountable(leg.settlement));
  const assumed = legs.filter((leg) => !isCountable(leg.settlement));

  const counted =
    countable.length > 0
      ? jointProbability(
          distribution,
          countable.map((leg) => leg.settlement),
        )
      : 1;
  const multiplied = assumed.reduce((product, leg) => product * leg.probability, 1);
  const joint = counted * multiplied;

  return {
    independent: Number(independent.toFixed(4)),
    joint: Number(joint.toFixed(4)),
    correlation:
      legs.length > 1
        ? describeCorrelation(joint, independent, true, assumed.length === 0)
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
  /*
   * A rule the simulations cannot answer is its own probability and nothing
   * else. Asked conditionally it would come back zero and be refused every
   * time — which is how a player leg was silently unable to enter any
   * combination even once the risk profiles allowed it.
   */
  if (!isCountable(candidate.settlement)) return candidate.probability;

  const rules = chosen.map((leg) => leg.settlement).filter(isCountable);
  const base = rules.length === 0 ? 1 : jointProbability(distribution, rules);
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

  /*
   * A player market needs the person in the key, not just the market and line.
   *
   * Two players' anytime touchdown both sit at half a touchdown, and two
   * pitchers are routinely quoted at the same strikeout line — so market-plus-
   * line read them as two sides of one bet and silently dropped the second.
   * They are different bets on different people; the same person twice on the
   * same statistic and line is the real conflict.
   */
  const ruleA = a.settlement;
  const ruleB = b.settlement;
  if (ruleA.kind === 'player_stat' || ruleB.kind === 'player_stat') {
    if (ruleA.kind !== 'player_stat' || ruleB.kind !== 'player_stat') return false;
    return (
      ruleA.athleteId === ruleB.athleteId &&
      ruleA.stat === ruleB.stat &&
      ruleA.line === ruleB.line
    );
  }

  return a.market.type === b.market.type && a.market.line === b.market.line;
}

/**
 * Two legs from one fixture whose relationship nobody has measured.
 *
 * A player's own statistic and that fixture's scoreline are genuinely linked —
 * a pitcher striking more batters out is a pitcher conceding fewer runs, and a
 * quarterback's passing yards are most of his team's offence. The simulations
 * cannot count the pair, because they contain no people, so the only two honest
 * options are to measure the coupling or to refuse the combination. Until it is
 * measured, this refuses it.
 *
 * Deliberately *not* folded into `conflicts`, which means "these cannot both be
 * true". These can both be true; we simply cannot say how often together.
 */
export function unmeasurableTogether(a: Selection, b: Selection): boolean {
  const playerA = a.settlement.kind === 'player_stat';
  const playerB = b.settlement.kind === 'player_stat';
  return playerA !== playerB;
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

  const qualified = eligible(selections, profile, options.markets ?? 'available').sort(
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
    // Refused for the same reason the builder refuses it: the pair's joint
    // probability is not something this model has measured.
    if (chosen.some((leg) => unmeasurableTogether(leg, candidate))) continue;

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
  /**
   * Why each dropped leg was dropped, in words.
   *
   * A count alone reads as a fault. The three reasons are genuinely different —
   * the same bet twice, a pairing whose joint probability is unmeasured, and a
   * fixture with no simulations behind it — and a reader who chose the leg is
   * entitled to know which applied.
   */
  dropped_reasons: string[];
  assessment: CombinationAssessment;
  price: ParlayPrice | null;
  verified_legs: number;
}

export function assembleSlip(
  selections: readonly Selection[],
  distribution: Distribution | null,
): CustomSlip {
  const legs: Selection[] = [];
  const reasons: string[] = [];
  let dropped = 0;

  for (const candidate of selections) {
    if (legs.some((leg) => conflicts(leg, candidate))) {
      dropped += 1;
      reasons.push(`${candidate.label} is the same bet as one already chosen.`);
      continue;
    }

    /*
     * A player leg and a scoreline leg from one fixture move together, and how
     * much has not been measured. Multiplying them would state a combined
     * chance the model cannot stand behind, so the combination is refused
     * rather than priced — the same choice the one-leg-per-fixture rule makes
     * everywhere else evidence is missing.
     */
    const linked = legs.find((leg) => unmeasurableTogether(leg, candidate));
    if (linked) {
      dropped += 1;
      reasons.push(
        `${candidate.label} cannot be combined with ${linked.label}: one is about a ` +
          'player and the other about the scoreline, and how much they move together ' +
          'has not been measured.',
      );
      continue;
    }
    /*
     * A fixture with no simulations can hold one leg and no more.
     *
     * That is a fight or a tennis match: one market, two sides that conflict
     * with each other, and no distribution to count a second leg against. A
     * second leg could only be priced by multiplying, which is the one thing
     * this module exists not to do.
     */
    if (!distribution && legs.length >= 1) {
      dropped += 1;
      reasons.push(
        `${candidate.label} cannot be added: this contest is not simulated, so a second ` +
          'leg could only be priced by multiplying.',
      );
      continue;
    }
    legs.push(candidate);
  }

  const assessment = distribution
    ? evaluateCombination(legs, distribution)
    : {
        independent: Number((legs[0]?.probability ?? 0).toFixed(4)),
        joint: Number((legs[0]?.probability ?? 0).toFixed(4)),
        correlation: {
          level: 'low' as const,
          ratio: 1,
          note: 'A single selection has nothing to be correlated with.',
        },
      };

  return {
    legs,
    dropped,
    dropped_reasons: reasons,
    assessment,
    price: priceParlay(legs, assessment.joint),
    verified_legs: legs.filter((leg) => leg.market.availability === 'verified').length,
  };
}

// ---------------------------------------------------------------------------
// Several bets from each of several fixtures
// ---------------------------------------------------------------------------

/** One fixture's candidates, with the simulations they were read from. */
export interface FixtureBundle {
  gameId: string;
  selections: readonly Selection[];
  distribution: Distribution;
}

export interface MixedOptions {
  risk: RiskLevel;
  /** Most legs to take from any one fixture. One reproduces the old behaviour. */
  perGame: number;
  legs?: number;
  markets?: MarketFilter;
  variant?: number;
  now?: Date;
}

/**
 * A line with several bets on some matches and legs from others.
 *
 * The reason this needs its own builder rather than a looser optimiser is the
 * arithmetic. Two bets on one fixture are correlated and must be **counted**
 * against that fixture's simulations; bets on different fixtures are near
 * enough independent and are **multiplied**. Doing either one everywhere would
 * be wrong in a way that shows up as a headline number:
 *
 *   multiply throughout   understates a fixture whose legs reinforce
 *   count throughout      impossible — two fixtures share no simulations
 *
 * So the joint probability here is the product, across fixtures, of each
 * fixture's counted joint. Correlation is handled exactly where it exists and
 * nowhere else.
 *
 * Legs are taken round-robin: the best from each fixture, then the second best
 * from each, and so on. That spreads the line across the matches the reader
 * picked instead of loading three bets onto whichever fixture happens to rank
 * first — the same instinct as the multi-game optimiser's diversity pass.
 */
export function buildMixed(
  bundles: readonly FixtureBundle[],
  options: MixedOptions,
): OptimiseResult {
  const profile = RISK_PROFILES[options.risk];
  const perGame = Math.max(1, Math.min(options.perGame, MAX_LEGS));

  // Each fixture's candidates, strongest first, with the conditional test
  // applied against that fixture's own simulations as legs accumulate.
  const pools = bundles
    .map((bundle) => ({
      bundle,
      queue: eligible(bundle.selections, profile, options.markets ?? 'available').sort(
        (a, b) => b.score - a.score,
      ),
      chosen: [] as Selection[],
    }))
    .filter((pool) => pool.queue.length > 0)
    // Strongest fixture first, so a short line is built from the best matches.
    .sort((a, b) => b.queue[0].score - a.queue[0].score);

  const eligibleCount = pools.reduce((sum, pool) => sum + pool.queue.length, 0);
  if (pools.length === 0) {
    return { parlay: null, eligibleCount: 0, gamesAvailable: 0 };
  }

  const ceiling = Math.min(pools.length * perGame, MAX_LEGS);
  const requested = clamp(options.legs ?? ceiling, MIN_LEGS, ceiling);

  /*
   * The variant rotates which fixture leads, so Regenerate explores a
   * different combination without touching a single probability.
   */
  const offset = options.variant ? options.variant % pools.length : 0;
  const rotated = [...pools.slice(offset), ...pools.slice(0, offset)];

  let taken = 0;
  for (let pass = 0; pass < perGame && taken < requested; pass += 1) {
    for (const pool of rotated) {
      if (taken >= requested) break;
      if (pool.chosen.length > pass) continue;

      const candidate = pool.queue.find((entry) => {
        if (pool.chosen.some((leg) => conflicts(leg, entry))) return false;
        if (pool.chosen.some((leg) => unmeasurableTogether(leg, entry))) return false;
        // Still likely enough given this fixture's legs already chosen. This
        // is what refuses a contradiction without enumerating contradictions.
        return (
          conditionalProbability(pool.chosen, entry, pool.bundle.distribution) >=
          profile.minProbability
        );
      });

      if (!candidate) continue;
      pool.chosen.push(candidate);
      taken += 1;
    }
  }

  const used = pools.filter((pool) => pool.chosen.length > 0);
  const legs = used.flatMap((pool) => pool.chosen);

  if (legs.length < MIN_LEGS) {
    return { parlay: null, eligibleCount, gamesAvailable: pools.length };
  }

  /*
   * Counted within each fixture, multiplied between them.
   *
   * A fixture contributing one leg counts to that leg's own probability, so a
   * line with no doubled-up fixture gives exactly the multi-game answer.
   */
  /*
   * Each fixture's own assessment, then multiplied between fixtures.
   *
   * `evaluateCombination` rather than `jointProbability` directly, because a
   * fixture's legs may include a player market the simulations cannot answer —
   * handed to the raw counter, one of those makes the whole product zero.
   */
  const perFixture = used.map((pool) => evaluateCombination(pool.chosen, pool.bundle.distribution));
  const joint = perFixture.reduce((product, assessment) => product * assessment.joint, 1);

  const independent = legs.reduce((product, leg) => product * leg.probability, 1);
  const doubled = used.some((pool) => pool.chosen.length > 1);
  // Only a genuinely counted relationship may be described as one.
  const allCounted = used.every((pool) => pool.chosen.every((leg) => isCountable(leg.settlement)));

  const ordered = [...legs].sort((a, b) => b.probability - a.probability);

  const parlay: Parlay = {
    risk: options.risk,
    kind: doubled ? 'mixed' : 'multi_game',
    legs: ordered,
    independent_probability: Number(independent.toFixed(4)),
    combined_probability: Number(joint.toFixed(4)),
    // Only claim correlation was measured when a fixture actually contributes
    // more than one leg; otherwise this is an ordinary independent line.
    correlation: describeCorrelation(joint, independent, doubled, allCounted),
    price: priceParlay(ordered, joint),
    average_confidence: Number(
      (ordered.reduce((sum, leg) => sum + leg.confidence, 0) / ordered.length).toFixed(3),
    ),
    average_data_quality: Number(
      (ordered.reduce((sum, leg) => sum + leg.data_quality, 0) / ordered.length).toFixed(3),
    ),
    verified_legs: ordered.filter((leg) => leg.market.availability === 'verified').length,
    risk_rationale: explainRisk(ordered, options.risk),
    model_version: MODEL_VERSION,
    generated_at: (options.now ?? new Date()).toISOString(),
  };

  return { parlay, eligibleCount, gamesAvailable: pools.length };
}
