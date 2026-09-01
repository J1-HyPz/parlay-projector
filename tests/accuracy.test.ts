import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateAccuracy,
  isPredictionRecord,
  isSettled,
  resolveRange,
} from '../lib/home/predictions/accuracy.ts';
import type { PredictionRecord, PredictionResult } from '../lib/home/predictions/accuracy.ts';

function record(
  result: PredictionResult,
  overrides: Partial<PredictionRecord> = {},
): PredictionRecord {
  return {
    id: `p-${Math.random().toString(36).slice(2)}`,
    game_id: 'g-1',
    sport: 'football',
    predicted_outcome: 'home',
    actual_outcome: result === 'pending' ? null : 'home',
    prediction_result: result,
    created_at: '2026-08-01T00:00:00.000Z',
    settled_at: result === 'correct' || result === 'incorrect' ? '2026-08-02T00:00:00.000Z' : null,
    ...overrides,
  };
}

describe('accuracy calculation', () => {
  it('is correct / settled as a percentage', () => {
    const summary = calculateAccuracy([
      ...Array.from({ length: 3 }, () => record('correct')),
      record('incorrect'),
    ]);
    assert.equal(summary.correct, 3);
    assert.equal(summary.incorrect, 1);
    assert.equal(summary.settled, 4);
    assert.equal(summary.accuracy, 75);
  });

  it('rounds to one decimal place', () => {
    const summary = calculateAccuracy([
      record('correct'),
      record('correct'),
      record('incorrect'),
    ]);
    assert.equal(summary.accuracy, 66.7);
  });

  it('returns null accuracy when nothing has settled', () => {
    const summary = calculateAccuracy([]);
    assert.equal(summary.accuracy, null);
    assert.equal(summary.correct, 0);
    assert.equal(summary.incorrect, 0);
    assert.equal(summary.settled, 0);
  });

  it('excludes pending predictions', () => {
    const summary = calculateAccuracy([
      record('correct'),
      record('pending'),
      record('pending'),
    ]);
    assert.equal(summary.settled, 1);
    assert.equal(summary.accuracy, 100);
  });

  it('excludes void predictions', () => {
    const summary = calculateAccuracy([
      record('correct'),
      record('incorrect'),
      record('void'),
      record('void'),
    ]);
    assert.equal(summary.settled, 2);
    assert.equal(summary.accuracy, 50);
  });

  it('returns the empty state when only pending and void records exist', () => {
    const summary = calculateAccuracy([record('pending'), record('void')]);
    assert.equal(summary.accuracy, null);
    assert.equal(summary.settled, 0);
  });

  it('excludes records with no settled_at timestamp', () => {
    const summary = calculateAccuracy([record('correct', { settled_at: null })]);
    assert.equal(summary.settled, 0);
    assert.equal(summary.accuracy, null);
  });

  it('ignores malformed records rather than throwing', () => {
    const summary = calculateAccuracy([
      record('correct'),
      null,
      undefined,
      42,
      'nonsense',
      {},
      { id: 'x', game_id: 'y', prediction_result: 'bogus' },
    ]);
    assert.equal(summary.settled, 1);
    assert.equal(summary.accuracy, 100);
  });
});

describe('accuracy ranges', () => {
  const now = new Date('2026-09-01T00:00:00.000Z');

  it('all-time counts everything settled', () => {
    const summary = calculateAccuracy(
      [
        record('correct', { settled_at: '2020-01-01T00:00:00.000Z' }),
        record('correct', { settled_at: '2026-08-30T00:00:00.000Z' }),
      ],
      'all-time',
      now,
    );
    assert.equal(summary.settled, 2);
    assert.equal(summary.range, 'all-time');
  });

  it('30d excludes older settlements', () => {
    const summary = calculateAccuracy(
      [
        record('correct', { settled_at: '2020-01-01T00:00:00.000Z' }),
        record('correct', { settled_at: '2026-08-30T00:00:00.000Z' }),
        record('incorrect', { settled_at: '2026-08-20T00:00:00.000Z' }),
      ],
      '30d',
      now,
    );
    assert.equal(summary.settled, 2);
    assert.equal(summary.correct, 1);
    assert.equal(summary.incorrect, 1);
    assert.equal(summary.range, '30d');
  });

  it('parses the range query parameter safely', () => {
    assert.equal(resolveRange('30d'), '30d');
    assert.equal(resolveRange('all-time'), 'all-time');
    assert.equal(resolveRange(null), 'all-time');
    assert.equal(resolveRange('; DROP TABLE'), 'all-time');
  });
});

describe('record validation', () => {
  it('accepts a well-formed record', () => {
    assert.equal(isPredictionRecord(record('correct')), true);
  });

  it('rejects anything else', () => {
    assert.equal(isPredictionRecord(null), false);
    assert.equal(isPredictionRecord({}), false);
    assert.equal(isPredictionRecord({ id: 'a', game_id: 'b', prediction_result: 'nope' }), false);
  });

  it('only counts correct/incorrect with a settled timestamp as settled', () => {
    assert.equal(isSettled(record('correct')), true);
    assert.equal(isSettled(record('incorrect')), true);
    assert.equal(isSettled(record('pending')), false);
    assert.equal(isSettled(record('void')), false);
  });
});
