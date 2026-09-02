/**
 * Accuracy metrics over settled predictions.
 *
 * Pure. Given records in, figures out — no filesystem, no provider, no clock
 * beyond what is passed in. Every number here is reproducible from the stored
 * history, which is what makes the accuracy claims checkable rather than
 * asserted.
 *
 * Two principles run through all of it:
 *
 *   A percentage always travels with its sample size, and is withheld entirely
 *   below a threshold. "100% (2 of 2)" is not a finding.
 *
 *   Accuracy is never reported alone. A model that only ever backs heavy
 *   favourites posts a fine percentage while being badly calibrated, so Brier
 *   score and the calibration table are reported beside it.
 */

import { boundProbability, brierScore, logLoss } from './math.ts';
import { isCounted, sampleStrength, scoreError } from './tracking.ts';
import type { SampleStrength } from './tracking.ts';
import type { PredictionRecordV2, PredictionStatus } from './types.ts';

/**
 * Below this a rate is not reported at all.
 *
 * Twenty settled predictions gives a figure whose margin of error covers almost
 * any claim, so `accuracy` stays null and only the counts are shown.
 */
export const MIN_REPORTABLE = 20;

export interface AccuracyBlock {
  /** Wins / (wins + losses). Null below MIN_REPORTABLE. */
  accuracy: number | null;
  correct: number;
  incorrect: number;
  /** Denominator of the accuracy figure. */
  settled: number;
  pending: number;
  live: number;
  push: number;
  void: number;
  unsettled: number;
  /** Mean probability claimed, for comparison against the actual rate. */
  mean_probability: number | null;
  brier: number | null;
  log_loss: number | null;
  sample: SampleStrength;
}

function count(records: readonly PredictionRecordV2[], status: PredictionStatus): number {
  return records.filter((record) => record.status === status).length;
}

/**
 * Headline accuracy over a set of predictions.
 *
 * The denominator is wins plus losses. Pending, live, push, void and unsettled
 * are all excluded — a game that has not finished is not a failed prediction,
 * and neither is one that could not fairly be judged.
 */
