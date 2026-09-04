/**
 * Projection contracts.
 *
 * Every number here is an *estimate with stated uncertainty*. Nothing in this
 * system claims certainty, and no field exists that would let it: there is no
 * "lock", no "guaranteed", and no monetary return.
 *
 * Market data lives in `lib/markets` and is attached to a selection as a
 * separate object, never merged into the model's own numbers. A probability
 * here is always Parlay Projector's estimate; a price is always somebody
 * else's. The two are compared, and they are never conflated.
 */

import type { ConcreteSportId } from '../home/types';
import type { MarketContext, SettlementRule } from '../markets/types';
import type { OrientedFactors, ProjectionFactor } from './factors.ts';

/**
 * Settlement rules and evidence are defined alongside the concepts they belong
 * to — a settlement rule is a property of a market, not of a model — and
 * re-exported here so existing importers are unaffected.
 */
export type { SettlementRule } from '../markets/types';
export type { FactorSubject, ProjectionFactor } from './factors.ts';

/** Current model. Stored on every prediction so old ones stay interpretable. */
export const MODEL_VERSION = 'projection-v1';

// ---------------------------------------------------------------------------
// Quality and confidence
// ---------------------------------------------------------------------------

/**
 * How much information the projection was built from, 0..1.
 *
 * A projection standing on a full season of results, standings and a settled
 * head-to-head record scores far higher than one standing on a handful of
 * games. Below `MIN_DATA_QUALITY` no projection is produced at all.
 */
export type DataQuality = number;

/** Below this, the honest answer is "insufficient data", not a low confidence. */
export const MIN_DATA_QUALITY = 0.35;

export function qualityLabel(quality: DataQuality): 'High' | 'Medium' | 'Low' {
  if (quality >= 0.75) return 'High';
  if (quality >= 0.5) return 'Medium';
  return 'Low';
}

// ---------------------------------------------------------------------------
// Game projection
// ---------------------------------------------------------------------------

/** Outcome probabilities. `draw` is present only for sports that have one. */
export interface OutcomeProbabilities {
  home: number;
  away: number;
  draw?: number;
}

export interface GameProjection {
  game_id: string;
  sport: ConcreteSportId;
  league: string | null;
  start_time: string | null;
  home_team: string;
  away_team: string;

  outcome: OutcomeProbabilities;

  /** Expected score, unrounded. The display may round; this is the estimate. */
  expected_home_score: number;
  expected_away_score: number;
  /** home - away. Positive favours the home side, always. */
  expected_margin: number;
  expected_total: number;

  /**
   * The model's own line, derived from `expected_margin`. This is Parlay
   * Projector's analytical line and is never a bookmaker's.
   */
  model_spread: number;

  /** Reliability of the estimate itself, 0..1. Distinct from probability. */
  confidence: number;
  data_quality: DataQuality;
  model_version: string;

  /**
   * A scoreline a game could actually finish on.
   *
   * The median simulated score for each side. Shown alongside the expected
   * score because an expectation of 4.6 runs is not a result anybody can
   * finish on, and printing it alone invites a reader to treat an average as a
   * prediction of the scoreline. The median is used rather than the most
   * frequent exact score because in a high-scoring sport the modal score is
   * sampling noise.
   */
  typical_score: { home: number; away: number } | null;
  /**
   * Where the middle half of the simulations landed, per side, inclusive.
   *
   * The honest expression of the projection's spread: a range, not a number.
   */
  likely_home_range: [number, number] | null;
  likely_away_range: [number, number] | null;

  /** Why the data quality is what it is, in words. */
  quality_reasons: string[];

  /** What drove the projection, for the explanation shown to the reader. */
  factors: ProjectionFactor[];
  /** ISO-8601 instant this projection was computed. */
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

/**
 * Kinds of selection the engine can produce.
 *
 * `player_performance` is defined here and handled by settlement, but nothing
 * currently generates it: rosters carry no statistics, and there is no injury,
 * lineup or expected-starter data, so §27's preconditions ("player data
 * exists + player expected to participate + sufficient history") cannot be met.
 * Producing player props from an unavailable dataset would be fabrication.
 */
export type SelectionType =
  | 'winner'
  | 'double_chance'
  | 'spread'
  | 'total'
  | 'team_total'
  | 'player_performance';

export interface Selection {
  id: string;
  game_id: string;
  sport: ConcreteSportId;
  league: string | null;
  start_time: string | null;
  /** Readable fixture, e.g. `Arsenal v Chelsea`. */
  fixture: string;

  type: SelectionType;
  /**
   * The selection as a betting slip would print it, e.g. `Bills +4.5`.
   *
   * The headline on a leg. What kind of bet it is lives in `market.label`,
   * and what has to happen for it to win lives in `explanation` — the three
   * used to be one string and a reader had to disentangle them.
   */
  label: string;

  /**
   * The bet, as distinct from the prediction.
   *
   * Says which market this is, at which line, whether a bookmaker is actually
   * offering it, and at what price. A selection with
   * `market.availability === 'model_only'` is analysis: the model derived the
   * line itself and nothing confirms anyone offers it.
   */
  market: MarketContext;

