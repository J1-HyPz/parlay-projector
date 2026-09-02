import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FINALISATION_HOURS,
  actualOutcome,
  applyParlayStatus,
  isAbandoned,
  isCorrectable,
  isCounted,
  isDue,
  markFinalPreGame,
  nextAttemptAt,
  parlayProgress,
  parlayStatus,
  sampleStrength,
  scoreError,
  settlementQueue,
  queuedGameIds,
} from '../lib/projections/tracking.ts';
import {
  MIN_REPORTABLE,
  accuracyOf,
  byConfidence,
  calibrationTable,
  groupBy,
  multiclassBrier,
  riskOrdering,
  scoreAccuracy,
  trend,
} from '../lib/projections/metrics.ts';
import { parseParlays } from '../lib/projections/parlay-parse.ts';
import { parsePredictions } from '../lib/projections/store-parse.ts';
import type {
  ParlayRecord,
  PredictionRecordV2,
  PredictionStatus,
} from '../lib/projections/types.ts';

const NOW = Date.parse('2026-09-10T20:00:00.000Z');
const KICKOFF = '2026-09-10T19:00:00.000Z';

function record(overrides: Partial<PredictionRecordV2> = {}): PredictionRecordV2 {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    game_id: 'g1',
    sport: 'football',
    league: 'Premier League',
    selection_type: 'winner',
    selection: 'Arsenal to win',
    settlement: { kind: 'winner', side: 'home' },
    model_probability: 0.68,
    model_confidence: 0.8,
    data_quality: 0.8,
    model_version: 'projection-v1',
    risk: 'low',
    created_at: '2026-09-10T09:00:00.000Z',
    game_start: KICKOFF,
    status: 'pending',
    result: null,
    settled_at: null,
    final_pre_game: true,
    parlay_id: 'low:a|b',
    projected: { home_score: 2.1, away_score: 1.0, margin: 1.1, total: 3.1 },
    actual: null,
    attempts: 0,
    next_attempt_at: null,
    audit: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

describe('prediction lifecycle', () => {
  it('counts only won and lost toward accuracy', () => {
    for (const status of ['won', 'lost'] as PredictionStatus[]) {
      assert.equal(isCounted(record({ status })), true, status);
    }
    for (const status of ['pending', 'live', 'push', 'void', 'unsettled'] as PredictionStatus[]) {
      assert.equal(isCounted(record({ status })), false, status);
    }
  });

  it('backs off between retries and then stops', () => {
    // A statistic that never arrives must not be retried for ever.
    let previous = -1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const at = nextAttemptAt(attempt, NOW);
      assert.ok(at, `attempt ${attempt} should schedule a retry`);
      const delay = Date.parse(at) - NOW;
      assert.ok(delay > previous, 'each gap should widen');
      previous = delay;
    }
    assert.equal(nextAttemptAt(5, NOW), null, 'retries are exhausted');
  });

  it('waits until a retry is due', () => {
    const soon = record({
      status: 'unsettled',
      next_attempt_at: new Date(NOW + 60_000).toISOString(),
    });
    assert.equal(isDue(soon, NOW), false);
    assert.equal(isDue(soon, NOW + 120_000), true);
    assert.equal(isDue(record({ status: 'unsettled' }), NOW), true, 'never attempted');
  });

  it('abandons a prediction past the finalisation window', () => {
    const late = record({
      status: 'unsettled',
      game_start: new Date(NOW - (FINALISATION_HOURS + 1) * 3_600_000).toISOString(),
    });
    assert.equal(isAbandoned(late, NOW), true);
    assert.equal(isAbandoned(record({ status: 'unsettled' }), NOW), false, 'an hour old');
  });

  it('never abandons an already settled prediction', () => {
    const old = record({
      status: 'won',
      game_start: new Date(NOW - 100 * 3_600_000).toISOString(),
    });
    assert.equal(isAbandoned(old, NOW), false);
  });

  it('allows a correction only inside the window', () => {
    assert.equal(isCorrectable(record({ status: 'won' }), NOW), true);
    const old = record({
      status: 'won',
      game_start: new Date(NOW - (FINALISATION_HOURS + 1) * 3_600_000).toISOString(),
    });
    assert.equal(isCorrectable(old, NOW), false, 'history stops moving eventually');
  });
});

