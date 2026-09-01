/**
 * Pure accuracy calculation over stored prediction records.
 *
 * This module evaluates predictions that already exist. It does not generate
 * them — no prediction engine is part of this work.
 *
 * Only type-only imports are used here, so the module has no runtime imports.
 */

import type { AccuracyRange, AccuracySummary } from '../types';

/** Outcome of a prediction once the real result is known. */
export type PredictionResult = 'correct' | 'incorrect' | 'pending' | 'void';

export interface PredictionRecord {
  id: string;
  game_id: string;
  sport: string;
  predicted_outcome: string;
  actual_outcome: string | null;
  prediction_result: PredictionResult;
  created_at: string;
  /** ISO-8601 instant the prediction was settled; null while pending. */
  settled_at: string | null;
}

const VALID_RESULTS: readonly PredictionResult[] = [
  'correct',
  'incorrect',
  'pending',
  'void',
];

/**
 * Validate one stored record.
 *
 * The store is a file that something else will eventually write, so records are
 * treated as untrusted input rather than assumed well-formed.
 */
export function isPredictionRecord(value: unknown): value is PredictionRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.game_id === 'string' &&
    typeof record.prediction_result === 'string' &&
    (VALID_RESULTS as readonly string[]).includes(record.prediction_result)
  );
}

/**
 * A prediction counts toward accuracy only when the real result is known.
 *
 * Excluded: `pending` (game not finished), `void` (cancelled or postponed and
 * never played), and anything without a `settled_at` timestamp.
 */
export function isSettled(record: PredictionRecord): boolean {
  if (record.prediction_result !== 'correct' && record.prediction_result !== 'incorrect') {
    return false;
  }
  return typeof record.settled_at === 'string' && record.settled_at.length > 0;
}

/** Whether a settled record falls inside the requested window. */
export function withinRange(
  record: PredictionRecord,
  range: AccuracyRange,
  now: Date = new Date(),
): boolean {
  if (range === 'all-time') return true;
  if (!record.settled_at) return false;

  const settledAt = new Date(record.settled_at);
  if (Number.isNaN(settledAt.getTime())) return false;

  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return now.getTime() - settledAt.getTime() <= thirtyDaysMs;
}

/**
 * Accuracy = correct settled / total settled × 100.
 *
 * Returns `accuracy: null` when nothing has settled — the homepage shows `--%`
 * rather than a fabricated figure.
 */
export function calculateAccuracy(
  records: readonly unknown[],
  range: AccuracyRange = 'all-time',
  now: Date = new Date(),
): AccuracySummary {
  let correct = 0;
  let incorrect = 0;

  for (const candidate of records) {
    if (!isPredictionRecord(candidate)) continue;
    if (!isSettled(candidate)) continue;
    if (!withinRange(candidate, range, now)) continue;

    if (candidate.prediction_result === 'correct') correct += 1;
    else incorrect += 1;
  }

  const settled = correct + incorrect;

  return {
    accuracy: settled === 0 ? null : roundTo((correct / settled) * 100, 1),
    correct,
    incorrect,
    settled,
    range,
  };
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Parse an `?range=` query value; anything unrecognised falls back to all-time. */
export function resolveRange(raw: string | null | undefined): AccuracyRange {
  return raw?.trim() === '30d' ? '30d' : 'all-time';
}
