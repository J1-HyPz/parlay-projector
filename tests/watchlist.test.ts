import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAX_ENTRIES,
  STALE_AFTER_MS,
  parseEntry,
  parseWatchlist,
  pruneWatchlist,
  sortEntries,
} from '../lib/watchlist/parse.ts';
import type { WatchlistEntry } from '../lib/watchlist/types.ts';

const NOW = Date.parse('2026-09-02T18:00:00.000Z');

function entry(overrides: Partial<WatchlistEntry> = {}): WatchlistEntry {
  return {
    gameId: 'espn-epl-1',
    addedAt: '2026-09-02T09:00:00.000Z',
    label: 'Chelsea v Arsenal',
    league: 'Premier League',
    sport: 'football',
    startTime: '2026-09-02T14:00:00.000Z',
    ...overrides,
  };
}

describe('watchlist entries', () => {
  it('accepts a well-formed entry', () => {
    const parsed = parseEntry(entry());
    assert.equal(parsed?.gameId, 'espn-epl-1');
    assert.equal(parsed?.label, 'Chelsea v Arsenal');
  });

  it('rejects an id that would not resolve to a game page', () => {
    // The same validator the game routes use, so a starred entry can never
    // become a broken link or a traversal attempt.
    assert.equal(parseEntry(entry({ gameId: '../../etc/passwd' })), null);
    assert.equal(parseEntry(entry({ gameId: '' })), null);
    assert.equal(parseEntry(entry({ gameId: 'arsenal-vs-spurs' })), null);
  });

  it('requires a label to render', () => {
    assert.equal(parseEntry(entry({ label: '   ' })), null);
    assert.equal(parseEntry({ gameId: 'espn-epl-1' }), null);
  });

  it('clamps oversized text so one add cannot bloat the file', () => {
    const parsed = parseEntry(entry({ label: 'A'.repeat(500) }));
    assert.ok(parsed);
    assert.ok(parsed.label.length <= 120, `label was ${parsed.label.length}`);
  });

  it('normalises a bad timestamp to null rather than storing it', () => {
    assert.equal(parseEntry(entry({ startTime: 'kick-off time' }))?.startTime, null);
  });

  it('rejects anything that is not an object', () => {
    for (const raw of [null, undefined, 'x', 42, []]) {
      assert.equal(parseEntry(raw), null);
    }
  });
});

describe('reading a stored watchlist', () => {
  it('accepts both a bare array and a wrapped object', () => {
    assert.equal(parseWatchlist([entry()]).length, 1);
    assert.equal(parseWatchlist({ entries: [entry()] }).length, 1);
  });

  it('drops unusable entries instead of failing the whole read', () => {
    const parsed = parseWatchlist([entry(), { gameId: 'nope' }, null, entry({ gameId: '2398051' })]);
    assert.deepEqual(
      parsed.map((item) => item.gameId),
      ['espn-epl-1', '2398051'],
    );
  });

  it('de-duplicates, so a game cannot notify twice', () => {
    const parsed = parseWatchlist([entry(), entry()]);
    assert.equal(parsed.length, 1);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_ENTRIES + 50 }, (_, i) =>
      entry({ gameId: `espn-epl-${i}` }),
    );
    assert.equal(parseWatchlist(many).length, MAX_ENTRIES);
  });

  it('returns empty for junk', () => {
    assert.deepEqual(parseWatchlist(null), []);
    assert.deepEqual(parseWatchlist('nonsense'), []);
    assert.deepEqual(parseWatchlist({}), []);
  });
});

describe('ordering', () => {
  it('sorts by kick-off, with unknown times last', () => {
    const sorted = sortEntries([
      entry({ gameId: 'espn-epl-3', startTime: null, label: 'C' }),
      entry({ gameId: 'espn-epl-2', startTime: '2026-09-02T19:00:00.000Z', label: 'B' }),
      entry({ gameId: 'espn-epl-1', startTime: '2026-09-02T14:00:00.000Z', label: 'A' }),
    ]);
    assert.deepEqual(
      sorted.map((item) => item.label),
      ['A', 'B', 'C'],
    );
  });
});

describe('pruning', () => {
  const settled = (pairs: [string, 'finished' | 'cancelled'][]) => new Map(pairs);

  it('removes a game that finished', () => {
    const { kept, removed } = pruneWatchlist(
      [entry()],
      settled([['espn-epl-1', 'finished']]),
      NOW,
    );
    assert.deepEqual(kept, []);
    assert.equal(removed[0].reason, 'finished');
  });

  it('removes a game that was cancelled', () => {
    const { kept, removed } = pruneWatchlist(
      [entry()],
      settled([['espn-epl-1', 'cancelled']]),
      NOW,
    );
    assert.deepEqual(kept, []);
    assert.equal(removed[0].reason, 'cancelled');
  });

  it('keeps a game still in progress', () => {
    const { kept, removed } = pruneWatchlist([entry()], settled([]), NOW);
    assert.equal(kept.length, 1);
    assert.deepEqual(removed, []);
  });

  it('keeps a game that has not started yet', () => {
    const future = entry({ startTime: '2026-09-05T14:00:00.000Z' });
    assert.equal(pruneWatchlist([future], settled([]), NOW).kept.length, 1);
  });

  it('drops a fixture the poller never saw finish', () => {
    // The safety net: a postponement that is never rescheduled, or a game that
    // simply falls out of the provider feed, must not sit on the list forever.
    const stale = entry({ startTime: new Date(NOW - STALE_AFTER_MS - 1000).toISOString() });
    const { kept, removed } = pruneWatchlist([stale], settled([]), NOW);
    assert.deepEqual(kept, []);
    assert.equal(removed[0].reason, 'stale');
  });

  it('keeps a long-running game just inside the staleness window', () => {
    const recent = entry({ startTime: new Date(NOW - STALE_AFTER_MS + 60_000).toISOString() });
    assert.equal(pruneWatchlist([recent], settled([]), NOW).kept.length, 1);
  });

  it('keeps an entry with no start time until it settles', () => {
    // No timestamp means the staleness rule cannot apply; only a terminal
    // status removes it.
    const undated = entry({ startTime: null });
    assert.equal(pruneWatchlist([undated], settled([]), NOW).kept.length, 1);
    assert.equal(
      pruneWatchlist([undated], settled([['espn-epl-1', 'finished']]), NOW).kept.length,
      0,
    );
  });

  it('leaves a postponed game alone', () => {
    // Postponed fixtures are usually rescheduled under the same id, so they
    // stay watched and the staleness rule removes them if they never resume.
    const { kept } = pruneWatchlist([entry()], settled([]), NOW);
    assert.equal(kept.length, 1);
  });
});
