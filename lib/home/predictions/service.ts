/**
 * Accuracy service — reads stored predictions and reports how they scored.
 *
 * Reading only. Prediction generation is a future task; if the store is empty
 * this returns the empty state rather than inventing history.
 */

import { logger } from '../../logger';
import type { AccuracyRange, AccuracySummary } from '../types';
import { calculateAccuracy } from './accuracy';
import {
  createFilePredictionRepository,
  createProjectionPredictionRepository,
} from './repository';
import type { PredictionRepository } from './repository';

/**
 * Both stores feed one accuracy figure.
 *
 * The projection engine publishes to its own richer store; the original file
 * store predates it and may still hold records. There is deliberately no second
 * accuracy system — the homepage widget reports on everything published.
 */
const repositories: PredictionRepository[] = [
  createProjectionPredictionRepository(),
  createFilePredictionRepository(),
];

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
    const collected = await Promise.all(
      repositories.map(async (store) => {
        try {
          return await store.all();
        } catch {
          // One store failing must not zero the figure the other supports.
          return [];
        }
      }),
    );
    const records = collected.flat();
    const summary = calculateAccuracy(records, range);

    logger.info('homepage_accuracy_calculated', {
      stores: repositories.map((store) => store.name),
      range,
      settled: summary.settled,
      accuracy: summary.accuracy,
    });

    return { summary, failed: false };
  } catch (error) {
    logger.error('homepage_accuracy_failed', {
      stores: repositories.map((store) => store.name),
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { summary: EMPTY(range), failed: true };
  }
}