describe('the settlement queue', () => {
  it('ignores fixtures that have not kicked off', () => {
    const future = record({ game_start: new Date(NOW + 3_600_000).toISOString() });
    assert.deepEqual(settlementQueue([future], NOW), []);
  });

  it('picks up started, live and retryable predictions', () => {
    const queue = settlementQueue(
      [
        record({ id: 'started', status: 'pending' }),
        record({ id: 'running', status: 'live' }),
        record({ id: 'waiting', status: 'unsettled', attempts: 2 }),
      ],
      NOW,
    );
    assert.deepEqual(
      queue.map((entry) => `${entry.record.id}:${entry.reason}`).sort(),
      ['running:live', 'started:pending', 'waiting:retry'],
    );
  });

  it('re-examines a settled prediction inside the correction window', () => {
    const queue = settlementQueue([record({ id: 'done', status: 'won' })], NOW);
    assert.deepEqual(queue.map((entry) => entry.reason), ['correction']);
  });

  it('leaves old settled predictions alone', () => {
    const old = record({
      status: 'won',
      game_start: new Date(NOW - 100 * 3_600_000).toISOString(),
    });
    assert.deepEqual(settlementQueue([old], NOW), []);
  });

  it('de-duplicates the games it needs', () => {
    const queue = settlementQueue(
      [record({ id: 'a', game_id: 'g1' }), record({ id: 'b', game_id: 'g1' })],
      NOW,
    );
    assert.deepEqual(queuedGameIds(queue), ['g1']);
  });
});

// ---------------------------------------------------------------------------
// Look-ahead protection
// ---------------------------------------------------------------------------

describe('the official pre-game prediction', () => {
  it('picks the last one published before kick-off', () => {
    const marked = markFinalPreGame([
      record({ id: 'morning', created_at: '2026-09-10T09:00:00.000Z' }),
      record({ id: 'afternoon', created_at: '2026-09-10T13:00:00.000Z' }),
      record({ id: 'evening', created_at: '2026-09-10T18:30:00.000Z' }),
    ]);

    const final = marked.filter((r) => r.final_pre_game).map((r) => r.id);
    assert.deepEqual(final, ['evening']);
  });

  it('never marks one created after the whistle', () => {
    // The look-ahead guard: a projection made once the game is under way could
    // have seen the score, so it can never be the official prediction.
    const marked = markFinalPreGame([
      record({ id: 'before', created_at: '2026-09-10T18:00:00.000Z' }),
      record({ id: 'after', created_at: '2026-09-10T19:30:00.000Z' }),
    ]);
    assert.deepEqual(marked.filter((r) => r.final_pre_game).map((r) => r.id), ['before']);
  });

  it('marks nothing when every version came after kick-off', () => {
    const marked = markFinalPreGame([
      record({ id: 'late', created_at: '2026-09-10T21:00:00.000Z' }),
    ]);
    assert.deepEqual(marked.filter((r) => r.final_pre_game), []);
  });

  it('keeps one per game, market and model version', () => {
    const marked = markFinalPreGame([
      record({ id: 'winner-1', selection_type: 'winner', created_at: '2026-09-10T09:00:00.000Z' }),
      record({ id: 'winner-2', selection_type: 'winner', created_at: '2026-09-10T12:00:00.000Z' }),
      record({ id: 'total-1', selection_type: 'total', created_at: '2026-09-10T09:00:00.000Z' }),
      record({ id: 'other-game', game_id: 'g2', created_at: '2026-09-10T09:00:00.000Z' }),
    ]);
    assert.deepEqual(
      marked.filter((r) => r.final_pre_game).map((r) => r.id).sort(),
      ['other-game', 'total-1', 'winner-2'],
    );
  });

  it('ignores a record with no kick-off time', () => {
    const marked = markFinalPreGame([record({ id: 'undated', game_start: null })]);
    assert.deepEqual(marked.filter((r) => r.final_pre_game), []);
  });
});

// ---------------------------------------------------------------------------
// Accuracy
// ---------------------------------------------------------------------------