  /** Plain English: what must happen for this selection to win. */
  explanation: string;
  /** What the probability below is a probability *of*. */
  probability_label: string;

  /** The model's estimate that this outcome occurs, 0..1. */
  probability: number;
  /**
   * The model against the price, where a price exists.
   *
   * Null when the market is unverified — there is nothing to disagree with.
   */
  edge: EdgeAssessment | null;
  /** How reliable that estimate is, 0..1. Separate from probability. */
  confidence: number;
  data_quality: DataQuality;

  /**
   * Ranking score. Not shown as a headline number — it exists to order
   * candidates, and combines probability with how much the model can be
   * trusted on this particular game.
   */
  score: number;

  /**
   * Selections that cannot appear together without joint modelling.
   * Every selection from one game shares a group, so the optimiser can enforce
   * one per game rather than multiplying correlated probabilities.
   */
  correlation_group: string;

  /** Settlement inputs, retained so a result can be judged without re-deriving. */
  settlement: SettlementRule;

  /**
   * The fixture's evidence, sorted for *this* selection.
   *
   * Supporting, opposing and merely contextual are decided by comparing each
   * factor against what this selection needs — so the same fact is correctly
   * a reason on one leg and a caution on another. See `factors.ts`.
   */
  reasoning: OrientedFactors;

  /** The projection this came from, for the score shown beside the selection. */
  projection: GameProjection;
}

/**
 * The model's probability set against the market's.
 *
 * Deliberately not called "value". A gap means the model and the price
 * disagree; it does not establish which of them is right, and the model is the
 * one with nothing at stake.
 */
export interface EdgeAssessment {
  /** What the price implies, margin included. */
  implied: number;
  /** The market's view with the margin removed. Null if only one side is known. */
  fair: number | null;
  /** Model probability minus implied. */
  edge: number;
  /** Model probability minus fair. The like-for-like comparison. */
  fair_edge: number | null;
}

// ---------------------------------------------------------------------------
// Parlays
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Where a line's legs come from.
 *
 *   multi_game  one leg per fixture, so the legs are near enough independent
 *   same_game   several legs from one fixture, which are not
 */
export type ParlayKind = 'multi_game' | 'same_game';

/**
 * How much the legs move together.
 *
 * `ratio` is the joint probability divided by the product of the individual
 * probabilities. One means independent; above one means the legs tend to come
 * in together; below one means backing one makes the other less likely.
 *
 * For a same-game line this is measured rather than assumed: every leg is
 * evaluated against the same set of simulated games, so the joint probability
 * is counted directly. See `correlation.ts`.
 */
export interface CorrelationAssessment {
  level: 'low' | 'moderate' | 'high';
  ratio: number | null;
  note: string;
}

/**
 * The price of a whole line, when every leg carries one.
 *
 * Null the moment a single leg is unpriced. A combined price built by
 * substituting the model's own probability for a missing quote would be a
 * fabricated headline number, and the reader has no way to tell which legs
 * were real.
 */
export interface ParlayPrice {
  decimal: number;
  american: number;
  fractional: string;
  /** What the combined price implies, margin included. */
  implied: number;
  /** Model probability minus implied. Disagreement, not an advantage. */
  edge: number;
  /** Books quoting the legs. */
  sources: string[];
}

export interface Parlay {
  risk: RiskLevel;
  kind: ParlayKind;
  legs: Selection[];

  /**
   * Product of the leg probabilities, treating them as independent.
   *
   * Sound for a multi-game line, where the optimiser takes at most one
   * selection per fixture. Reported alongside the combined figure for a
   * same-game line specifically so the difference correlation makes is
   * visible rather than hidden inside one number.
   */
  independent_probability: number;

  /**
   * The probability actually claimed for the line.
   *
   * Equal to `independent_probability` for a multi-game line. For a same-game
   * line it is the measured joint probability, which is the honest figure —
   * multiplying correlated legs would misstate it, usually downwards.
   */
  combined_probability: number;

  correlation: CorrelationAssessment;
  /** Null unless every leg is quoted by a book. */
  price: ParlayPrice | null;

  average_confidence: number;
  average_data_quality: DataQuality;
  /** How many legs a bookmaker was confirmed to be offering. */
  verified_legs: number;
  /** Why this line came out at this risk level, in words. */
  risk_rationale: string;

