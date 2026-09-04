/**
 * Sport-specific model configuration.
 *
 * Every tunable number lives here rather than scattered through the models, so
 * the assumptions are visible in one place and can be revised without hunting
 * through formulas.
 *
 * Nothing is shared blindly across sports. Home advantage in the NBA is not
 * home advantage in the Premier League; a 27-point NFL score and a 2-goal
 * football score are not the same kind of quantity and are not modelled the
 * same way.
 *
 * The values are starting points calibrated from the long-run averages of each
 * competition, not learned parameters. They are stated as assumptions and
 * should be recalibrated once enough settled predictions exist — see
 * docs/projection-engine.md.
 */

import type { ConcreteSportId } from '../home/types';

/**
 * How a sport's scoring is modelled.
 *
 * `poisson`  Low-scoring, count-like: goals and runs. Discrete, right-skewed,
 *            and a draw is a real possibility.
 * `normal`   High-scoring: points. The total of many small scoring events is
 *            near-normal, and an exact tie is rare enough to ignore.
 */
export type ScoringModel = 'poisson' | 'normal';

export interface SportModelConfig {
  scoring: ScoringModel;
  /** Whether a drawn result is a genuine outcome that must be modelled. */
  hasDraw: boolean;
  /** Whether a points handicap is a sensible selection for this sport. */
  supportsSpread: boolean;

  /**
   * Typical combined score, used as the prior a team's rates regress toward
   * when its own sample is thin.
   */
  baselineTotal: number;
  /** Home advantage, in points/goals added to the home side's expectation. */
  homeAdvantage: number;
  /**
   * Standard deviation of a single team's score, for the normal model.
   * Ignored by Poisson sports, where the variance is the mean.
   */
  scoreSd: number;

  /** Elo K-factor. Higher means ratings move faster per game. */
  eloK: number;
  /**
   * Points of expected margin per 100 Elo. Converts a rating gap into a
   * scoreline, so Elo can inform the margin rather than be a separate answer.
   */
  marginPerHundredElo: number;
  /**
   * How much the Elo-implied margin is blended with the scoring model's.
   * 0 ignores Elo; 1 would use it alone, which the brief rules out.
   */
  eloWeight: number;

  /** Half-life in games for recency weighting of results. */
  formHalfLife: number;
  /** Weight given to season-long form versus the recent window. */
  seasonWeight: number;
  /** Games below which a team's own rates are not trusted on their own. */
  minGames: number;
  /** Games at which data quality from history alone is considered full. */
  targetGames: number;

  /**
   * How far back to load completed results, in days.
   *
   * Set per sport from the shape of its calendar rather than one figure for
   * everything: an NFL team plays seventeen games across five months, so a
   * 200-day window in September holds barely one of them, while an NBA team
   * plays eighty in six.
   */
  historyDays: number;

  /**
   * Ratings pool this competition belongs to.
   *
   * Competitions sharing a pool are rated together. Football uses one pool so a
   * Champions League fixture is projected from the clubs' domestic results —
   * without it, a club's handful of European games is far below the minimum and
   * every cup tie reads "projection unavailable". The pooling is also sound:
   * these competitions are exactly where clubs from different leagues play each
   * other, so a shared Elo is meaningful rather than a category error.
   *
   * Null means the competition is rated on its own.
   */
  ratingPool: string | null;

  /** Days between games under which a side is treated as short-rested. */
  shortRestDays: number;
  /** Points removed from a short-rested side's expectation. */
  shortRestPenalty: number;
}

const NFL: SportModelConfig = {
  scoring: 'normal',
  hasDraw: false,
  supportsSpread: true,
  baselineTotal: 44,
  // Long the largest home edge in the major American leagues, though it has
  // shrunk in recent seasons.
  homeAdvantage: 1.8,
  scoreSd: 10,
  eloK: 20,
  marginPerHundredElo: 2.8,
  eloWeight: 0.4,
  formHalfLife: 5,
  seasonWeight: 0.6,
  // A 17-game season means "a full sample" is small by any other sport's
  // standards, so the thresholds are correspondingly low.
  minGames: 4,
  targetGames: 12,
  // A full previous season plus the current one. Anything shorter leaves every
  // team below the minimum until October.
  historyDays: 400,
  ratingPool: null,
  shortRestDays: 5,
  shortRestPenalty: 1.0,
};

