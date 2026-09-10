import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  seasonComplete,
  seasonWindow,
  seasonsToArchive,
} from '../lib/history/season.ts';
import { isArchivableGame, parseSeasonFile } from '../lib/history/store-parse.ts';

/*
 * Subjects, not sports. A season boundary is a fact about a competition: the
 * CFL is `sport: 'nfl'` and plays a summer schedule, so the sport alone is not
 * enough to place a season.
 */
const NFL = { id: 'nfl', sport: 'nfl' } as const;
const MLB = { id: 'mlb', sport: 'mlb' } as const;
const FOOTBALL = { id: 'epl', sport: 'football' } as const;
const CFL = { id: 'cfl', sport: 'nfl' } as const;

describe('season windows', () => {
  it('ends a football season in the following year', () => {
    // 2024 means 2024-25. Getting this wrong files the second half of every
    // season under the wrong year, or loses it entirely.
    const window = seasonWindow(FOOTBALL, 2024);
    assert.equal(window.season, '2024');
    assert.equal(window.startDate, '2024-07-01');
    assert.equal(window.endDate, '2025-06-30');
    assert.equal(window.crossesYear, true);
  });

  it('keeps a baseball season inside one calendar year', () => {
    // The one sport here that does not cross the new year.
    const window = seasonWindow(MLB, 2024);
    assert.equal(window.startDate.slice(0, 4), '2024');
    assert.equal(window.endDate.slice(0, 4), '2024');
    assert.equal(window.crossesYear, false);
  });

  it('carries the NFL season past the new year for the play-offs', () => {
    // A window closing in December would drop the entire post-season.
    const window = seasonWindow(NFL, 2024);
    assert.equal(window.endDate, '2025-02-28');
  });

  it('treats a season as complete only once its window has closed', () => {
    const window = seasonWindow(MLB, 2025);
    assert.equal(seasonComplete(window, '2025-08-01'), false, 'still being played');
    assert.equal(seasonComplete(window, '2026-01-05'), true);
  });
});

describe('a competition whose calendar is not its sport', () => {
  it('gives the CFL its own summer window rather than the NFL winter one', () => {
    /*
     * Found by a number that did not look right: the CFL archived 27 games for
     * a season a nine-team league plays 81 of. It carries `sport: 'nfl'` and
     * so inherited an August-to-February window, which clipped a June-to-
     * November season. Nothing errored — the file was written faithfully from
     * a wrong question, which is why validation could never have caught it.
     */
    const cfl = seasonWindow(CFL, 2025);
    const nfl = seasonWindow(NFL, 2025);

    assert.equal(cfl.crossesYear, false, 'the Grey Cup is in November, not February');
    assert.ok(cfl.startDate < '2025-06-01', 'must open before the June kick-off');
    assert.ok(cfl.endDate > '2025-11-30', 'and close after the Grey Cup');
    assert.notEqual(cfl.startDate, nfl.startDate);
  });
});

describe('choosing seasons to archive', () => {
  it('returns completed seasons only, newest first', () => {
    // Mid-2026: the 2026 baseball season is still running and must not be
    // written to a file that claims to hold a whole season.
    const seasons = seasonsToArchive(MLB, '2026-09-10', 3).map((w) => w.season);
    assert.deepEqual(seasons, ['2025', '2024', '2023']);
  });

  it('stops at the requested depth', () => {
    assert.equal(seasonsToArchive(FOOTBALL, '2026-09-10', 5).length, 5);
    assert.equal(seasonsToArchive(FOOTBALL, '2026-09-10', 2).length, 2);
  });

  it('skips a season still in progress for a sport that crosses the year', () => {
    // In September 2026 the 2026-27 football season has only just begun, so
    // the newest complete one is 2025-26.
    assert.equal(seasonsToArchive(FOOTBALL, '2026-09-10', 1)[0].season, '2025');
  });

  it('returns nothing for an unusable date rather than guessing a year', () => {
    assert.deepEqual(seasonsToArchive(MLB, 'not-a-date', 3), []);
  });
});

describe('archive validation', () => {
  const game = (overrides: Record<string, unknown> = {}) => ({
    id: 'espn-mlb-1',
    sport: 'mlb',
    status: 'finished',
    start_time: '2025-05-01T18:00:00.000Z',
    score: { home: 4, away: 2 },
    ...overrides,
  });

  it('requires the fields the archive exists to answer questions about', () => {
    assert.equal(isArchivableGame(game()), true);
    // No time means the fixture cannot be placed in a season at all.
    assert.equal(isArchivableGame(game({ start_time: null })), false);
    assert.equal(isArchivableGame(game({ id: '' })), false);
    assert.equal(isArchivableGame(game({ status: 'invented' })), false);
    assert.equal(isArchivableGame(game({ score: { home: 'four', away: 2 } })), false);
  });

  it('accepts a fixture with no score, which is a real state', () => {
    // Postponed and cancelled fixtures belong in the archive as themselves.
    assert.equal(isArchivableGame(game({ status: 'postponed', score: null })), true);
  });

  it('reads a well-formed season file', () => {
    const parsed = parseSeasonFile({
      league_id: 'mlb',
      season: '2025',
      fetched_at: '2026-09-10T00:00:00.000Z',
      games: [game(), game({ id: 'espn-mlb-2' })],
    });
    assert.equal(parsed?.games.length, 2);
    assert.equal(parsed?.season, '2025');
  });

  it('accepts a genuinely empty season', () => {
    // A competition can have no completed fixtures in a window — the AFLE and
    // EFA before they existed. That is a fact, not a damaged file.
    const parsed = parseSeasonFile({ league_id: 'afle', season: '2023', games: [] });
    assert.equal(parsed?.games.length, 0);
  });

  it('rejects a file that has lost too many games rather than thinning it', () => {
    /*
     * The failure this validation exists for. A season quietly missing a
     * third of its games would move any constant fitted from it, and nothing
     * downstream could tell — so the file is refused whole and re-fetched,
     * rather than returned looking complete.
     */
    const good = Array.from({ length: 6 }, (_, i) => game({ id: `g${i}` }));
    const broken = Array.from({ length: 4 }, () => ({ id: 'x' }));
    assert.equal(parseSeasonFile({ league_id: 'mlb', season: '2025', games: [...good, ...broken] }), null);
  });

  it('tolerates the odd malformed fixture', () => {
    // One bad entry in a season should not cost four months of good results.
    const good = Array.from({ length: 99 }, (_, i) => game({ id: `g${i}` }));
    const parsed = parseSeasonFile({
      league_id: 'mlb',
      season: '2025',
      games: [...good, { id: 'broken' }],
    });
    assert.equal(parsed?.games.length, 99);
  });

  it('refuses a file with no competition or season to key it by', () => {
    assert.equal(parseSeasonFile({ season: '2025', games: [] }), null);
    assert.equal(parseSeasonFile({ league_id: 'mlb', games: [] }), null);
    assert.equal(parseSeasonFile(null), null);
    assert.equal(parseSeasonFile({ league_id: 'mlb', season: '2025', games: 'lots' }), null);
  });
});