describe('accuracy', () => {
  const settled = (won: number, lost: number) => [
    ...Array.from({ length: won }, () => record({ status: 'won' })),
    ...Array.from({ length: lost }, () => record({ status: 'lost' })),
  ];

  it('divides wins by wins plus losses', () => {
    const block = accuracyOf(settled(15, 10));
    assert.equal(block.settled, 25);
    assert.equal(block.correct, 15);
    assert.equal(block.incorrect, 10);
    assert.equal(block.accuracy, 0.6);
  });

  it('never counts a pending prediction as incorrect', () => {
    const block = accuracyOf([
      ...settled(15, 5),
      ...Array.from({ length: 30 }, () => record({ status: 'pending' })),
    ]);
    assert.equal(block.settled, 20);
    assert.equal(block.incorrect, 5);
    assert.equal(block.pending, 30);
    assert.equal(block.accuracy, 0.75);
  });

  it('excludes live, push, void and unsettled from the denominator', () => {
    const block = accuracyOf([
      ...settled(18, 2),
      record({ status: 'live' }),
      record({ status: 'push' }),
      record({ status: 'void' }),
      record({ status: 'unsettled' }),
    ]);
    assert.equal(block.settled, 20);
    assert.equal(block.live, 1);
    assert.equal(block.push, 1);
    assert.equal(block.void, 1);
    assert.equal(block.unsettled, 1);
  });

  it('withholds a percentage below the reporting threshold', () => {
    const block = accuracyOf(settled(MIN_REPORTABLE - 6, 5));
    assert.equal(block.accuracy, null, 'a rate from a tiny sample is not a finding');
    assert.equal(block.sample, 'small');
    // The scoring rules are still reported: informative at smaller n.
    assert.ok(block.brier !== null);
  });

  it('reports nothing at all with no settled history', () => {
    const block = accuracyOf([record({ status: 'pending' })]);
    assert.equal(block.accuracy, null);
    assert.equal(block.settled, 0);
    assert.equal(block.brier, null);
    assert.equal(block.mean_probability, null);
  });

  it('is empty rather than NaN for no records', () => {
    const block = accuracyOf([]);
    assert.equal(block.settled, 0);
    assert.equal(block.correct, 0);
    assert.equal(block.accuracy, null);
  });

  it('scores a confident model well and a confidently wrong one badly', () => {
    const good = accuracyOf(
      Array.from({ length: 25 }, () => record({ status: 'won', model_probability: 0.95 })),
    );
    const bad = accuracyOf(
      Array.from({ length: 25 }, () => record({ status: 'lost', model_probability: 0.95 })),
    );
    assert.ok(good.brier! < 0.01);
    assert.ok(bad.brier! > 0.8);
    assert.ok(bad.log_loss! > good.log_loss!);
  });

  it('labels sample strength', () => {
    assert.equal(sampleStrength(5), 'small');
    assert.equal(sampleStrength(50), 'developing');
    assert.equal(sampleStrength(150), 'meaningful');
  });
});

describe('grouped accuracy', () => {
  const mixed = [
    ...Array.from({ length: 12 }, () => record({ sport: 'football', status: 'won' })),
    ...Array.from({ length: 8 }, () => record({ sport: 'football', status: 'lost' })),
    ...Array.from({ length: 3 }, () => record({ sport: 'nfl', status: 'won' })),
  ];

  it('splits by sport and keeps sample sizes', () => {
    const groups = groupBy(mixed, (r) => r.sport);
    const football = groups.find((g) => g.key === 'football')!;
    const nfl = groups.find((g) => g.key === 'nfl')!;

    assert.equal(football.settled, 20);
    assert.equal(football.accuracy, 0.6);
    // Small groups are kept, flagged rather than dropped — hiding them would
    // make coverage look better than it is.
    assert.equal(nfl.settled, 3);
    assert.equal(nfl.accuracy, null);
    assert.equal(nfl.sample, 'small');
  });

  it('bands confidence', () => {
    const groups = byConfidence([
      ...Array.from({ length: 20 }, () => record({ model_confidence: 0.9, status: 'won' })),
      ...Array.from({ length: 20 }, () => record({ model_confidence: 0.4, status: 'lost' })),
    ]);
    assert.equal(groups.find((g) => g.key === 'high')?.accuracy, 1);
    assert.equal(groups.find((g) => g.key === 'low')?.accuracy, 0);
  });

  it('flags a risk system that is the wrong way round', () => {
    const groups = groupBy(
      [
        ...Array.from({ length: 20 }, () => record({ risk: 'low', status: 'lost' })),
        ...Array.from({ length: 20 }, () => record({ risk: 'medium', status: 'won' })),
        ...Array.from({ length: 20 }, () => record({ risk: 'high', status: 'won' })),
      ],
      (r) => r.risk,
    );

    const check = riskOrdering(groups);
    assert.equal(check.ordered, false);
    assert.ok(check.message?.includes('low risk is settling below medium'));
  });

  it('says nothing about ordering without a reportable sample', () => {
    const check = riskOrdering(groupBy([record({ risk: 'low', status: 'won' })], (r) => r.risk));
    assert.equal(check.message, null, 'silence beats a claim from three predictions');
  });
});

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

