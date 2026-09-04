/**
 * Projecting a race.
 *
 * Nothing in the scoring model transfers. That one takes two sides, gives each
 * an expected score, samples both and compares them. A Grand Prix has twenty
 * competitors and no score at all — the result is an *order*, and an order is a
 * different kind of object.
 *
 * The model here is a latent-strength order model. Each driver carries a
 * strength derived from where they have actually finished; a simulated race
 * gives every driver that strength plus noise and sorts the field by it. Run it
 * ten thousand times and the share of races in which a driver comes first is
 * their win probability, the share inside three is their podium probability,
 * and so on. Every finishing market falls out of the same simulated orders, so
 * they can never contradict one another — a driver's podium probability is
 * necessarily at least their win probability, by construction rather than by
 * assertion.
 *
 * What is deliberately *not* modelled, because the data does not exist:
 *
 *   Reliability. The feed publishes a classified finishing order and nothing
 *   else — no retirement flag, no lap count, no status. A retirement is
 *   therefore indistinguishable from a slow race, and it shows up in a driver's
 *   strength as a bad finish rather than as an explicit DNF probability. That
 *   is a real limitation and it is stated rather than papered over with an
 *   invented failure rate.
 *
 *   Pace, tyres, pit stops, weather, circuit characteristics. None are
 *   published on this feed. Circuit-specific ratings would need years of
 *   per-track history the provider does not expose, and inventing them would be
 *   the fabrication this application exists to avoid.
 *
 * Pure: given the same results and seed, the same numbers come out.
 */

import { boundProbability, clamp, createRandom, sampleNormal, seedFrom } from './math.ts';
import type { ProjectionFactor } from './factors.ts';
import { MODEL_VERSION } from './types.ts';
import type { Entrant, Game } from '../home/types';

/** Stored on every race prediction, so old ones stay interpretable. */
export const RACE_MODEL_VERSION = `${MODEL_VERSION}-race`;

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

export interface RaceModelConfig {
  /** Half-life in races for recency weighting of results. */
  formHalfLife: number;
  /** Races below which a driver's own record is not trusted on its own. */
  minRaces: number;
  /** Races at which the rating is considered fully informed. */
  targetRaces: number;
  /**
   * Spread of a single race around a driver's strength.
   *
   * The single most consequential number here. Too low and the championship
   * leader wins nine races in ten; too high and the model says every driver is
   * equally likely, which is worse than saying nothing. Set so that a clearly
   * quickest car wins roughly a third to a half of simulated races, which is
   * about what the sport actually produces.
   */
  raceNoise: number;
  /** Qualifying is a far tighter session than a race; the field spreads less. */
  qualifyingNoise: number;
  /**
   * How much a known grid slot pulls a driver's strength.
   *
   * Only applied once qualifying has actually been run. Before that the grid is
   * unknown and nothing is assumed about it.
   */
  gridWeight: number;
  /** How far back to read completed races. */
  historyDays: number;
}

export const RACE_CONFIG: RaceModelConfig = {
  formHalfLife: 5,
  minRaces: 3,
  targetRaces: 10,
  raceNoise: 0.34,
  qualifyingNoise: 0.2,
  gridWeight: 0.45,
  // Two seasons: a driver's current form is what matters, but one season alone
  // is barely twenty races and the early rounds would have nothing behind them.
  historyDays: 700,
};

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export interface DriverRating {
  driver: string;
  /** Completed races behind the rating. */
  races: number;
  /** 0..1, where 1 is winning every race. Regressed toward the field average. */
  strength: number;
  /** Finishing positions, newest first, for the explanation text. */
  recent: number[];
  /** Mean finishing position across the sample. */
  meanPosition: number | null;
}

export interface RaceRatings {
  drivers: Map<string, DriverRating>;
  /** How many completed races the ratings were built from. */
  sample: number;
}

/** One classified result, reduced to what the ratings need. */
export interface RaceResult {
  date: number;
  /** Finishing order, position 1 first. */
  order: { driver: string; position: number }[];
}

/**
 * Completed races, oldest first.
 *
 * `asOf` is the hard boundary, exactly as in the scoring model: a race is only
 * included if it started before that instant. Passing the projected race's own
 * start time is what prevents a projection seeing its own result.
 */
