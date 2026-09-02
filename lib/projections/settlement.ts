/**
 * Settling published predictions, and measuring the model.
 *
 * Pure. Settlement compares a stored settlement rule against a final score —
 * nothing is recomputed, and no information that arrived after the prediction
 * was published is consulted. The rule and the probability are frozen at
 * publication, which is the whole reason the accuracy figures mean anything.
 */

import { brierScore, logLoss } from './math.ts';
import type { PredictionRecordV2, PredictionStatus, SettlementRule } from './types.ts';

export interface FinalScore {
  home: number;
  away: number;
  /** Normalised status of the completed game. */
  status: 'finished' | 'cancelled' | 'postponed';
}

/**
 * Did the selection come in?
 *
 * A cancelled or postponed game voids rather than loses: the projection was
 * never tested, and counting it as a miss would understate the model as surely
 * as counting it as a hit would flatter it.
 */
export function settle(rule: SettlementRule, final: FinalScore): PredictionStatus {
  if (final.status !== 'finished') return 'void';

  const margin = final.home - final.away;
  const total = final.home + final.away;

  switch (rule.kind) {
    case 'winner': {
      const actual = margin > 0 ? 'home' : margin < 0 ? 'away' : 'draw';
      return actual === rule.side ? 'won' : 'lost';
    }

    case 'double_chance': {
      const actual = margin > 0 ? 'home' : margin < 0 ? 'away' : 'draw';
      return rule.sides.includes(actual) ? 'won' : 'lost';
    }

    case 'spread': {
      // Lines are always half points, so a push cannot occur; the equality
      // case is handled anyway rather than left to chance.
      const adjusted = rule.side === 'home' ? margin + rule.line : -margin + rule.line;
      if (adjusted === 0) return 'void';
      return adjusted > 0 ? 'won' : 'lost';
    }

    case 'total': {
      if (total === rule.line) return 'void';
      const over = total > rule.line;
      return (rule.direction === 'over') === over ? 'won' : 'lost';
    }

    case 'team_total': {
      const scored = rule.side === 'home' ? final.home : final.away;
      if (scored === rule.line) return 'void';
      const over = scored > rule.line;
      return (rule.direction === 'over') === over ? 'won' : 'lost';
    }

    default:
      return 'void';
  }
}

/** Plain description of what happened, stored alongside the outcome. */
export function describeResult(final: FinalScore): string {
  if (final.status !== 'finished') return final.status === 'cancelled' ? 'Cancelled' : 'Postponed';
  return `${final.home}-${final.away}`;
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export interface ModelMetrics {
  settled: number;
  won: number;
  lost: number;
  void: number;
  /** Share of settled predictions that came in, 0..1. Null below the minimum. */
  accuracy: number | null;
  /** Mean Brier score. Lower is better; 0.25 is what always saying 50% earns. */
  brier: number | null;
  /** Mean log loss. Punishes confident misses far harder than Brier. */
  log_loss: number | null;
  /** Mean probability the model assigned, for comparison against accuracy. */
  mean_probability: number | null;
}

/**
 * Below this, a percentage is noise dressed as a finding.
 *
 * Twenty settled predictions gives an accuracy figure with a margin of error
 * wide enough to cover almost any claim, so nothing is reported until then.
 */
export const MIN_SAMPLE = 20;

function settledOnly(records: readonly PredictionRecordV2[]): PredictionRecordV2[] {
  return records.filter((record) => record.status === 'won' || record.status === 'lost');
}

export function calculateMetrics(records: readonly PredictionRecordV2[]): ModelMetrics {
  const settled = settledOnly(records);
  const won = settled.filter((record) => record.status === 'won').length;
  const voided = records.filter((record) => record.status === 'void').length;

  if (settled.length === 0) {
    return {
      settled: 0,
      won: 0,
      lost: 0,
      void: voided,
      accuracy: null,
      brier: null,
      log_loss: null,
      mean_probability: null,
    };
  }

  const brier =
    settled.reduce(
      (sum, record) => sum + brierScore(record.model_probability, record.status === 'won'),
      0,
    ) / settled.length;

  const loss =
    settled.reduce(
      (sum, record) => sum + logLoss(record.model_probability, record.status === 'won'),
      0,
    ) / settled.length;

  return {
    settled: settled.length,
    won,
    lost: settled.length - won,
    void: voided,
    // Accuracy is withheld below the minimum sample, but the scoring rules are
    // reported: they are informative at smaller n than a bare percentage.
    accuracy: settled.length >= MIN_SAMPLE ? won / settled.length : null,
    brier: Number(brier.toFixed(4)),
    log_loss: Number(loss.toFixed(4)),
    mean_probability: Number(
      (settled.reduce((sum, r) => sum + r.model_probability, 0) / settled.length).toFixed(4),
    ),
  };
}

export interface CalibrationBucket {
  /** Inclusive lower bound, e.g. 0.7 for the 70–79% band. */
  from: number;
  to: number;
  label: string;
  predictions: number;
  won: number;
  /** Observed success rate, or null below a usable count. */
  actual: number | null;
  /** Mean probability the model assigned in this band. */
  expected: number | null;
}

const BANDS: [number, number, string][] = [
  [0.0, 0.5, 'Under 50%'],
  [0.5, 0.6, '50-59%'],
  [0.6, 0.7, '60-69%'],
  [0.7, 0.8, '70-79%'],
  [0.8, 0.9, '80-89%'],
  [0.9, 1.01, '90%+'],
];

/** A bucket needs at least this many before its rate says anything. */
const MIN_BUCKET = 10;

/**
 * Calibration: of the predictions rated 70–79%, how many actually came in?
 *
 * More useful than accuracy alone. A model that only ever backs heavy
 * favourites can post a high percentage correct while being badly calibrated,
 * and this is what exposes that.
 */
export function calibration(records: readonly PredictionRecordV2[]): CalibrationBucket[] {
  const settled = settledOnly(records);

  return BANDS.map(([from, to, label]) => {
    const inBand = settled.filter(
      (record) => record.model_probability >= from && record.model_probability < to,
    );
    const won = inBand.filter((record) => record.status === 'won').length;

    return {
      from,
      to,
      label,
      predictions: inBand.length,
      won,
      actual: inBand.length >= MIN_BUCKET ? Number((won / inBand.length).toFixed(3)) : null,
      expected:
        inBand.length > 0
          ? Number(
              (
                inBand.reduce((sum, r) => sum + r.model_probability, 0) / inBand.length
              ).toFixed(3),
            )
          : null,
    };
  });
}

/** Metrics split by a field, for "NFL winner predictions: 71%" style reporting. */
export function metricsBy(
  records: readonly PredictionRecordV2[],
  key: (record: PredictionRecordV2) => string,
): Record<string, ModelMetrics> {
  const groups = new Map<string, PredictionRecordV2[]>();

  for (const record of records) {
    const group = key(record);
    const list = groups.get(group);
    if (list) list.push(record);
    else groups.set(group, [record]);
  }

  const result: Record<string, ModelMetrics> = {};
  for (const [group, list] of groups) result[group] = calculateMetrics(list);
  return result;
}