describe('calibration', () => {
  it('compares claimed probability against what happened', () => {
    const table = calibrationTable(
      Array.from({ length: 12 }, (_, i) =>
        record({ model_probability: 0.75, status: i < 9 ? 'won' : 'lost' }),
      ),
    );

    const band = table.find((entry) => entry.label === '70-79%')!;
    assert.equal(band.predictions, 12);
    assert.equal(band.predicted, 0.75);
    assert.equal(band.actual, 0.75);
    assert.equal(band.difference, 0);
  });

  it('shows over-confidence as a negative difference', () => {
    const table = calibrationTable(
      Array.from({ length: 20 }, (_, i) =>
        record({ model_probability: 0.9, status: i < 14 ? 'won' : 'lost' }),
      ),
    );
    const band = table.find((entry) => entry.label === '90%+')!;
    assert.equal(band.actual, 0.7);
    assert.ok(band.difference! < 0, 'claimed 90%, delivered 70%');
  });

  it('withholds a rate from a thin band', () => {
    const table = calibrationTable([record({ model_probability: 0.75, status: 'won' })]);
    assert.equal(table.find((entry) => entry.label === '70-79%')?.actual, null);
  });

  it('returns every band, even empty ones', () => {
    assert.equal(calibrationTable([]).length, 6);
  });

  it('scores a three-way market across all outcomes', () => {
    // A football result is home / draw / away; forcing it into a binary score
    // misreports what the model actually claimed.
    const confidentRight = multiclassBrier([0.8, 0.15, 0.05], 0);
    const confidentWrong = multiclassBrier([0.8, 0.15, 0.05], 2);
    const uncertain = multiclassBrier([0.34, 0.33, 0.33], 0);

    assert.ok(confidentRight < uncertain);
    assert.ok(uncertain < confidentWrong);
    assert.ok(confidentWrong <= 2, 'the multiclass form ranges 0 to 2');
  });

  it('normalises probabilities that do not sum to one', () => {
    assert.equal(multiclassBrier([2, 1, 1], 0), multiclassBrier([0.5, 0.25, 0.25], 0));
  });
});

// ---------------------------------------------------------------------------
// Score accuracy
// ---------------------------------------------------------------------------

