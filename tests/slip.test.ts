/**
 * The slip: validation, sectioning, and when a pick leaves.
 *
 * These rules are most of the feature. A slip that never empties becomes a list
 * of last month's fixtures; one that empties too eagerly loses the results a
 * reader came back to see. Both failures are quiet, so both are tested.
 *
 * Pure throughout — no filesystem, no provider.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_ENTRIES,
  isSettledStatus,
  parseEntry,
  parseSlip,
  sortEntries,
  updateSlip,
} from '../lib/slip/parse.ts';
import { selectionsForGames, optimise } from '../lib/projections/optimiser.ts';
import { selectionScore } from '../lib/projections/project.ts';
import { priceFromDecimal } from '../lib/markets/price.ts';
import type { GameStatus } from '../lib/home/types.ts';
import type { MarketContext } from '../lib/markets/types.ts';
import type { SlipEntry } from '../lib/slip/types.ts';
import type { Selection } from '../lib/projections/types.ts';

const KICKOFF = '2026-09-08T14:00:00.000Z';
const TODAY = '2026-09-08';

function entry(overrides: Partial<SlipEntry> = {}): SlipEntry {
  return {
    gameId: 'espn-epl-401879279',
    addedAt: '2026-09-07T09:00:00.000Z',
    label: 'Chelsea v Arsenal',
    league: 'Premier League',
    sport: 'football',
    startTime: KICKOFF,
    ...overrides,
  };
}

function statuses(map: Record<string, GameStatus>): Map<string, GameStatus> {
  return new Map(Object.entries(map));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('reading a stored slip', () => {
  it('accepts a well-formed entry', () => {
    assert.equal(parseSlip({ entries: [entry()] }).length, 1);
    assert.equal(parseSlip([entry()]).length, 1);
  });

  it('rejects an id that would not resolve to a page', () => {
    // The same validator the game routes use, so a slip can never hold an id
    // that 404s when clicked.
    assert.equal(parseEntry(entry({ gameId: '../../etc/passwd' })), null);
    assert.equal(parseEntry(entry({ gameId: '' })), null);
  });

  it('rejects an entry with no label to show', () => {
    assert.equal(parseEntry(entry({ label: '   ' })), null);
  });

  it('de-duplicates, so one match cannot contribute two legs', () => {
    assert.equal(parseSlip([entry(), { ...entry() }]).length, 1);
  });

  it('caps the slip', () => {
    const many = Array.from({ length: MAX_ENTRIES + 10 }, (_, index) =>
      entry({ gameId: `espn-epl-40187${1000 + index}` }),
    );
    assert.equal(parseSlip(many).length, MAX_ENTRIES);
  });

  it('returns empty for junk rather than failing the read', () => {
    // A corrupt file must not make the page unable to show a slip at all.
    assert.deepEqual(parseSlip(null), []);
    assert.deepEqual(parseSlip('nonsense'), []);
  });

  it('keeps a settled date only when it is a real date', () => {
    assert.equal(parseEntry(entry({ settledOn: '2026-09-08' }))?.settledOn, '2026-09-08');
    assert.equal(parseEntry(entry({ settledOn: 'yesterday' as never }))?.settledOn, undefined);
  });

  it('sorts by kick-off, with unknown times last', () => {
    const sorted = sortEntries([
      entry({ gameId: 'c', label: 'C', startTime: null }),
      entry({ gameId: 'b', label: 'B', startTime: '2026-09-08T18:00:00.000Z' }),
      entry({ gameId: 'a', label: 'A', startTime: '2026-09-08T12:00:00.000Z' }),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.label),
      ['A', 'B', 'C'],
    );
  });
});

// ---------------------------------------------------------------------------
// Sectioning
// ---------------------------------------------------------------------------

describe('splitting the slip', () => {
  it('treats anything that can still be projected as active', () => {
    assert.equal(isSettledStatus('scheduled'), false);
    assert.equal(isSettledStatus('live'), false);
  });

  it('treats anything that can never produce a line as settled', () => {
    // Cancelled and postponed count: no line will ever be built from either,
    // which is the question this answers.
    assert.equal(isSettledStatus('finished'), true);
    assert.equal(isSettledStatus('cancelled'), true);
    assert.equal(isSettledStatus('postponed'), true);
  });

  it('never retires a fixture on an unreadable status', () => {
    // An unknown status is not evidence a game is over.
    assert.equal(isSettledStatus('unknown'), false);
  });

  it('keeps an upcoming match active and a finished one settled', () => {
    const result = updateSlip([entry({ gameId: 'a' }), entry({ gameId: 'b' })], {
      statuses: statuses({ a: 'scheduled', b: 'finished' }),
      today: TODAY,
      now: Date.parse(KICKOFF),
    });

    assert.deepEqual(result.active.map((item) => item.gameId), ['a']);
    assert.deepEqual(result.settled.map((item) => item.gameId), ['b']);
  });

  it('leaves a match alone when its status could not be resolved', () => {
    // An unreachable provider must not move a pick out of Active.
    const result = updateSlip([entry({ gameId: 'a' })], {
      statuses: statuses({}),
      today: TODAY,
      now: Date.parse(KICKOFF),
    });
    assert.deepEqual(result.active.map((item) => item.gameId), ['a']);
    assert.equal(result.changed, false);
  });

  it('stamps the day a result was first observed', () => {
    const result = updateSlip([entry({ gameId: 'a' })], {
      statuses: statuses({ a: 'finished' }),
      today: TODAY,
      now: Date.parse(KICKOFF),
    });
    assert.equal(result.settled[0].settledOn, TODAY);
    assert.equal(result.changed, true, 'the stamp must be persisted');
  });

  it('does not restart the clock on a later read', () => {
    /*
     * The bug this prevents: re-stamping on every read would mean an entry
     * whose page is opened daily never expires.
     */
    const result = updateSlip([entry({ gameId: 'a', settledOn: '2026-09-07' })], {
      statuses: statuses({ a: 'finished' }),
      today: '2026-09-07',
      now: Date.parse(KICKOFF),
    });
    assert.equal(result.settled[0].settledOn, '2026-09-07');
    assert.equal(result.changed, false, 'nothing changed, so nothing is written');
  });
});

