/**
 * A prediction's whole life, through the real store.
 *
 * Everything else about the tracker is tested as pure rules. This exercises the
 * function those rules actually run inside — `settlePredictions`, which reads
 * the file, decides every outcome, folds legs into their lines and writes back.
 * It had no direct coverage at all, because `store.ts` could not be imported by
 * the test runner until its imports carried extensions.
 *
 * That gap mattered: the defect that discarded every Formula 1 prediction lived
 * exactly here, in the seam between a record being written and the same record
 * being read back. Pure-rule tests could never have caught it — each rule was
 * correct in isolation.
 *
 * A temporary DATA_DIR per run, so this never reads or writes real history.
 */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { before, describe, it } from 'node:test';

const DATA_DIR = await mkdtemp(path.join(tmpdir(), 'parlay-lifecycle-'));
process.env.DATA_DIR = DATA_DIR;

// Imported after DATA_DIR is set: config reads the environment on first load.
const { predictionsPath, readPredictions, settlePredictions } = await import(
  '../lib/projections/store.ts'
);
const { PREDICTIONS_FILENAME } = await import('../lib/projections/store-parse.ts');
import type { GameState } from '../lib/projections/store.ts';
import type { PredictionRecordV2 } from '../lib/projections/types.ts';

const KICKOFF = '2026-09-06T13:00:00.000Z';

function record(overrides: Partial<PredictionRecordV2> = {}): PredictionRecordV2 {
  return {
    id: 'p1',
    game_id: 'g1',
    sport: 'football',
    league: 'Premier League',
    selection_type: 'winner',
    selection: 'Arsenal to win',
    settlement: { kind: 'winner', side: 'home' },
    model_probability: 0.7,
    model_confidence: 0.8,
    data_quality: 0.8,
    model_version: 'projection-v1',
    risk: 'low',
    created_at: '2026-09-06T09:00:00.000Z',
    game_start: KICKOFF,
    status: 'pending',
    result: null,
    settled_at: null,
    final_pre_game: false,
    parlay_id: null,
    projected: { home_score: 2, away_score: 1, margin: 1, total: 3 },
    actual: null,
    attempts: 0,
    next_attempt_at: null,
    audit: [],
    ...overrides,
  };
}

/** A driver line-up, in classified order. */
function order(...names: string[]) {
  return names.map((entrant, index) => ({ entrant, position: index + 1 }));
}

const GRID = order(
  'Max Verstappen',
  'Lando Norris',
  'Charles Leclerc',
  'George Russell',
  'Oscar Piastri',
);

async function seed(records: PredictionRecordV2[]): Promise<void> {
  await writeFile(
    path.join(DATA_DIR, PREDICTIONS_FILENAME),
    JSON.stringify({ predictions: records }),
    'utf8',
  );
}

async function stored(): Promise<PredictionRecordV2[]> {
  const raw = await readFile(predictionsPath(), 'utf8');
  return JSON.parse(raw).predictions as PredictionRecordV2[];
}

