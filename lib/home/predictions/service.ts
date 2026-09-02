/**
 * Homepage accuracy — a thin adapter over the accuracy service.
 *
 * The homepage does not calculate anything itself. It asks the one service that
 * owns every accuracy figure in the application, so the widget and the detailed
 * breakdowns are guaranteed to be the same numbers.
 *
 * Reads settled local history only; no provider is involved.
 */

import { logger } from '../../logger';
import { getAccuracyReport } from '../../projections/accuracy';
import type { AccuracyWindow } from '../../projections/accuracy';
import type { AccuracyRange, AccuracySummary } from '../types';

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

/** The homepage's two ranges map onto the service's windows. */
function windowFor(range: AccuracyRange): AccuracyWindow {
  return range === '30d' ? '30d' : 'all-time';
}

/**
 * Accuracy for the homepage widget.
 *
 * The figure is wins / (wins + losses) over *official pre-game predictions that
 * were actually shown to a reader*. Pending predictions are never counted as
 * incorrect, and nothing is fabricated when the history is empty — the widget
 * shows `--%` instead.
 */
export async function getAccuracy(
  range: AccuracyRange = 'all-time',
): Promise<AccuracyResult> {
  try {
    const report = await getAccuracyReport(windowFor(range));
    const { overall } = report;

    logger.info('homepage_accuracy_calculated', {
      range,
      settled: overall.settled,
      accuracy: overall.accuracy,
      pending: overall.pending,
    });

    return {
      summary: {
        accuracy: overall.accuracy,
        correct: overall.correct,
        incorrect: overall.incorrect,
        settled: overall.settled,
        range,
      },
      failed: false,
    };
  } catch (error) {
    logger.error('homepage_accuracy_failed', {
      range,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { summary: EMPTY(range), failed: true };
  }
}