// ---------------------------------------------------------------------------
// Leaving the slip
// ---------------------------------------------------------------------------

describe('when a pick leaves', () => {
  it('keeps a result for the rest of the day it finished', () => {
    const result = updateSlip([entry({ gameId: 'a', settledOn: TODAY })], {
      statuses: statuses({ a: 'finished' }),
      today: TODAY,
      now: Date.parse(KICKOFF),
    });
    assert.equal(result.settled.length, 1);
    assert.equal(result.removed.length, 0);
  });

  it('drops it once the date has moved past that day', () => {
    const result = updateSlip([entry({ gameId: 'a', settledOn: '2026-09-07' })], {
      statuses: statuses({ a: 'finished' }),
      today: TODAY,
      now: Date.parse(KICKOFF),
    });
    assert.equal(result.settled.length, 0);
    assert.deepEqual(
      result.removed.map((item) => item.reason),
      ['expired'],
    );
  });

  it('drops a match that was never seen to finish, long after kick-off', () => {
    // A postponement never rescheduled, or a fixture the provider dropped. It
    // must not sit in Active for ever claiming a line could be built from it.
    const result = updateSlip([entry({ gameId: 'a' })], {
      statuses: statuses({}),
      today: TODAY,
      now: Date.parse(KICKOFF) + 72 * 60 * 60 * 1000,
    });
    assert.equal(result.active.length, 0);
    assert.deepEqual(
      result.removed.map((item) => item.reason),
      ['stale'],
    );
  });

  it('keeps a match that has only just started', () => {
    const result = updateSlip([entry({ gameId: 'a' })], {
      statuses: statuses({ a: 'live' }),
      today: TODAY,
      now: Date.parse(KICKOFF) + 60 * 60 * 1000,
    });
    assert.deepEqual(result.active.map((item) => item.gameId), ['a']);
  });

  it('writes nothing when nothing moved', () => {
    const result = updateSlip([entry({ gameId: 'a' })], {
      statuses: statuses({ a: 'scheduled' }),
      today: TODAY,
      now: Date.parse(KICKOFF) - 60 * 60 * 1000,
    });
    assert.equal(result.changed, false);
  });
});