const NBA: SportModelConfig = {
  scoring: 'normal',
  hasDraw: false,
  supportsSpread: true,
  baselineTotal: 226,
  homeAdvantage: 2.2,
  scoreSd: 12,
  eloK: 20,
  marginPerHundredElo: 3.5,
  eloWeight: 0.4,
  formHalfLife: 8,
  seasonWeight: 0.6,
  minGames: 6,
  targetGames: 25,
  historyDays: 330,
  ratingPool: null,
  // Back-to-backs are the defining rest effect in basketball.
  shortRestDays: 1,
  shortRestPenalty: 1.5,
};

const MLB: SportModelConfig = {
  scoring: 'poisson',
  hasDraw: false,
  supportsSpread: true,
  baselineTotal: 8.6,
  // The smallest home edge of these sports, and baseball is the noisiest:
  // single games carry little signal, which the model reflects rather than
  // hides.
  homeAdvantage: 0.2,
  scoreSd: 3,
  eloK: 6,
  marginPerHundredElo: 0.5,
  eloWeight: 0.3,
  formHalfLife: 15,
  seasonWeight: 0.7,
  minGames: 15,
  targetGames: 60,
  historyDays: 300,
  ratingPool: null,
  shortRestDays: 0,
  shortRestPenalty: 0,
};

const NHL: SportModelConfig = {
  scoring: 'poisson',
  hasDraw: false,
  supportsSpread: true,
  baselineTotal: 6.2,
  homeAdvantage: 0.25,
  scoreSd: 2,
  eloK: 8,
  marginPerHundredElo: 0.45,
  eloWeight: 0.35,
  formHalfLife: 10,
  seasonWeight: 0.65,
  minGames: 10,
  targetGames: 35,
  historyDays: 330,
  ratingPool: null,
  shortRestDays: 1,
  shortRestPenalty: 0.15,
};

const FOOTBALL: SportModelConfig = {
  scoring: 'poisson',
  hasDraw: true,
  // A goal handicap on a 2.7-goal game is a different animal from an NFL
  // spread, and the model has no reliable way to price the half-goal lines
  // that would matter. Left out rather than guessed.
  supportsSpread: false,
  baselineTotal: 2.7,
  homeAdvantage: 0.3,
  scoreSd: 1.3,
  eloK: 20,
  marginPerHundredElo: 0.5,
  eloWeight: 0.35,
  formHalfLife: 6,
  seasonWeight: 0.6,
  minGames: 6,
  targetGames: 20,
  // A season runs August to May, so a year is needed to hold a full one.
  historyDays: 400,
  // Every football competition rates together, so European ties can draw on
  // the clubs' domestic form.
  ratingPool: 'football',
  shortRestDays: 3,
  shortRestPenalty: 0.1,
};

/**
 * Canadian football is not American football.
 *
 * Three downs instead of four, twelve players a side, a longer and wider field
 * and a deeper end zone. The game scores appreciably higher — a combined total
 * in the low fifties against the NFL's mid forties — so applying the NFL's
 * baseline would centre every projected scoreline several points low.
 *
 * The season is 18 games, one longer than the NFL's, so the sample thresholds
 * are near enough the same.
 */
const CFL: SportModelConfig = {
  ...NFL,
  baselineTotal: 52,
  scoreSd: 11,
  homeAdvantage: 1.6,
  marginPerHundredElo: 3.0,
  // A June-to-November season, so a year comfortably covers the last one.
  historyDays: 400,
};

/**
 * The European competitions.
 *
 * Short summer seasons — a handful of games a team — and far less history than
 * any other competition here. The thresholds are correspondingly cautious:
 * `minGames` is the same as the NFL's but `targetGames` is much lower, so a
 * team reaches full rating trust on the sample the competition actually
 * provides rather than never reaching it at all.
 *
 * Scoring is closer to the NFL's than the CFL's, but is genuinely unverified —
 * see docs/data-providers.md. These sit on the baseline until settled
 * predictions say otherwise.
 */
const EURO_AMERICAN: SportModelConfig = {
  ...NFL,
  baselineTotal: 46,
  minGames: 4,
  targetGames: 8,
  formHalfLife: 3,
  historyDays: 400,
};

