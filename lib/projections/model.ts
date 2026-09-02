/**
 * The projection model.
 *
 * Structure, per sport:
 *
 *   ratings ──► expected scores ──► Elo blend ──► simulation ──► distribution
 *
 * The two families are genuinely different, not one formula with different
 * constants:
 *
 *   Poisson  football, NHL, MLB. Goals and runs are counts. The distribution
 *            is discrete and right-skewed, draws are real, and the variance is
 *            fixed by the mean rather than chosen.
 *   Normal   NFL, NBA. A points total is the sum of many scoring events, which
 *            is close to normal; an exact tie is rare enough to fold into the
 *            nearer side.
 *
 * Expected scores come from an attack/defence rate model — a team's own scoring
 * rate, the opponent's concession rate, and the league average — which is the
 * standard interpretable approach for this data, and readable months later.
 * Elo enters as a correction to the margin, never as the whole answer.
 *
 * Pure: given the same ratings and seed, the same numbers come out.
 */

import {
  boundProbability,
  clamp,
  createRandom,
  normalise,
  samplePoisson,
  sampleNormal,
} from './math.ts';
import { restDays } from './features.ts';
import type { RatingSet } from './features.ts';
import type { SportModelConfig } from './config.ts';

export interface ExpectedScores {
  home: number;
  away: number;
  /** Contributions, retained so the projection can explain itself. */
  eloEdge: number;
  homeRest: number | null;
  awayRest: number | null;
  shortRested: 'home' | 'away' | null;
}

/**
 * Expected score for each side.
 *
 * The rate model: a team's expected score is the league average, scaled by how
 * much better than average it attacks and by how much worse than average the
 * opponent defends. Home advantage is added, not multiplied — it is closer to a
 * fixed edge than a proportional one in every sport here.
 */