describe('settling a race through the store', () => {
  const f1 = (overrides: Partial<PredictionRecordV2> = {}) =>
    record({
      id: 'f1-top3',
      game_id: 'espn-f1-race',
      sport: 'f1',
      league: 'Formula 1',
      selection_type: 'finish_position',
      selection: 'Charles Leclerc podium',
      settlement: { kind: 'finish_position', entrant: 'Charles Leclerc', within: 3 },
      model_version: 'projection-v1-race',
      projected: null,
      ...overrides,
    });

  const finished: GameState = {
    status: 'finished',
    // A race publishes no score. This is exactly what the tracker records.
    home: null,
    away: null,
    order: GRID,
  };

  before(async () => {
    await seed([]);
  });

  it('survives being written and read back', async () => {
    await seed([f1()]);
    const back = await readPredictions();
    assert.deepEqual(
      back.map((entry) => entry.id),
      ['f1-top3'],
      'a race prediction the store drops is one the tracker can never settle',
    );
  });

  it('settles on the finishing order, with no score anywhere in sight', async () => {
    await seed([f1()]);
    const summary = await settlePredictions(new Map([['espn-f1-race', finished]]));

    assert.equal(summary.settled, 1);

    const [after] = await stored();
    assert.equal(after.status, 'won', 'Leclerc was classified third');
    assert.equal(after.result, `Classified P3 of ${GRID.length}`);
    assert.equal(after.actual?.position, 3);
    assert.equal(after.actual?.field_size, GRID.length);
    assert.equal(after.settled_at !== null, true);
  });

  it('loses a driver classified outside the line', async () => {
    await seed([
      f1({
        id: 'f1-win',
        selection: 'Charles Leclerc to win',
        settlement: { kind: 'finish_position', entrant: 'Charles Leclerc', within: 1 },
      }),
    ]);
    await settlePredictions(new Map([['espn-f1-race', finished]]));

    const [after] = await stored();
    assert.equal(after.status, 'lost');
    assert.equal(after.result, `Classified P3 of ${GRID.length}`);
  });

  it('voids a driver who never took part rather than failing them', async () => {
    await seed([
      f1({
        id: 'f1-absent',
        settlement: { kind: 'finish_position', entrant: 'Someone Else', within: 3 },
      }),
    ]);
    await settlePredictions(new Map([['espn-f1-race', finished]]));

    const [after] = await stored();
    assert.equal(after.status, 'void');
    assert.equal(after.result, 'Did not take part');
  });

  it('holds a race open when the order has not been published', async () => {
    await seed([f1()]);
    const summary = await settlePredictions(
      new Map([['espn-f1-race', { status: 'finished', home: null, away: null } as GameState]]),
    );

    assert.equal(summary.unsettled, 1, 'no order is "not yet", never "no"');
    const [after] = await stored();
    assert.equal(after.status, 'unsettled');
    assert.ok(after.next_attempt_at, 'it must be scheduled to try again');
  });

  it('corrects a race when the stewards change the order', async () => {
    /*
     * The case that could not happen before: the correction path understood
     * only scorelines, so a penalty applied after the flag never reached the
     * prediction it changed.
     */
    await seed([f1()]);
    await settlePredictions(new Map([['espn-f1-race', finished]]));
    assert.equal((await stored())[0].status, 'won');

    const penalised: GameState = {
      status: 'finished',
      home: null,
      away: null,
      // Leclerc drops to fourth after a time penalty.
      order: order(
        'Max Verstappen',
        'Lando Norris',
        'George Russell',
        'Charles Leclerc',
        'Oscar Piastri',
      ),
    };

    const summary = await settlePredictions(new Map([['espn-f1-race', penalised]]));
    assert.equal(summary.corrected, 1);

    const [after] = await stored();
    assert.equal(after.status, 'lost');
    assert.equal(after.actual?.position, 4);
    assert.equal(after.audit.at(-1)?.previous_result, 'won');
    assert.equal(after.audit.at(-1)?.new_result, 'lost');
    assert.match(after.audit.at(-1)?.reason ?? '', /finishing order/);
  });

  it('leaves a settled race alone when the order goes missing', async () => {
    // A provider hiccup must not overwrite a sound result with a void.
    await seed([f1()]);
    await settlePredictions(new Map([['espn-f1-race', finished]]));

    const summary = await settlePredictions(
      new Map([['espn-f1-race', { status: 'finished', home: null, away: null } as GameState]]),
    );
    assert.equal(summary.corrected, 0);
    assert.equal((await stored())[0].status, 'won');
  });
});

describe('settling a fixture through the store', () => {
  const finished: GameState = { status: 'finished', home: 2, away: 1 };

  it('settles on the scoreline and records what happened', async () => {
    await seed([record()]);
    const summary = await settlePredictions(new Map([['g1', finished]]));

    assert.equal(summary.settled, 1);
    const [after] = await stored();
    assert.equal(after.status, 'won');
    assert.equal(after.result, '2-1');
    assert.equal(after.actual?.home_score, 2);
    assert.equal(after.actual?.margin, 1);
  });

  it('voids a game that was never played', async () => {
    await seed([record()]);
    await settlePredictions(new Map([['g1', { status: 'postponed', home: null, away: null }]]));

    const [after] = await stored();
    assert.equal(after.status, 'void', 'untested is not the same as wrong');
    assert.equal(after.result, 'Postponed');
  });

  it('writes nothing on a second identical run', async () => {
    await seed([record()]);
    await settlePredictions(new Map([['g1', finished]]));
    const first = await readFile(predictionsPath(), 'utf8');

    const summary = await settlePredictions(new Map([['g1', finished]]));
    assert.deepEqual(summary, {
      settled: 0,
      live: 0,
      unsettled: 0,
      abandoned: 0,
      corrected: 0,
      parlays: 0,
    });
    assert.equal(await readFile(predictionsPath(), 'utf8'), first, 'a repeat run is a no-op');
  });

  it('keeps a race and a fixture settling side by side', async () => {
    // The mixed card is the real shape of the store, and the two models must
    // not interfere with one another.
    await seed([
      record({ id: 'fixture' }),
      record({
        id: 'race',
        game_id: 'espn-f1-race',
        sport: 'f1',
        selection_type: 'finish_position',
        selection: 'Lando Norris podium',
        settlement: { kind: 'finish_position', entrant: 'Lando Norris', within: 3 },
        model_version: 'projection-v1-race',
        projected: null,
      }),
    ]);

    const summary = await settlePredictions(
      new Map<string, GameState>([
        ['g1', finished],
        ['espn-f1-race', { status: 'finished', home: null, away: null, order: GRID }],
      ]),
    );

    assert.equal(summary.settled, 2);
    const after = await stored();
    assert.deepEqual(
      after.map((entry) => [entry.id, entry.status]),
      [
        ['fixture', 'won'],
        ['race', 'won'],
      ],
    );
  });
});
