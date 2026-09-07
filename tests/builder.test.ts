/** Synthetic provider fixtures for tests only. Never imported by application code. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLine } from '../lib/builder/types.ts';
import type {
  BetSelection,
  BuilderLine,
  CombinationQuote,
  MarketResponse,
} from '../lib/builder/types.ts';
import {
  acceptPrice,
  addSelection,
  calculateLine,
  quoteUsable,
  revalidateLeg,
  selectionConflict,
} from '../lib/builder/line.ts';
import {
  DRAFT_VERSION,
  exportLine,
  restoreActive,
  restoreLine,
} from '../lib/builder/drafts.ts';
import {
  matchOddsEvent,
  normaliseBuilderOdds,
} from '../lib/builder/odds-normalise.ts';
import { analyseStructure } from '../lib/builder/analysis.ts';

const NOW = Date.parse('2026-09-07T12:00:00Z');
const ISO = new Date(NOW).toISOString();
function selection(overrides: Partial<BetSelection> = {}): BetSelection {
  return {
    id: 'test-home',
    provider: 'test-only',
    event: {
      id: 'espn-nfl-123',
      providerEventId: 'provider-123',
      sport: 'nfl',
      competition: 'Test league',
      name: 'Test B v Test A',
      home: 'Test A',
      away: 'Test B',
      startTime: '2026-09-08T12:00:00Z',
      status: 'prematch',
    },
    bookmaker: { id: 'test-book', name: 'Test Book (fixture)' },
    marketId: 'test-market',
    outcomeId: 'home',
    market: 'h2h',
    marketName: 'Match winner',
    outcome: 'Test A',
    side: 'home',
    direction: null,
    line: null,
    period: 'full_game',
    settlement: {
      key: 'including-overtime',
      scope: 'including_overtime',
      label: 'Includes overtime (test)',
    },
    decimal: 2,
    quotedAt: ISO,
    fetchedAt: ISO,
    expiresAt: '2026-09-07T12:05:00Z',
    availability: 'available',
    ...overrides,
  };
}
function other(): BetSelection {
  const s = selection();
  return {
    ...s,
    id: 'other-home',
    event: {
      ...s.event,
      id: 'espn-nfl-456',
      providerEventId: 'provider-456',
      name: 'Test D v Test C',
      home: 'Test C',
      away: 'Test D',
    },
    decimal: 3,
  };
}
function lineOf(...selections: BetSelection[]): BuilderLine {
  return {
    ...emptyLine(),
    bookmakerId: 'test-book',
    legs: selections.map((s) => ({
      selection: s,
      state: 'current',
      pending: null,
      checkedAt: ISO,
      reason: null,
    })),
  };
}
function response(...selections: BetSelection[]): MarketResponse {
  return {
    event: selections[0]?.event ?? null,
    provider: 'test-only',
    fetchedAt: ISO,
    stale: false,
    message: null,
    selections,
  };
}

describe('Builder actual leg selection', () => {
  it('starts empty and adding an outcome keeps its complete identity', () => {
    const before = emptyLine();
    assert.equal(before.legs.length, 0);
    const added = addSelection(before, selection());
    assert.equal(added.error, null);
    assert.equal(added.line.legs.length, 1);
    assert.deepEqual(added.line.legs[0].selection, selection());
    assert.equal(added.line.legs[0].state, 'unverified');
    assert.equal(before.legs.length, 0);
  });
  it('prevents duplicate selections without mutating the line', () => {
    const line = lineOf(selection());
    const result = addSelection(line, selection());
    assert.match(result.error!, /already/);
    assert.equal(result.line, line);
  });
  it('detects opposite outcomes and conflicting total thresholds', () => {
    assert.ok(
      selectionConflict(
        selection(),
        selection({ id: 'away', side: 'away', outcomeId: 'away' }),
      ),
    );
    const over = selection({
      id: 'over',
      marketId: 'total-4',
      market: 'totals',
      direction: 'over',
      line: 4.5,
    });
    const under = selection({
      id: 'under',
      marketId: 'total-3',
      market: 'totals',
      direction: 'under',
      line: 3.5,
    });
    assert.match(selectionConflict(over, under)!, /thresholds/);
    assert.equal(selectionConflict({ ...over, line: 2.5 }, under), null);
  });
  it('does not collapse regulation and overtime markets', () => {
    const regulation = selection({
      id: 'reg',
      marketId: 'reg-market',
      settlement: {
        key: 'regulation',
        label: 'Regulation only',
        scope: 'regulation',
      },
    });
    assert.equal(selectionConflict(selection(), regulation), null);
    assert.equal(
      calculateLine(lineOf(selection(), regulation), null, NOW).decimal,
      null,
    );
  });
  it('detects cross-market conflicts when explicit settlement scopes agree', () => {
    const winner = selection({
      settlement: {
        key: 'winner-rules',
        scope: 'including_overtime',
        label: 'Includes overtime',
      },
    });
    const spread = selection({
      id: 'away-spread',
      marketId: 'away-spread',
      market: 'spreads',
      side: 'away',
      line: -1.5,
      settlement: {
        key: 'spread-rules',
        scope: 'including_overtime',
        label: 'Includes overtime',
      },
    });
    assert.match(selectionConflict(winner, spread)!, /winner conflicts/);
    assert.equal(
      selectionConflict(winner, {
        ...spread,
        settlement: { ...spread.settlement, scope: 'unknown' },
      }),
      null,
    );
  });
  it('rejects cross-bookmaker adds and supports explicit replacement', () => {
    const line = lineOf(selection());
    const mismatch = selection({
      id: 'book2',
      bookmaker: { id: 'book2', name: 'Second' },
    });
    assert.match(addSelection(line, mismatch).error!, /bookmaker/);
    const updated = addSelection(
      line,
      selection({ id: 'away', side: 'away', outcomeId: 'away' }),
      'test-home',
    );
    assert.equal(updated.error, null);
    assert.equal(updated.line.legs.length, 1);
    assert.equal(updated.line.legs[0].selection.side, 'away');
    assert.equal(line.legs[0].selection.side, 'home');
  });
});

describe('Builder prices and combinations', () => {
  it('calculates decimal product, total return and net profit separately', () => {
    const result = calculateLine(lineOf(selection(), other()), null, NOW);
    assert.equal(result.decimal, 6);
    assert.equal(result.totalReturn, 60);
    assert.equal(result.profit, 50);
    assert.equal(result.implied, 1 / 6);
    assert.equal(result.kind, 'Multi-match accumulator');
    assert.equal(result.executable, false);
  });
  it('distinguishes a single', () => {
    const r = calculateLine(lineOf(selection()), null, NOW);
    assert.equal(r.kind, 'Single');
    assert.equal(r.totalReturn, 20);
  });
  it('never combines prices from different bookmakers after switching the chosen book', () => {
    const line = lineOf(selection(), {
      ...other(),
      bookmaker: { id: 'book2', name: 'Other' },
    });
    assert.equal(calculateLine(line, null, NOW).decimal, null);
    assert.equal(
      calculateLine({ ...line, bookmakerId: 'book2' }, null, NOW).decimal,
      null,
    );
  });
  it('will not multiply same-game or mixed same-game prices', () => {
    const total = selection({
      id: 'total',
      marketId: 'total',
      market: 'totals',
      side: null,
      direction: 'over',
      line: 40.5,
    });
    assert.equal(
      calculateLine(lineOf(selection(), total), null, NOW).decimal,
      null,
    );
    assert.equal(
      calculateLine(lineOf(selection(), total, other()), null, NOW).decimal,
      null,
    );
  });
  it('recognizes the same provider event behind different application IDs', () => {
    const s = selection();
    const alias = {
      ...s,
      id: 'alias-total',
      event: { ...s.event, id: '123' },
      market: 'totals',
      marketId: 'total',
      side: null,
      direction: 'over' as const,
      line: 40.5,
    };
    assert.equal(calculateLine(lineOf(s, alias), null, NOW).decimal, null);
  });
  it('requires an exact fresh combination quote, never the individual product', () => {
    const total = selection({
      id: 'total',
      marketId: 'total',
      market: 'totals',
      side: null,
      direction: 'over',
      line: 40.5,
    });
    const line = lineOf(selection(), total);
    const quote: CombinationQuote = {
      id: 'test-combination',
      bookmakerId: 'test-book',
      selectionIds: ['test-home', 'total'],
      decimal: 2.7,
      quotedAt: ISO,
      expiresAt: '2026-09-07T12:02:00Z',
    };
    assert.equal(calculateLine(line, quote, NOW).decimal, 2.7);
    assert.equal(calculateLine(line, quote, NOW).executable, true);
    assert.equal(
      calculateLine(line, { ...quote, bookmakerId: 'other' }, NOW).decimal,
      null,
    );
    assert.equal(
      calculateLine(line, { ...quote, selectionIds: ['test-home'] }, NOW)
        .decimal,
      null,
    );
    assert.equal(calculateLine(line, quote, NOW + 121_000).decimal, null);
  });
  it('blocks expired, missing, suspended and reference prices', () => {
    for (const s of [
      selection({ decimal: null }),
      selection({ availability: 'suspended' }),
      selection({ availability: 'reference' }),
      selection({ quotedAt: null }),
      selection({ expiresAt: ISO }),
      selection({ quotedAt: '2026-09-08T12:00:00Z' }),
    ]) {
      assert.equal(quoteUsable(s, NOW), false);
      assert.equal(calculateLine(lineOf(s), null, NOW).totalReturn, null);
    }
  });
  it('does not carry pre-match prices past kickoff', () => {
    const s = selection();
    s.event.startTime = ISO;
    assert.equal(quoteUsable(s, NOW), false);
  });
  it('validates stake and rounds currency amounts', () => {
    for (const stake of ['', '-1', 'Infinity', '0', '1e3', '1.001', '1000001'])
      assert.equal(
        calculateLine({ ...lineOf(selection()), stake }, null, NOW).totalReturn,
        null,
      );
    assert.equal(
      calculateLine(
        { ...lineOf(selection({ decimal: 1.33333 })), stake: '3' },
        null,
        NOW,
      ).totalReturn,
      4,
    );
  });
});

describe('Builder revalidation and draft restoration', () => {
  it('keeps moved prices pending until explicitly accepted', () => {
    const leg = lineOf(selection()).legs[0];
    const next = selection({ decimal: 2.4 });
    const changed = revalidateLeg(leg, response(next), NOW);
    assert.equal(changed.state, 'changed');
    assert.equal(changed.selection.decimal, 2);
    assert.equal(changed.pending?.decimal, 2.4);
    assert.equal(
      calculateLine({ ...lineOf(selection()), legs: [changed] }, null, NOW)
        .decimal,
      null,
    );
    assert.equal(acceptPrice(changed, NOW).selection.decimal, 2.4);
    assert.equal(acceptPrice(changed, NOW).state, 'current');
    assert.equal(acceptPrice(changed, NOW + 600_000).state, 'changed');
  });
  it('does not silently replace a moved threshold', () => {
    const leg = lineOf(
      selection({ id: 'total-2', market: 'totals', line: 2.5 }),
    ).legs[0];
    const checked = revalidateLeg(
      leg,
      response(selection({ id: 'total-3', market: 'totals', line: 3.5 })),
      NOW,
    );
    assert.equal(checked.state, 'unavailable');
    assert.equal(checked.selection.line, 2.5);
  });
  it('marks missing and stale responses unavailable, preserving the original leg', () => {
    const leg = lineOf(selection()).legs[0];
    assert.equal(revalidateLeg(leg, response(), NOW).state, 'unavailable');
    assert.equal(
      revalidateLeg(leg, { ...response(selection()), stale: true }, NOW).state,
      'unavailable',
    );
    assert.equal(
      revalidateLeg(leg, response(selection()), NOW).state,
      'current',
    );
  });
  it('restores a versioned draft while discarding verification claims', () => {
    const line = lineOf(selection(), other());
    const restored = restoreActive(
      JSON.stringify({ version: DRAFT_VERSION, line }),
    )!;
    assert.equal(restored.name, line.name);
    assert.equal(restored.legs.length, 2);
    assert.equal(restored.legs[0].state, 'unverified');
    assert.equal(restored.legs[0].checkedAt, null);
    assert.equal(
      revalidateLeg(
        restored.legs[0],
        response(selection({ decimal: 2.2 })),
        NOW,
      ).state,
      'changed',
    );
  });
  it('rejects corrupt/future versions and malformed nested selection data', () => {
    assert.equal(restoreActive('{bad'), null);
    assert.equal(
      restoreActive(JSON.stringify({ version: 2, line: lineOf(selection()) })),
      null,
    );
    assert.equal(
      restoreLine({
        ...lineOf(selection()),
        legs: [{ selection: { ...selection(), event: null } }],
      }),
      null,
    );
    assert.equal(restoreLine(lineOf(selection(), selection())), null);
  });
  it('exports readable selection, settlement, bookmaker, timestamp and monetary fields', () => {
    const summary = exportLine(lineOf(selection(), other()), NOW);
    for (const expected of [
      'Test B v Test A',
      'Test Book (fixture)',
      'Includes overtime',
      ISO,
      'GBP 10',
      'GBP 60.00',
      'GBP 50.00',
      'No wager',
    ])
      assert.ok(summary.includes(expected), expected);
  });
});

describe('Builder provider normalization (synthetic payload)', () => {
  const raw = {
    id: 'provider-123',
    sport_key: 'americanfootball_nfl',
    commence_time: '2026-09-08T12:00:00Z',
    home_team: 'Test A',
    away_team: 'Test B',
    bookmakers: [
      {
        key: 'book',
        title: 'Fixture book',
        last_update: ISO,
        markets: [
          {
            key: 'h2h',
            outcomes: [
              { name: 'Test A', price: 2 },
              { name: 'Test B', price: 2.1 },
            ],
          },
          {
            key: 'spreads',
            outcomes: [
              { name: 'Test A', point: -1.5, price: 1.9 },
              { name: 'Test B', point: 1.5, price: 1.95 },
            ],
          },
        ],
      },
    ],
  };
  it('only matches the same competition, orientation and unambiguous start time', () => {
    assert.equal(
      matchOddsEvent(selection().event, [raw], 'americanfootball_nfl'),
      raw,
    );
    assert.equal(
      matchOddsEvent(
        selection().event,
        [raw, { ...raw, id: 'duplicate' }],
        'americanfootball_nfl',
      ),
      null,
    );
    assert.equal(
      matchOddsEvent(
        selection().event,
        [{ ...raw, home_team: 'Test B', away_team: 'Test A' }],
        'americanfootball_nfl',
      ),
      null,
    );
    assert.equal(
      matchOddsEvent(
        selection().event,
        [{ ...raw, commence_time: '2026-09-08T18:00:00Z' }],
        'americanfootball_nfl',
      ),
      null,
    );
    assert.equal(
      matchOddsEvent(selection().event, [raw], 'baseball_mlb'),
      null,
    );
  });
  it('preserves bookmaker, thresholds, stable IDs and unknown settlement without inventing bets', () => {
    const choices = normaliseBuilderOdds(raw, selection().event, ISO, 300_000);
    assert.equal(choices.length, 4);
    assert.equal(choices[0].settlement.scope, 'unknown');
    assert.equal(choices[0].bookmaker.id, 'the-odds-api:book');
    assert.ok(
      choices.every((s) => s.market === 'h2h' || s.market === 'spreads'),
    );
    const moved = structuredClone(raw);
    moved.bookmakers[0].markets[0].outcomes[0].price = 2.5;
    const updated = normaliseBuilderOdds(
      moved,
      selection().event,
      '2026-09-07T12:01:00Z',
      300_000,
    );
    assert.equal(updated[0].id, choices[0].id);
    assert.equal(updated[0].quotedAt, ISO);
    assert.notEqual(choices[2].id, choices[3].id);
    assert.equal(choices[2].marketId, choices[3].marketId);
    assert.ok(
      restoreLine(lineOf(...choices)),
      'normalized provider IDs survive persistence',
    );
  });
  it('never treats retrieval time or an unpriced line as a current quote', () => {
    const payload = structuredClone(raw);
    payload.bookmakers[0].last_update = 'invalid';
    assert.ok(
      normaliseBuilderOdds(payload, selection().event, ISO, 300_000).every(
        (s) => s.quotedAt === null && s.availability === 'reference',
      ),
    );
    assert.equal(
      normaliseBuilderOdds(
        {
          ...raw,
          bookmakers: [
            {
              key: 'book',
              title: 'Book',
              markets: [
                { key: 'spreads', outcomes: [{ name: 'Test A', price: 2 }] },
              ],
            },
          ],
        },
        selection().event,
        ISO,
        300_000,
      ).length,
      0,
    );
  });
});

describe('Builder complete-line comparisons', () => {
  it('shows shorter lines and equal-total-stake singles without changing selections', () => {
    const line = lineOf(selection(), other());
    const original = JSON.stringify(line);
    const analysis = analyseStructure(line, NOW);
    assert.equal(analysis.comparisons[0].result.totalReturn, 30);
    assert.equal(analysis.comparisons[1].result.totalReturn, 20);
    assert.equal(
      analysis.singles.reduce((n, s) => n + s.stake, 0),
      10,
    );
    assert.equal(analysis.allSinglesReturn, 25);
    assert.equal(JSON.stringify(line), original);
    assert.match(analysis.largest, /bookmaker-implied/);
    assert.match(analysis.uncertainty, /cannot be ranked/);
    assert.ok(analysis.risks.some((r) => /concentrated/.test(r)));
  });
});