export function accuracyOf(records: readonly PredictionRecordV2[]): AccuracyBlock {
  const counted = records.filter(isCounted);
  const correct = counted.filter((record) => record.status === 'won').length;
  const settled = counted.length;

  const base: AccuracyBlock = {
    accuracy: null,
    correct,
    incorrect: settled - correct,
    settled,
    pending: count(records, 'pending'),
    live: count(records, 'live'),
    push: count(records, 'push'),
    void: count(records, 'void'),
    unsettled: count(records, 'unsettled'),
    mean_probability: null,
    brier: null,
    log_loss: null,
    sample: sampleStrength(settled),
  };

  if (settled === 0) return base;

  const brier =
    counted.reduce(
      (sum, record) => sum + brierScore(record.model_probability, record.status === 'won'),
      0,
    ) / settled;

  const loss =
    counted.reduce(
      (sum, record) => sum + logLoss(record.model_probability, record.status === 'won'),
      0,
    ) / settled;

  return {
    ...base,
    // Withheld below the threshold; the counts are still shown, and the scoring
    // rules below are informative at smaller n than a bare percentage.
    accuracy: settled >= MIN_REPORTABLE ? round(correct / settled, 4) : null,
    mean_probability: round(
      counted.reduce((sum, r) => sum + r.model_probability, 0) / settled,
      4,
    ),
    brier: round(brier, 4),
    log_loss: round(loss, 4),
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Grouped breakdowns
// ---------------------------------------------------------------------------

export interface GroupedAccuracy extends AccuracyBlock {
  key: string;
  label: string;
}

/**
 * Accuracy split by a field.
 *
 * Groups are returned even when small, with their sample strength attached, so
 * a caller can show "n = 4, small sample" rather than silently dropping a
 * category and making coverage look better than it is.
 */
export function groupBy(
  records: readonly PredictionRecordV2[],
  key: (record: PredictionRecordV2) => string | null,
  label: (key: string) => string = (value) => value,
): GroupedAccuracy[] {
  const groups = new Map<string, PredictionRecordV2[]>();

  for (const record of records) {
    const group = key(record);
    if (group === null) continue;
    const list = groups.get(group);
    if (list) list.push(record);
    else groups.set(group, [record]);
  }

  return [...groups.entries()]
    .map(([group, list]) => ({ key: group, label: label(group), ...accuracyOf(list) }))
    .sort((a, b) => b.settled - a.settled);
}

/** Probability bands, for the confidence and data-quality breakdowns. */
function band(value: number): string {
  if (value >= 0.75) return 'high';
  if (value >= 0.5) return 'medium';
  return 'low';
}

export function byConfidence(records: readonly PredictionRecordV2[]): GroupedAccuracy[] {
  return groupBy(records, (record) => band(record.model_confidence));
}

export function byDataQuality(records: readonly PredictionRecordV2[]): GroupedAccuracy[] {
  return groupBy(records, (record) => band(record.data_quality));
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

export interface CalibrationBand {
  label: string;
  from: number;
  to: number;
  predictions: number;
  won: number;
  /** Mean probability claimed in this band. */
  predicted: number | null;
  /** Share that actually came in. Null below the reporting threshold. */
  actual: number | null;
  /** actual - predicted. Negative means the model was over-confident. */
  difference: number | null;
  sample: SampleStrength;
}

const BANDS: [number, number, string][] = [
  [0.0, 0.5, 'Under 50%'],
  [0.5, 0.6, '50-59%'],
  [0.6, 0.7, '60-69%'],
  [0.7, 0.8, '70-79%'],
  [0.8, 0.9, '80-89%'],
  [0.9, 1.01, '90%+'],
];

/** A band needs at least this many before its rate says anything. */
const MIN_BAND = 10;

/**
 * Is the model's stated probability honest?
 *
 * Of the predictions rated 70–79%, roughly 75% should come in. This is the
 * single most useful diagnostic here: accuracy says whether the model picks
 * winners, calibration says whether its numbers mean what they claim.
 */
export function calibrationTable(
  records: readonly PredictionRecordV2[],
): CalibrationBand[] {
  const counted = records.filter(isCounted);

  return BANDS.map(([from, to, label]) => {
    const inBand = counted.filter(
      (record) =>
        record.model_probability >= from && record.model_probability < to,
    );
    const won = inBand.filter((record) => record.status === 'won').length;

    const predicted =
      inBand.length > 0
        ? round(inBand.reduce((sum, r) => sum + r.model_probability, 0) / inBand.length, 4)
        : null;
    const actual = inBand.length >= MIN_BAND ? round(won / inBand.length, 4) : null;

    return {
      label,
      from,
      to,
      predictions: inBand.length,
      won,
      predicted,
      actual,
      difference: actual !== null && predicted !== null ? round(actual - predicted, 4) : null,
      sample: sampleStrength(inBand.length),
    };
  });
}

/**
 * Multiclass Brier score for a three-way market.
 *
 * A football result is home / draw / away, and squeezing that into a binary
 * score misreports it: a model that said 40/35/25 and saw a draw is not simply
 * "wrong". This is the standard sum of squared errors across all three
 * outcomes, so a confident miss is penalised across every class.
 *
 * Ranges 0 (perfect) to 2 (maximally wrong), unlike the binary form's 0 to 1.
 */
export function multiclassBrier(
  probabilities: readonly number[],
  actualIndex: number,
): number {
  const total = probabilities.reduce((sum, p) => sum + Math.max(p, 0), 0);
  if (total <= 0) return 2;

  return round(
    probabilities.reduce((sum, p, index) => {
      const normalised = Math.max(p, 0) / total;
      const outcome = index === actualIndex ? 1 : 0;
      return sum + (normalised - outcome) ** 2;
    }, 0),
    4,
  );
}

// ---------------------------------------------------------------------------
// Score accuracy
// ---------------------------------------------------------------------------

export interface ScoreAccuracy {
  /** Fixtures where both a projection and a real score exist. */
  sample: number;
  home_mae: number | null;
  away_mae: number | null;
  /** Home error plus away error, per fixture. */
  combined_mae: number | null;
  margin_mae: number | null;
  total_mae: number | null;
  strength: SampleStrength;
}

/**
 * How close the projected scorelines were.
 *
 * Mean absolute error, which is in the sport's own units — 3.8 points, 0.6
 * goals — and so is directly interpretable, unlike a squared measure.
 *
 * Deliberately computed only over fixtures that have both halves. A missing
 * actual score contributes nothing rather than a zero, which would flatter the
 * figure.
 */
export function scoreAccuracy(records: readonly PredictionRecordV2[]): ScoreAccuracy {
  const errors = records
    .map((record) => scoreError(record))
    .filter((error): error is NonNullable<typeof error> => error !== null);

  if (errors.length === 0) {
    return {
      sample: 0,
      home_mae: null,
      away_mae: null,
      combined_mae: null,
      margin_mae: null,
      total_mae: null,
      strength: 'small',
    };
  }

  const mean = (pick: (e: (typeof errors)[number]) => number) =>
    round(errors.reduce((sum, error) => sum + pick(error), 0) / errors.length, 3);

  return {
    sample: errors.length,
    home_mae: mean((e) => e.home),
    away_mae: mean((e) => e.away),
    combined_mae: mean((e) => e.home + e.away),
    margin_mae: mean((e) => e.margin),
    total_mae: mean((e) => e.total),
    strength: sampleStrength(errors.length),
  };
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

export interface TrendPoint {
  /** ISO date of the bucket start. */
  from: string;
  to: string;
  settled: number;
  correct: number;
  accuracy: number | null;
}

/**
 * Accuracy in consecutive windows, most recent last.
 *
 * Buckets by settlement time rather than creation, because a prediction only
 * becomes evidence when it settles.
 */
export function trend(
  records: readonly PredictionRecordV2[],
  now: number,
  buckets = 4,
  bucketDays = 7,
): TrendPoint[] {
  const counted = records.filter(isCounted);
  const span = bucketDays * 86_400_000;
  const points: TrendPoint[] = [];

  for (let index = buckets - 1; index >= 0; index -= 1) {
    const end = now - index * span;
    const start = end - span;

    const inBucket = counted.filter((record) => {
      if (!record.settled_at) return false;
      const settled = Date.parse(record.settled_at);
      return Number.isFinite(settled) && settled > start && settled <= end;
    });

    const correct = inBucket.filter((record) => record.status === 'won').length;

    points.push({
      from: new Date(start).toISOString().slice(0, 10),
      to: new Date(end).toISOString().slice(0, 10),
      settled: inBucket.length,
      correct,
      // Per-bucket samples are small by nature, so the threshold is lower here
      // than for a headline figure — and the count is always shown beside it.
      accuracy: inBucket.length >= 5 ? round(correct / inBucket.length, 4) : null,
    });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Risk ordering
// ---------------------------------------------------------------------------

export interface RiskCheck {
  ordered: boolean;
  /** Null while any level lacks a reportable sample. */
  message: string | null;
}

/**
 * Does the risk system actually behave as advertised?
 *
 * Low should settle above Medium, and Medium above High. If it does not over a
 * reportable sample, that is reported rather than quietly smoothed over — the
 * point of measuring is to find out when something is wrong.
 */
export function riskOrdering(groups: readonly GroupedAccuracy[]): RiskCheck {
  const rate = (key: string) => groups.find((group) => group.key === key)?.accuracy ?? null;

  const low = rate('low');
  const medium = rate('medium');
  const high = rate('high');

  if (low === null || medium === null || high === null) {
    return { ordered: true, message: null };
  }

  const problems: string[] = [];
  if (low < medium) problems.push('low risk is settling below medium');
  if (medium < high) problems.push('medium risk is settling below high');

  return {
    ordered: problems.length === 0,
    message: problems.length > 0 ? problems.join('; ') : null,
  };
}
