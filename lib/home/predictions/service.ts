/**
 * Accuracy service — reads stored predictions and reports how they scored.
 *
 * Reading only. Prediction generation is a future task; if the store is empty
 * this returns the empty state rather than inventing history.
 */

import { logger } from '../../logger';
import type { AccuracyRange, AccuracySummary } from '../types';
import { calculateAccuracy } from './accuracy';
import { createFilePredictionRepository } from './repository';
import type { PredictionRepository } from './repository';

// The one place the concrete store is chosen.
const repository: PredictionRepository = createFilePredictionRepository();

export interface AccuracyResult {
  summary: AccuracySummary;
  failed: boolean;
}

const EMPTY = (range: AccuracyRange): AccuracySummary => ({
  accuracy: null,
  correct: 0,
  incorrect: 0,
  settled: 0,
  range,
});

export async function getAccuracy(
  range: AccuracyRange = 'all-time',
): Promise<AccuracyResult> {
  try {
    const records = await repository.all();
    const summary = calculateAccuracy(records, range);

    logger.info('homepage_accuracy_calculated', {
      store: repository.name,
      range,
      settled: summary.settled,
      accuracy: summary.accuracy,
    });

    return { summary, failed: false };
  } catch (error) {
    logger.error('homepage_accuracy_failed', {
      store: repository.name,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { summary: EMPTY(range), failed: true };
  }
}
