/**
 * Projection contracts.
 *
 * Every number here is an *estimate with stated uncertainty*. Nothing in this
 * system claims certainty, and no field exists that would let it: there is no
 * "lock", no "guaranteed", and no monetary return.
 *
 * Deliberately contains no bookmaker fields — no odds, no prices, no
 * bookmakers, no markets. `implied_odds` is the model's own probability
 * expressed as a decimal, labelled as such, and is analytics only.
 */

import type { ConcreteSportId } from '../home/types';

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

  /** What drove the projection, for the explanation shown to the reader. */
  factors: ProjectionFactor[];
  /** ISO-8601 instant this projection was computed. */
  generated_at: string;
}

/** One contributing reason, positive or negative. */
export interface ProjectionFactor {
  /** `+` supports the projection, `-` argues against it. */
  direction: 'positive' | 'negative';
  text: string;
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
  /** What is being projected, e.g. `Bills +4.5` or `Arsenal 1+ goals`. */
  label: string;

  /** The model's estimate that this outcome occurs, 0..1. */
  probability: number;
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

  factors: ProjectionFactor[];
  /** The projection this came from, for the score shown beside the selection. */
  projection: GameProjection;
}

/**
 * Everything settlement needs, fixed at prediction time.
 *
 * Stored rather than recomputed so a result is judged against the line the
 * model actually published — recomputing later would silently move the target.
 */
export type SettlementRule =
  | { kind: 'winner'; side: 'home' | 'away' | 'draw' }
  | { kind: 'double_chance'; sides: ('home' | 'away' | 'draw')[] }
  | { kind: 'spread'; side: 'home' | 'away'; line: number }
  | { kind: 'total'; direction: 'over' | 'under'; line: number }
  | { kind: 'team_total'; side: 'home' | 'away'; direction: 'over' | 'under'; line: number };

// ---------------------------------------------------------------------------
// Parlays
// ---------------------------------------------------------------------------

export type RiskLevel = 'low' | 'medium' | 'high';

export interface Parlay {
  risk: RiskLevel;
  legs: Selection[];
  /**
   * Product of the leg probabilities.
   *
   * Valid only because the optimiser takes at most one selection per game, so
   * the legs are across different fixtures and approximately independent.
   * Same-game combinations would need a joint model and are not produced.
   */
  combined_probability: number;
  average_confidence: number;
  average_data_quality: DataQuality;
  model_version: string;
  generated_at: string;
}

export type ParlayErrorCode = 'insufficient_candidates' | 'projection_unavailable';

// ---------------------------------------------------------------------------
// Stored predictions
// ---------------------------------------------------------------------------

export type PredictionStatus = 'pending' | 'won' | 'lost' | 'void';

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
}