export function toRaceResults(games: readonly Game[], asOf: number): RaceResult[] {
  const results: RaceResult[] = [];

  for (const game of games) {
    if (game.status !== 'finished') continue;
    // Only the Grand Prix itself. Practice pace is not a result, and treating
    // it as one would rate a driver on a session nobody is trying to win.
    if (game.session !== 'Race') continue;
    if (!game.start_time) continue;

    const date = Date.parse(game.start_time);
    if (!Number.isFinite(date) || date >= asOf) continue;

    const order = (game.entrants ?? [])
      .filter((entrant): entrant is Entrant & { position: number } => entrant.position !== null)
      .map((entrant) => ({ driver: entrant.name, position: entrant.position }))
      .sort((a, b) => a.position - b.position);

    if (order.length > 1) results.push({ date, order });
  }

  return results.sort((a, b) => a.date - b.date);
}

/**
 * A finishing position as a score in 0..1.
 *
 * Linear in position rather than points-weighted: the points system rewards the
 * top ten and says nothing at all about the difference between eleventh and
 * twentieth, which is information the model would rather keep.
 */
function performance(position: number, fieldSize: number): number {
  if (fieldSize <= 1) return 0.5;
  return clamp((fieldSize - position) / (fieldSize - 1), 0, 1);
}

/**
 * Rate every driver from completed races.
 *
 * Recency-weighted, then regressed toward the field average by how little is
 * known. A driver with two races is mostly the average driver; one with a full
 * season is mostly themselves.
 */