describe('score accuracy', () => {
  it('measures error against the projection published', () => {
    const settled = record({
      status: 'won',
      projected: { home_score: 2.1, away_score: 1.0, margin: 1.1, total: 3.1 },
      actual: actualOutcome(2, 1),
    });

    const error = scoreError(settled)!;
    assert.ok(Math.abs(error.home - 0.1) < 1e-9);
    assert.ok(Math.abs(error.away - 0) < 1e-9);
    assert.ok(Math.abs(error.margin - 0.1) < 1e-9);
    assert.ok(Math.abs(error.total - 0.1) < 1e-9);
  });

  it('reports mean absolute error', () => {
    const accuracy = scoreAccuracy([
      record({
        status: 'won',
        projected: { home_score: 27, away_score: 24, margin: 3, total: 51 },
        actual: actualOutcome(24, 21),
      }),
      record({
        status: 'lost',
        projected: { home_score: 20, away_score: 20, margin: 0, total: 40 },
        actual: actualOutcome(21, 17),
      }),
    ]);

    assert.equal(accuracy.sample, 2);
    assert.equal(accuracy.home_mae, 2);
    assert.equal(accuracy.away_mae, 3);
    assert.equal(accuracy.combined_mae, 5);
    // Margins: projected 3 against actual 3, then projected 0 against actual 4.
    assert.equal(accuracy.margin_mae, 2);
  });

  it('ignores predictions with no actual score rather than scoring them zero', () => {
    const accuracy = scoreAccuracy([
      record({ status: 'pending' }),
      record({
        status: 'won',
        projected: { home_score: 2, away_score: 1, margin: 1, total: 3 },
        actual: actualOutcome(2, 1),
      }),
    ]);
    assert.equal(accuracy.sample, 1, 'a missing actual must not flatter the figure');
  });

  it('produces no NaN or negative sample from an empty set', () => {
    const accuracy = scoreAccuracy([]);
    assert.equal(accuracy.sample, 0);
    assert.equal(accuracy.home_mae, null);
    assert.equal(accuracy.margin_mae, null);
    assert.equal(accuracy.total_mae, null);
  });
});

describe('trend', () => {
  it('buckets by settlement time, most recent last', () => {
    const points = trend(
      [
        record({ status: 'won', settled_at: new Date(NOW - 2 * 86_400_000).toISOString() }),
        record({ status: 'lost', settled_at: new Date(NOW - 20 * 86_400_000).toISOString() }),
      ],
      NOW,
    );
    assert.equal(points.length, 4);
    assert.equal(points[points.length - 1].settled, 1);
  });

  it('withholds a rate from a tiny bucket', () => {
    const points = trend([record({ status: 'won', settled_at: new Date(NOW).toISOString() })], NOW);
    assert.equal(points[points.length - 1].accuracy, null);
  });
});

// ---------------------------------------------------------------------------
// Parlays
// ---------------------------------------------------------------------------