// ---------------------------------------------------------------------------
// Building from the picks
// ---------------------------------------------------------------------------

function selection(id: string, gameId: string, overrides: Partial<Selection> = {}): Selection {
  const price = priceFromDecimal(1.5);
  assert.ok(price);

  const market: MarketContext = {
    type: 'moneyline',
    period: 'full_game',
    label: 'Moneyline',
    selection: `${id} label`,
    line: null,
    availability: 'verified',
    price,
    source: 'Test Book',
    fetchedAt: new Date().toISOString(),
    fairProbability: 0.66,
    margin: 0.05,
  };

  const probability = (overrides.probability as number | undefined) ?? 0.78;

  return {
    id,
    game_id: gameId,
    sport: 'football',
    league: 'Premier League',
    start_time: KICKOFF,
    fixture: `${gameId} fixture`,
    type: 'winner',
    label: `${id} label`,
    market,
    explanation: 'Home must win the game.',
    probability_label: 'Win probability',
    probability,
    confidence: 0.8,
    data_quality: 0.8,
    score: selectionScore(probability, 0.8, 0.8),
    correlation_group: gameId,
    settlement: { kind: 'winner', side: 'home' },
    reasoning: { support: [], risks: [], context: [] },
    ...overrides,
  } as Selection;
}

describe('a line built from the picks', () => {
  const card = [
    selection('a', 'g1', { probability: 0.8 }),
    selection('a2', 'g1', { probability: 0.74, type: 'total' }),
    selection('b', 'g2', { probability: 0.77 }),
    selection('c', 'g3', { probability: 0.75 }),
    selection('elsewhere', 'g9', { probability: 0.93 }),
  ];

  it('narrows to the matches picked and nothing else', () => {
    assert.deepEqual(
      selectionsForGames(card, ['g1', 'g3']).map((item) => item.id).sort(),
      ['a', 'a2', 'c'],
    );
  });

  it('treats an empty slip as nothing, never as everything', () => {
    assert.deepEqual(selectionsForGames(card, []), []);
  });

  it('cannot reach a match the reader did not pick', () => {
    /*
     * `elsewhere` is the strongest selection on the card by some way. It must
     * not appear — the same guarantee the sport and competition filters give.
     */
    const { parlay } = optimise(selectionsForGames(card, ['g1', 'g2', 'g3']), {
      risk: 'low',
      legs: 4,
    });

    assert.ok(parlay);
    assert.equal(parlay.legs.length, 3, 'three picks make at most three legs');
    assert.ok(!parlay.legs.some((leg) => leg.id === 'elsewhere'));
  });

  it('takes one leg per match, the strongest on each', () => {
    const { parlay } = optimise(selectionsForGames(card, ['g1', 'g2']), {
      risk: 'low',
      legs: 2,
    });
    assert.ok(parlay);
    assert.equal(parlay.legs.filter((leg) => leg.game_id === 'g1').length, 1);
    assert.equal(parlay.legs.find((leg) => leg.game_id === 'g1')?.id, 'a');
  });

  it('leaves out a pick that clears nothing rather than weakening the line', () => {
    // Three picked, two legs returned, and the count the page explains the gap
    // with is the one reported here.
    const withWeak = [
      selection('s1', 'g1', { probability: 0.82 }),
      selection('s2', 'g2', { probability: 0.79 }),
      selection('weak', 'g3', { probability: 0.3 }),
    ];

    const result = optimise(selectionsForGames(withWeak, ['g1', 'g2', 'g3']), {
      risk: 'low',
      legs: 3,
    });

    assert.ok(result.parlay);
    assert.equal(result.parlay.legs.length, 2);
    assert.equal(result.gamesAvailable, 2);
    assert.ok(!result.parlay.legs.some((leg) => leg.game_id === 'g3'));
  });
});