export function buildRaceRatings(
  results: readonly RaceResult[],
  config: RaceModelConfig = RACE_CONFIG,
): RaceRatings {
  const history = new Map<string, { performances: number[]; positions: number[] }>();

  // Newest first, so the decay weights below read in the obvious order.
  for (const race of [...results].reverse()) {
    const fieldSize = race.order.length;
    for (const entry of race.order) {
      const existing = history.get(entry.driver) ?? { performances: [], positions: [] };
      existing.performances.push(performance(entry.position, fieldSize));
      existing.positions.push(entry.position);
      history.set(entry.driver, existing);
    }
  }

  const drivers = new Map<string, DriverRating>();

  for (const [driver, record] of history) {
    const weights = record.performances.map((_, index) =>
      Math.pow(0.5, index / config.formHalfLife),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const weighted =
      total > 0
        ? record.performances.reduce((sum, value, i) => sum + value * weights[i], 0) / total
        : 0.5;

    // Regression toward the field average, by how much is known.
    const trust = clamp(record.performances.length, 0, config.targetRaces) / config.targetRaces;
    const strength = 0.5 + (weighted - 0.5) * trust;

    drivers.set(driver, {
      driver,
      races: record.performances.length,
      strength: clamp(strength, 0.01, 0.99),
      recent: record.positions.slice(0, 5),
      meanPosition:
        record.positions.length > 0
          ? record.positions.reduce((sum, value) => sum + value, 0) / record.positions.length
          : null,
    });
  }

  return { drivers, sample: results.length };
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface RaceSimulationOptions {
  simulations: number;
  seed: number;
  noise: number;
  /** Grid slots by driver, once qualifying has run. */
  grid?: ReadonlyMap<string, number> | null;
  config?: RaceModelConfig;
}

export interface RaceDistribution {
  /** Driver names, in the order the columns below use. */
  drivers: string[];
  /**
   * Finishing positions per simulation, `positions[sim][driverIndex]`.
   *
   * Kept whole rather than reduced to per-driver probabilities, because a
   * combination of race legs has to be counted across the same simulated races
   * — the same property that makes same-game combinations honest elsewhere.
   */
  positions: Int8Array[];
  simulations: number;
}

/**
 * Simulate the race repeatedly.
 *
 * Each driver gets their strength plus Gaussian noise; the field is sorted by
 * that score. This is a latent-order model, not a shuffle: a quicker car wins
 * more often, and the amount more often is governed by one stated parameter
 * rather than by chance.
 */
export function simulateRace(
  entrants: readonly string[],
  ratings: RaceRatings,
  options: RaceSimulationOptions,
): RaceDistribution {
  const config = options.config ?? RACE_CONFIG;
  const random = createRandom(options.seed);
  const count = Math.max(200, Math.floor(options.simulations));
  const drivers = [...entrants];

  const base = drivers.map((driver) => {
    const rating = ratings.drivers.get(driver);
    let strength = rating?.strength ?? 0.5;

    // A known grid slot is strong evidence about a race that has not run yet,
    // and is only ever applied when qualifying has genuinely taken place.
    const slot = options.grid?.get(driver);
    if (slot !== undefined && drivers.length > 1) {
      const fromGrid = performance(slot, drivers.length);
      strength = strength * (1 - config.gridWeight) + fromGrid * config.gridWeight;
    }
    return strength;
  });

  const positions: Int8Array[] = [];

  for (let run = 0; run < count; run += 1) {
    const scored = base.map((strength, index) => ({
      index,
      score: strength + sampleNormal(0, options.noise, random),
    }));
    scored.sort((a, b) => b.score - a.score);

    const order = new Int8Array(drivers.length);
    scored.forEach((entry, place) => {
      order[entry.index] = place + 1;
    });
    positions.push(order);
  }

  return { drivers, positions, simulations: count };
}

// ---------------------------------------------------------------------------
// Reading probabilities off the simulations
// ---------------------------------------------------------------------------

/** How often a driver is classified inside `within`. */
export function finishProbability(
  distribution: RaceDistribution,
  driver: string,
  within: number,
): number {
  const index = distribution.drivers.indexOf(driver);
  if (index < 0) return 0;

  let hits = 0;
  for (const order of distribution.positions) {
    if (order[index] <= within) hits += 1;
  }
  return boundProbability(hits / distribution.positions.length);
}

/** How often one driver is classified ahead of another. */
export function headToHeadProbability(
  distribution: RaceDistribution,
  driver: string,
  over: string,
): number {
  const a = distribution.drivers.indexOf(driver);
  const b = distribution.drivers.indexOf(over);
  if (a < 0 || b < 0) return 0;

  let hits = 0;
  for (const order of distribution.positions) {
    if (order[a] < order[b]) hits += 1;
  }
  return boundProbability(hits / distribution.positions.length);
}

/** Mean finishing position across the simulations. */
export function meanPosition(distribution: RaceDistribution, driver: string): number {
  const index = distribution.drivers.indexOf(driver);
  if (index < 0) return distribution.drivers.length;

  let total = 0;
  for (const order of distribution.positions) total += order[index];
  return Number((total / distribution.positions.length).toFixed(2));
}

/**
 * How often every leg comes in together, counted across the same races.
 *
 * The race counterpart of `jointProbability`. Two markets on one Grand Prix are
 * strongly related — a driver winning and the same driver on the podium are
 * nearly the same bet — and multiplying them would misstate the combination
 * badly.
 */
export function jointRaceProbability(
  distribution: RaceDistribution,
  legs: readonly { driver: string; within?: number; over?: string }[],
): number {
  if (legs.length === 0) return 0;

  const resolved = legs.map((leg) => ({
    index: distribution.drivers.indexOf(leg.driver),
    rival: leg.over === undefined ? -1 : distribution.drivers.indexOf(leg.over),
    within: leg.within,
  }));
  if (resolved.some((leg) => leg.index < 0)) return 0;

  let hits = 0;
  for (const order of distribution.positions) {
    let all = true;
    for (const leg of resolved) {
      const ok =
        leg.within !== undefined
          ? order[leg.index] <= leg.within
          : leg.rival >= 0 && order[leg.index] < order[leg.rival];
      if (!ok) {
        all = false;
        break;
      }
    }
    if (all) hits += 1;
  }

  return boundProbability(hits / distribution.positions.length);
}

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

/**
 * How much the projection actually stands on, 0..1.
 *
 * Driven by how many races the field's drivers have behind them and whether
 * the grid is known. It is never inflated to cover a gap: a race projected
 * before anyone has driven a lap this season scores low and says why.
 */
export function raceDataQuality(
  entrants: readonly string[],
  ratings: RaceRatings,
  hasGrid: boolean,
  config: RaceModelConfig = RACE_CONFIG,
): number {
  if (entrants.length === 0) return 0;

  const rated = entrants
    .map((driver) => ratings.drivers.get(driver)?.races ?? 0)
    .sort((a, b) => a - b);

  // The median driver's history, so a couple of debutants do not sink an
  // otherwise well-understood field, and a couple of veterans do not rescue an
  // unknown one.
  const median = rated[Math.floor(rated.length / 2)] ?? 0;
  const history = clamp(median / config.targetRaces, 0, 1) * 0.7;
  const coverage =
    clamp(entrants.filter((d) => ratings.drivers.has(d)).length / entrants.length, 0, 1) * 0.15;
  const grid = hasGrid ? 0.15 : 0;

  return clamp(history + coverage + grid, 0, 1);
}

export function raceQualityReasons(
  entrants: readonly string[],
  ratings: RaceRatings,
  hasGrid: boolean,
  config: RaceModelConfig = RACE_CONFIG,
): string[] {
  const reasons: string[] = [];

  const unrated = entrants.filter((driver) => !ratings.drivers.has(driver));
  if (unrated.length > 0) {
    reasons.push(
      `${unrated.length} of ${entrants.length} entered drivers have no completed races on record and are rated as an average driver.`,
    );
  }

  const thin = entrants.filter((driver) => {
    const races = ratings.drivers.get(driver)?.races ?? 0;
    return races > 0 && races < config.minRaces;
  });
  if (thin.length > 0) {
    reasons.push(`${thin.length} drivers have fewer than ${config.minRaces} races behind them.`);
  }

  reasons.push(
    hasGrid
      ? 'Qualifying has been run, so the starting grid is known and used.'
      : 'Qualifying has not been run, so the starting grid is unknown and not assumed.',
  );

  /*
   * Stated on every race projection. These are not gaps that more of the season
   * would close — the provider publishes a classified finishing order and
   * nothing else, so a reader comparing this against a timing service needs to
   * know what is missing.
   */
  reasons.push(
    'No lap times, pace, tyre, pit-stop or retirement data is published for this competition, so reliability is not modelled separately.',
  );

  return reasons;
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/** Why the model rates a driver where it does, from their own record. */
export function raceFactors(
  driver: string,
  ratings: RaceRatings,
  distribution: RaceDistribution,
  grid: number | null,
): ProjectionFactor[] {
  const factors: ProjectionFactor[] = [];
  const rating = ratings.drivers.get(driver);

  if (!rating) {
    factors.push({
      text: `${driver} has no completed races on record, so the model rates them as an average driver.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
    return factors;
  }

  if (rating.recent.length > 0) {
    const best = Math.min(...rating.recent);
    factors.push({
      text: `${driver} recent finishes: ${rating.recent.map((p) => `P${p}`).join(', ')} (newest first).`,
      subject: { kind: 'team', team: driver, favourable: best <= 5 },
      direction: best <= 5 ? 'positive' : 'negative',
    });
  }

  if (rating.meanPosition !== null) {
    factors.push({
      text: `${driver} averages P${rating.meanPosition.toFixed(1)} across ${rating.races} completed ${
        rating.races === 1 ? 'race' : 'races'
      }.`,
      subject: { kind: 'team', team: driver, favourable: rating.meanPosition <= 8 },
      direction: rating.meanPosition <= 8 ? 'positive' : 'negative',
    });
  }

  if (grid !== null) {
    factors.push({
      text: `${driver} starts from P${grid}.`,
      subject: { kind: 'team', team: driver, favourable: grid <= 5 },
      direction: grid <= 5 ? 'positive' : 'negative',
    });
  }

  const projected = meanPosition(distribution, driver);
  factors.push({
    text: `Across ${distribution.simulations.toLocaleString('en-GB')} simulated races the model finishes them P${projected.toFixed(1)} on average.`,
    subject: { kind: 'team', team: driver, favourable: projected <= 8 },
    direction: projected <= 8 ? 'positive' : 'negative',
  });

  if (rating.races < RACE_CONFIG.minRaces) {
    factors.push({
      text: `Only ${rating.races} completed ${rating.races === 1 ? 'race' : 'races'} behind this rating, so it is provisional.`,
      subject: { kind: 'uncertainty' },
      direction: 'negative',
    });
  }

  return factors;
}

/** Deterministic seed, so a race reproduces the same projection. */
export function raceSeed(gameId: string): number {
  return seedFrom(gameId);
}