/**
 * Tennis has no configuration because it has no data.
 *
 * The shared SportId type still contains `tennis`, but the league catalogue
 * holds no tennis competition, so there are no fixtures, no results and no
 * ratings to build one from. A model here would have nothing to run on.
 */
const CONFIGS: Partial<Record<ConcreteSportId, SportModelConfig>> = {
  nfl: NFL,
  nba: NBA,
  mlb: MLB,
  nhl: NHL,
  football: FOOTBALL,
};

/**
 * Competitions whose model differs from their sport's default.
 *
 * Keyed by league id, checked before the sport. Several competitions share a
 * sport id — the CFL, the NFL and NCAA football are all `nfl` — and they do not
 * all score alike.
 */
const LEAGUE_CONFIGS: Record<string, SportModelConfig> = {
  cfl: CFL,
  afle: EURO_AMERICAN,
  efa: EURO_AMERICAN,
};

export function modelConfigFor(sport: ConcreteSportId): SportModelConfig | null {
  return CONFIGS[sport] ?? null;
}

/**
 * The model for a competition.
 *
 * Prefers a league-specific configuration, falling back to the sport's. Callers
 * that hold a league should use this; `modelConfigFor` remains for the places
 * that only know a sport.
 */
export function modelConfigForLeague(
  leagueId: string,
  sport: ConcreteSportId,
): SportModelConfig | null {
  return LEAGUE_CONFIGS[leagueId] ?? modelConfigFor(sport);
}

export function isSupportedSport(sport: ConcreteSportId): boolean {
  return modelConfigFor(sport) !== null;
}

// ---------------------------------------------------------------------------
// Risk profiles
// ---------------------------------------------------------------------------

export interface RiskProfile {
  /** Individual selection probability a candidate must fall within. */
  minProbability: number;
  maxProbability: number;
  /** Default number of legs; the reader may override. */
  defaultLegs: number;
  /** A candidate below this data quality is never used at this risk level. */
  minDataQuality: number;
  /** A candidate below this confidence is never used at this risk level. */
  minConfidence: number;
  /** Selection types permitted, most conservative first. */
  allowedTypes: readonly string[];
}

/**
 * Risk thresholds.
 *
 * Relative analytical categories, not promises. "Low risk" means the model
 * found high-probability, low-variance selections it can stand behind — it does
 * not mean the outcome is safe, and nothing in this system says otherwise.
 *
 * The upper bound on Low is deliberate: a 97% selection usually means the model
 * has a thin sample and an extreme rating gap, which is a data problem wearing
 * a confident face.
 */
export const RISK_PROFILES: Record<'low' | 'medium' | 'high', RiskProfile> = {
  low: {
    minProbability: 0.7,
    maxProbability: 0.95,
    defaultLegs: 3,
    minDataQuality: 0.6,
    minConfidence: 0.6,
    /*
     * Conservative shapes only: a generous handicap, a double chance, a low
     * team-total threshold — and in motorsport, a strong driver to finish in
     * the points or to beat one particular rival.
     *
     * The probability band does the real work of separating the levels. A
     * points finish for a leading driver clears 80%; a podium sits around
     * 60% and lands in Medium; a race win is nearer 30% and clears none of
     * them, which is the honest answer rather than a forced inclusion.
     */
    allowedTypes: [
      'double_chance',
      'spread',
      'team_total',
      'winner',
      'total',
      'finish_position',
      'head_to_head',
    ],
  },
  medium: {
    minProbability: 0.58,
    maxProbability: 0.78,
    defaultLegs: 4,
    minDataQuality: 0.5,
    minConfidence: 0.5,
    allowedTypes: [
      'winner',
      'spread',
      'total',
      'team_total',
      'double_chance',
      'finish_position',
      'head_to_head',
    ],
  },
  high: {
    minProbability: 0.45,
    maxProbability: 0.66,
    defaultLegs: 5,
    minDataQuality: 0.45,
    minConfidence: 0.45,
    allowedTypes: [
      'winner',
      'spread',
      'total',
      'team_total',
      'finish_position',
      'head_to_head',
    ],
  },
};

export const MIN_LEGS = 2;
export const MAX_LEGS = 6;