export function expectedScores(
  homeName: string,
  awayName: string,
  set: RatingSet,
  config: SportModelConfig,
  kickoff: number,
): ExpectedScores | null {
  const home = set.ratings.get(homeName);
  const away = set.ratings.get(awayName);
  if (!home || !away) return null;

  const league = Math.max(set.leagueAverage, 0.05);

  const homeAttackRatio = home.adjustedAttack / league;
  const awayDefenceRatio = away.adjustedDefence / league;
  const awayAttackRatio = away.adjustedAttack / league;
  const homeDefenceRatio = home.adjustedDefence / league;

  // Clamped: an early-season extreme would otherwise produce a scoreline no
  // fixture in the sport has ever produced.
  const rate = (attack: number, defence: number) =>
    league * clamp(attack * defence, 0.3, 2.5);

  let expectedHome = rate(homeAttackRatio, awayDefenceRatio) + config.homeAdvantage / 2;
  let expectedAway = rate(awayAttackRatio, homeDefenceRatio) - config.homeAdvantage / 2;

  /*
   * Elo correction.
   *
   * The rate model captures how teams score; Elo captures who beats whom,
   * including the wins that do not show up in scoring rates. Where they
   * disagree the margin is nudged toward Elo by `eloWeight`, and the total is
   * held constant so the correction moves the shape of the game rather than
   * how much scoring it contains.
   */
  const eloDifference = home.elo - away.elo;
  const eloMargin = (eloDifference / 100) * config.marginPerHundredElo + config.homeAdvantage;
  const modelMargin = expectedHome - expectedAway;
  const blendedMargin = modelMargin * (1 - config.eloWeight) + eloMargin * config.eloWeight;

  const total = expectedHome + expectedAway;
  expectedHome = (total + blendedMargin) / 2;
  expectedAway = (total - blendedMargin) / 2;

  // Rest. A short turnaround is a real effect in basketball and hockey; it is
  // applied as a small penalty, never as a rule that decides the game.
  const homeRest = restDays(home, kickoff);
  const awayRest = restDays(away, kickoff);
  let shortRested: 'home' | 'away' | null = null;

  if (config.shortRestPenalty > 0) {
    const homeShort = homeRest !== null && homeRest <= config.shortRestDays;
    const awayShort = awayRest !== null && awayRest <= config.shortRestDays;
    // Only when one side is disadvantaged and the other is not.
    if (homeShort && !awayShort) {
      expectedHome -= config.shortRestPenalty;
      shortRested = 'home';
    } else if (awayShort && !homeShort) {
      expectedAway -= config.shortRestPenalty;
      shortRested = 'away';
    }
  }

  // A negative expectation is not a scoreline. The floor is a tenth of the
  // league average, which is far below any real team and still positive.
  const floor = league * 0.1;

  return {
    home: Math.max(expectedHome, floor),
    away: Math.max(expectedAway, floor),
    eloEdge: eloDifference,
    homeRest,
    awayRest,
    shortRested,
  };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

/**
 * The outcome distribution, from simulated games.
 *
 * Everything downstream — winner probability, spread cover, totals, team totals
 * — is read off the same set of simulations, so the numbers on a projection can
 * never contradict one another. Deriving each from its own closed form is what
 * produces a 60% winner alongside a 70% cover of a line the model itself set.
 */
export interface Distribution {
  homeWin: number;
  awayWin: number;
  draw: number;
  meanHome: number;
  meanAway: number;
  meanMargin: number;
  meanTotal: number;
  /** Sorted margins (home - away), for reading a spread off the quantiles. */
  margins: number[];
  totals: number[];
  homeScores: number[];
  awayScores: number[];
  simulations: number;
}

export interface SimulationOptions {
  simulations: number;
  /** Fixed in tests, derived from the game id in production. */
  seed: number;
}

export function simulate(
  expected: ExpectedScores,
  config: SportModelConfig,
  options: SimulationOptions,
): Distribution {
  const random = createRandom(options.seed);
  const count = Math.max(200, Math.floor(options.simulations));

  const margins: number[] = [];
  const totals: number[] = [];
  const homeScores: number[] = [];
  const awayScores: number[] = [];

  let homeWin = 0;
  let awayWin = 0;
  let draw = 0;
  let homeSum = 0;
  let awaySum = 0;

  for (let i = 0; i < count; i += 1) {
    let home: number;
    let away: number;

    if (config.scoring === 'poisson') {
      home = samplePoisson(expected.home, random);
      away = samplePoisson(expected.away, random);
    } else {
      // Rounded: a points total is a whole number, and rounding here keeps the
      // simulated distribution on the same lattice the settlement rules use.
      home = Math.max(0, Math.round(sampleNormal(expected.home, config.scoreSd, random)));
      away = Math.max(0, Math.round(sampleNormal(expected.away, config.scoreSd, random)));
    }

    if (home > away) homeWin += 1;
    else if (away > home) awayWin += 1;
    else if (config.hasDraw) draw += 1;
    else {
      /*
       * A tie in a sport that does not have one.
       *
       * Overtime decides it, and overtime is close to a coin flip with a slight
       * edge to the better side. Splitting the tie by expectation is closer to
       * the truth than discarding the simulation or awarding it arbitrarily.
       */
      if (random() < expected.home / Math.max(expected.home + expected.away, 0.01)) homeWin += 1;
      else awayWin += 1;
    }

    margins.push(home - away);
    totals.push(home + away);
    homeScores.push(home);
    awayScores.push(away);
    homeSum += home;
    awaySum += away;
  }

  margins.sort((a, b) => a - b);
  totals.sort((a, b) => a - b);

  return {
    homeWin: homeWin / count,
    awayWin: awayWin / count,
    draw: draw / count,
    meanHome: homeSum / count,
    meanAway: awaySum / count,
    meanMargin: (homeSum - awaySum) / count,
    meanTotal: (homeSum + awaySum) / count,
    margins,
    totals,
    homeScores,
    awayScores,
    simulations: count,
  };
}

// ---------------------------------------------------------------------------
// Reading probabilities off the distribution
// ---------------------------------------------------------------------------

/** Fraction of simulations satisfying a predicate, bounded away from 0 and 1. */
function share(values: readonly number[], predicate: (value: number) => boolean): number {
  if (values.length === 0) return 0.5;
  let hits = 0;
  for (const value of values) if (predicate(value)) hits += 1;
  return boundProbability(hits / values.length);
}

/** P(home covers `line`), where a positive line is points given to the home side. */
export function spreadProbability(
  distribution: Distribution,
  side: 'home' | 'away',
  line: number,
): number {
  return side === 'home'
    ? share(distribution.margins, (margin) => margin + line > 0)
    : share(distribution.margins, (margin) => -margin + line > 0);
}

export function totalProbability(
  distribution: Distribution,
  direction: 'over' | 'under',
  line: number,
): number {
  return direction === 'over'
    ? share(distribution.totals, (total) => total > line)
    : share(distribution.totals, (total) => total < line);
}

export function teamTotalProbability(
  distribution: Distribution,
  side: 'home' | 'away',
  direction: 'over' | 'under',
  line: number,
): number {
  const scores = side === 'home' ? distribution.homeScores : distribution.awayScores;
  return direction === 'over'
    ? share(scores, (score) => score > line)
    : share(scores, (score) => score < line);
}

/** Normalised outcome probabilities, so the reported set always sums to one. */
export function outcomeProbabilities(
  distribution: Distribution,
  hasDraw: boolean,
): { home: number; away: number; draw?: number } {
  if (!hasDraw) {
    const [home, away] = normalise([distribution.homeWin, distribution.awayWin]);
    return { home: boundProbability(home), away: boundProbability(away) };
  }
  const [home, draw, away] = normalise([
    distribution.homeWin,
    distribution.draw,
    distribution.awayWin,
  ]);
  return {
    home: boundProbability(home),
    draw: boundProbability(draw),
    away: boundProbability(away),
  };
}

/**
 * The model's own line.
 *
 * The margin the simulations are centred on, rounded to the nearest half point
 * so it reads like a line. This is Parlay Projector's analytical number and is
 * never presented as a bookmaker's — no bookmaker data exists in this
 * application.
 */
export function modelSpread(distribution: Distribution): number {
  return Math.round(distribution.meanMargin * 2) / 2;
}
