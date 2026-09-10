import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MIN_MEETINGS,
  headToHeadPattern,
  meetingsBetween,
  summariseMeetings,
} from '../lib/history/head-to-head.ts';
import type { Game } from '../lib/home/types';

const ARSENAL = { id: '359', name: 'Arsenal' };
const CHELSEA = { id: '363', name: 'Chelsea' };

function game(overrides: Partial<Game> & Record<string, unknown> = {}): Game {
  return {
    id: Math.random().toString(36).slice(2),
    sport: 'football',
    league: 'Premier League',
    league_badge: null,
    season: '2024',
    round: null,
    start_time: '2024-10-01T14:00:00.000Z',
    status: 'finished',
    provider_status: 'FT',
    home_team: { id: '359', name: 'Arsenal', logo: null },
    away_team: { id: '363', name: 'Chelsea', logo: null },
    venue: { name: null, city: null, country: null },
    broadcast: null,
    score: { home: 2, away: 1 },
    ...overrides,
  } as Game;
}

describe('finding meetings in the archive', () => {
  it('finds a pair whichever way round they lined up', () => {
    const games = [
      game({ id: 'a', start_time: '2024-10-01T14:00:00.000Z' }),
      game({
        id: 'b',
        start_time: '2025-03-01T14:00:00.000Z',
        home_team: { id: '363', name: 'Chelsea', logo: null },
        away_team: { id: '359', name: 'Arsenal', logo: null },
        score: { home: 0, away: 3 },
      }),
    ];

    const meetings = meetingsBetween(games, ARSENAL, CHELSEA);
    assert.equal(meetings.length, 2);
    // Newest first.
    assert.equal(meetings[0].id, 'b');
  });

  it('ignores fixtures involving only one of the two', () => {
    const games = [
      game({ id: 'a' }),
      game({ id: 'other', away_team: { id: '999', name: 'Everton', logo: null } }),
    ];
    assert.deepEqual(
      meetingsBetween(games, ARSENAL, CHELSEA).map((m) => m.id),
      ['a'],
    );
  });

  it('matches on id even when the provider has renamed a club', () => {
    // A provider renames a club far more readily than it renumbers one.
    const games = [game({ home_team: { id: '359', name: 'Arsenal FC', logo: null } })];
    assert.equal(meetingsBetween(games, ARSENAL, CHELSEA).length, 1);
  });

  it('counts only a fixture that was actually played to a result', () => {
    const games = [
      game({ id: 'played' }),
      // A postponement is not a result, and a fixture with no score is not one
      // either — counting them would put games nobody played into a record.
      game({ id: 'off', status: 'postponed', score: undefined }),
      game({ id: 'scoreless', status: 'finished', score: { home: null, away: null } as never }),
    ];
    assert.deepEqual(
      meetingsBetween(games, ARSENAL, CHELSEA).map((m) => m.id),
      ['played'],
    );
  });
});

describe('tallying a record', () => {
  const played = (results: [number, number][], homeIsArsenal = true) =>
    results.map(([h, a], index) =>
      game({
        id: `g${index}`,
        start_time: `202${index}-05-01T14:00:00.000Z`,
        home_team: homeIsArsenal
          ? { id: '359', name: 'Arsenal', logo: null }
          : { id: '363', name: 'Chelsea', logo: null },
        away_team: homeIsArsenal
          ? { id: '363', name: 'Chelsea', logo: null }
          : { id: '359', name: 'Arsenal', logo: null },
        score: { home: h, away: a },
      }),
    );

  it('counts by who won, not by who was at home', () => {
    // Three Arsenal home wins and two Arsenal away wins is five wins.
    const games = [...played([[2, 1], [3, 0], [1, 0]]), ...played([[0, 1], [1, 2]], false)];
    const record = summariseMeetings(meetingsBetween(games, ARSENAL, CHELSEA), ARSENAL);

    assert.equal(record.played, 5);
    assert.equal(record.wins, 5);
    assert.equal(record.losses, 0);
  });

  it('reports the tally from the subject side, so the mirror is the inverse', () => {
    const games = played([[2, 1], [0, 3], [1, 1]]);
    const meetings = meetingsBetween(games, ARSENAL, CHELSEA);

    const arsenal = summariseMeetings(meetings, ARSENAL);
    const chelsea = summariseMeetings(meetings, CHELSEA);

    assert.deepEqual(
      [arsenal.wins, arsenal.draws, arsenal.losses],
      [chelsea.losses, chelsea.draws, chelsea.wins],
    );
  });

  it('carries the years the record spans', () => {
    const record = summariseMeetings(
      meetingsBetween(played([[1, 0], [2, 0], [3, 0]]), ARSENAL, CHELSEA),
      ARSENAL,
    );
    assert.equal(record.from, '2020');
    assert.equal(record.to, '2022');
  });
});

describe('when a pattern is worth stating', () => {
  const record = (wins: number, losses: number, draws = 0) => ({
    meetings: [],
    played: wins + losses + draws,
    wins,
    losses,
    draws,
    from: '2021',
    to: '2025',
  });

  it('says nothing from a thin record', () => {
    /*
     * The usual answer, and deliberately so. Most pairs have met four times in
     * five years, and "they have won three of four" is noise dressed as a
     * finding — exactly what the rest of this application refuses to print.
     */
    assert.equal(headToHeadPattern(record(3, 1), 'Arsenal', 'Chelsea'), null);
    assert.equal(headToHeadPattern(record(MIN_MEETINGS - 1, 0), 'Arsenal', 'Chelsea'), null);
  });

  it('says nothing from an even record, however long', () => {
    assert.equal(headToHeadPattern(record(5, 5), 'Arsenal', 'Chelsea'), null);
    assert.equal(headToHeadPattern(record(4, 3, 3), 'Arsenal', 'Chelsea'), null);
  });

  it('states a clear skew, with the count in the sentence', () => {
    const text = headToHeadPattern(record(6, 1), 'Arsenal', 'Chelsea');
    assert.ok(text?.includes('Arsenal'));
    // The count travels with the claim so a reader can discount it themselves.
    assert.ok(text?.includes('6'));
    assert.ok(text?.includes('7'));
  });

  it('states the skew the other way round when it runs that way', () => {
    const text = headToHeadPattern(record(1, 6), 'Arsenal', 'Chelsea');
    assert.ok(text?.startsWith('Chelsea'), text ?? 'null');
  });
});