  model_version: string;
  generated_at: string;
}

export type ParlayErrorCode = 'insufficient_candidates' | 'projection_unavailable';

/**
 * Overall state of a generated line.
 *
 * Deliberately separate from individual prediction accuracy: a three-leg line
 * losing one leg is a lost line but two correct predictions, and conflating
 * the two would understate the model badly.
 */
export type ParlayStatus = 'pending' | 'live' | 'won' | 'lost' | 'void';

/**
 * A generated line, kept so the optimiser can be measured as well as the model.
 *
 * Stores the combined probability it claimed, so that estimate can be checked
 * against how often lines of that strength actually came in.
 */
export interface ParlayRecord {
  id: string;
  risk: RiskLevel;
  /**
   * Whether the legs came from different fixtures or from one.
   *
   * Optional because records written before same-game lines existed do not
   * carry it; those are all multi-game by construction. Stored so the two can
   * be measured apart — they are different claims and a combined success rate
   * across both would say little about either.
   */
  kind?: ParlayKind;
  /** Prediction ids of the legs, in the order they were presented. */
  leg_ids: string[];
  /**
   * The probability the line actually claimed when it was published.
   *
   * Recorded rather than recomputed. For a same-game line the claim is the
   * measured joint probability, and multiplying the legs here would store a
   * figure the model never made — then judge it against that.
   */
  combined_probability: number;
  average_confidence: number;
  average_data_quality: number;
  model_version: string;
  created_at: string;
  /** Earliest kick-off across the legs, for the settlement queue. */
  first_start: string | null;
  status: ParlayStatus;
  settled_at: string | null;
}

// ---------------------------------------------------------------------------
// Stored predictions
// ---------------------------------------------------------------------------

/**
 * Lifecycle of a published prediction.
 *
 *   pending    the game has not started
 *   live       the game is under way; the outcome is not known yet
 *   won        the prediction came in
 *   lost       it did not
 *   push       the result landed exactly on the line, so neither side won
 *   void       it cannot fairly be judged (never played, player did not feature)
 *   unsettled  the game finished but the statistic needed has not arrived
 *
 * `live` and `unsettled` are working states: a prediction in either is still
 * being tracked and will move on. Only `won` and `lost` count toward accuracy.
 */
export type PredictionStatus =
  | 'pending'
  | 'live'
  | 'won'
  | 'lost'
  | 'push'
  | 'void'
  | 'unsettled';

/** Statuses that contribute to the headline accuracy figure. */
export const COUNTED_STATUSES: readonly PredictionStatus[] = ['won', 'lost'];

/** Statuses meaning nothing more will happen. */
export const TERMINAL_STATUSES: readonly PredictionStatus[] = [
  'won',
  'lost',
  'push',
  'void',
];

/** Statuses the settlement queue still has work to do on. */
export const OPEN_STATUSES: readonly PredictionStatus[] = ['pending', 'live', 'unsettled'];

/**
 * The scoreline the model projected, frozen with the prediction.
 *
 * Kept so score accuracy can be measured against what was actually published,
 * rather than against a projection regenerated later from better information.
 */
export interface ProjectedOutcome {
  home_score: number;
  away_score: number;
  margin: number;
  total: number;
}

/** What actually happened, recorded at settlement. */
export interface ActualOutcome {
  home_score: number;
  away_score: number;
  margin: number;
  total: number;
}

/**
 * One change to a settled result.
 *
 * Providers do correct final statistics. When a correction changes a
 * settlement inside the finalisation window the result is updated and the
 * change is recorded here — the figures stay accurate without history quietly
 * rewriting itself.
 */
export interface SettlementAudit {
  previous_result: PredictionStatus;
  new_result: PredictionStatus;
  reason: string;
  changed_at: string;
}

/**
 * A published selection, kept so the model can be measured.
 *
 * The probability and the settlement rule are frozen at creation. Nothing about
 * a stored prediction is ever recomputed from later information — that is what
 * makes the accuracy figures mean anything.
 */
export interface PredictionRecordV2 {
  id: string;
  game_id: string;
  sport: string;
  league: string | null;
  selection_type: SelectionType;
  selection: string;
  settlement: SettlementRule;

  /**
   * The two sides, frozen with the prediction.
   *
   * Stored because a settled result is unreadable without them: `2-1` says
   * nothing, `Arsenal 2-1 Chelsea` says everything. The fixture is not
   * re-fetched to find out — a result page must not depend on a provider still
   * carrying a game from three weeks ago.
   *
   * Optional: records written before this existed do not have them, and the
   * interface omits the scoreline rather than inventing a name for it.
   */
  home_team?: string | null;
  away_team?: string | null;
  model_probability: number;
  model_confidence: number;
  data_quality: number;
  model_version: string;
  risk: RiskLevel | null;
  created_at: string;
  game_start: string | null;
  status: PredictionStatus;
  /** What actually happened, in words, once known. */
  result: string | null;
  settled_at: string | null;

  /**
   * The last projection published for this fixture before kick-off.
   *
   * Headline accuracy counts only these. A fixture may be projected several
   * times as its kick-off approaches, and counting every version would weight
   * heavily-refreshed games more than quiet ones.
   *
   * Decided once, when the game starts, and never revisited.
   */
  final_pre_game: boolean;

  /** The generated line this was published as part of, if any. */
  parlay_id: string | null;

  /** The scoreline the model projected. Frozen with the prediction. */
  projected: ProjectedOutcome | null;
  /** The real scoreline. Null until the game finishes. */
  actual: ActualOutcome | null;

  /** Settlement attempts so far, for the retry backoff. */
  attempts: number;
  /** Earliest instant the next settlement attempt should run. */
  next_attempt_at: string | null;

  /** Corrections to an already-settled result. Empty in the normal case. */
  audit: SettlementAudit[];
}