describe('parlay tracking', () => {
  const leg = (status: PredictionStatus) => record({ status });

  it('wins only when every counting leg won', () => {
    assert.equal(parlayStatus([leg('won'), leg('won'), leg('won')]), 'won');
  });

  it('loses as soon as one leg loses', () => {
    // Even with legs still running: the line is gone.
    assert.equal(parlayStatus([leg('won'), leg('lost'), leg('live')]), 'lost');
  });

  it('is live while a leg is under way', () => {
    assert.equal(parlayStatus([leg('won'), leg('live'), leg('pending')]), 'live');
  });

  it('is pending before anything starts', () => {
    assert.equal(parlayStatus([leg('pending'), leg('pending')]), 'pending');
  });

  it('ignores void and push legs rather than failing the line', () => {
    assert.equal(parlayStatus([leg('won'), leg('void'), leg('won')]), 'won');
    assert.equal(parlayStatus([leg('won'), leg('push')]), 'won');
  });

  it('voids a line where nothing was tested', () => {
    assert.equal(parlayStatus([leg('void'), leg('push')]), 'void');
    assert.equal(parlayStatus([]), 'void');
  });

  it('keeps counting individual legs after the line is lost', () => {
    // The line is gone but the legs are still evidence about the model.
    const legs = [leg('won'), leg('lost'), leg('won')];
    assert.equal(parlayStatus(legs), 'lost');

    const progress = parlayProgress(legs);
    assert.equal(progress.won, 2);
    assert.equal(progress.settled, 3);
    assert.equal(progress.total, 3);
  });

  it('reports progress across every state', () => {
    const progress = parlayProgress([
      leg('won'),
      leg('live'),
      leg('pending'),
      leg('void'),
      leg('lost'),
    ]);
    assert.deepEqual(
      { won: progress.won, lost: progress.lost, live: progress.live, voided: progress.voided },
      { won: 1, lost: 1, live: 1, voided: 1 },
    );
    assert.equal(progress.total, 5);
  });

  it('stamps a settled line once and does not move the timestamp', () => {
    const parlay: ParlayRecord = {
      id: 'low:a|b',
      risk: 'low',
      leg_ids: ['a', 'b'],
      combined_probability: 0.5,
      average_confidence: 0.8,
      average_data_quality: 0.8,
      model_version: 'projection-v1',
      created_at: '2026-09-10T09:00:00.000Z',
      first_start: KICKOFF,
      status: 'pending',
      settled_at: null,
    };

    const won = applyParlayStatus(parlay, [leg('won'), leg('won')], '2026-09-10T21:00:00.000Z');
    assert.equal(won.status, 'won');
    assert.equal(won.settled_at, '2026-09-10T21:00:00.000Z');

    // Re-running settlement must not restamp it.
    const again = applyParlayStatus(won, [leg('won'), leg('won')], '2026-09-10T22:00:00.000Z');
    assert.equal(again, won, 'an unchanged status returns the same record');
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe('the prediction store', () => {
  it('fills in fields written by an earlier version', () => {
    // A record from before tracking existed must load, and must not claim to
    // be the official pre-game prediction without evidence.
    const legacy = {
      id: 'old',
      game_id: 'g1',
      sport: 'nfl',
      league: 'NFL',
      selection_type: 'winner',
      selection: 'Home to win',
      settlement: { kind: 'winner', side: 'home' },
      model_probability: 0.7,
      model_confidence: 0.8,
      data_quality: 0.8,
      model_version: 'projection-v1',
      risk: 'low',
      created_at: '2026-09-01T00:00:00.000Z',
      game_start: '2026-09-02T00:00:00.000Z',
      status: 'won',
      result: '27-24',
      settled_at: '2026-09-02T22:00:00.000Z',
    };

    const [parsed] = parsePredictions([legacy]);
    assert.equal(parsed.final_pre_game, false, 'never assumed');
    assert.equal(parsed.parlay_id, null);
    assert.equal(parsed.projected, null);
    assert.equal(parsed.actual, null);
    assert.equal(parsed.attempts, 0);
    assert.deepEqual(parsed.audit, []);
  });

  it('accepts the new statuses', () => {
    for (const status of ['live', 'push', 'unsettled'] as PredictionStatus[]) {
      assert.equal(parsePredictions([record({ status })]).length, 1, status);
    }
  });

  it('drops a partial scoreline rather than storing half of one', () => {
    const [parsed] = parsePredictions([
      record({ projected: { home_score: 2, away_score: 1 } as never }),
    ]);
    assert.equal(parsed.projected, null);
  });

  it('keeps a valid audit trail and discards a malformed one', () => {
    const [good] = parsePredictions([
      record({
        audit: [
          {
            previous_result: 'won',
            new_result: 'lost',
            reason: 'score corrected',
            changed_at: '2026-09-10T23:00:00.000Z',
          },
        ],
      }),
    ]);
    assert.equal(good.audit.length, 1);

    const [bad] = parsePredictions([record({ audit: [{ previous_result: 'nonsense' }] as never })]);
    assert.deepEqual(bad.audit, []);
  });
});

describe('the parlay store', () => {
  const parlay = (overrides: Partial<ParlayRecord> = {}): ParlayRecord => ({
    id: 'low:a|b',
    risk: 'low',
    leg_ids: ['a', 'b'],
    combined_probability: 0.5,
    average_confidence: 0.8,
    average_data_quality: 0.8,
    model_version: 'projection-v1',
    created_at: '2026-09-10T09:00:00.000Z',
    first_start: KICKOFF,
    status: 'pending',
    settled_at: null,
    ...overrides,
  });

  it('accepts a well-formed line', () => {
    assert.equal(parseParlays({ parlays: [parlay()] }).length, 1);
    assert.equal(parseParlays([parlay()]).length, 1);
  });

  it('de-duplicates, so a line is not counted twice', () => {
    assert.equal(parseParlays([parlay(), parlay()]).length, 1);
  });

  it('drops a line with no combined probability to check', () => {
    assert.deepEqual(parseParlays([parlay({ combined_probability: undefined as never })]), []);
    assert.deepEqual(parseParlays([parlay({ leg_ids: [] })]), []);
  });

  it('returns empty for junk', () => {
    assert.deepEqual(parseParlays(null), []);
    assert.deepEqual(parseParlays('nonsense'), []);
  });
});
