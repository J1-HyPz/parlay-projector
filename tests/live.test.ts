import assert from 'node:assert/strict';
import { sidesOf } from '../lib/home/types.ts';
import { describe, it } from 'node:test';

import {
  clockLabel,
  describeGameState,
  enrichFromFixture,
  isLiveRow,
  normaliseLiveResponse,
  normaliseLiveRow,
  periodLabel,
  selectUpcomingToday,
  sortLiveGames,
} from '../lib/live/normalise.ts';
import type { RawLiveRow } from '../lib/live/normalise.ts';
import { normaliseStatus } from '../lib/home/sports/normalise.ts';
import type { Game } from '../lib/home/types';
import type { LiveGame } from '../lib/live/types';

/** Shaped from a real livescore.php row. */
function row(overrides: Partial<RawLiveRow> = {}): RawLiveRow {
  return {
    idEvent: '2481672',
    strSport: 'Soccer',
    idLeague: '4688',
    strLeague: 'Peruvian Primera Division',
    idHomeTeam: '138313',
    idAwayTeam: '138323',
    strHomeTeam: 'Atletico Grau',
    strAwayTeam: 'Melgar',
    strHomeTeamBadge: 'https://example.test/h.png',
    strAwayTeamBadge: 'https://example.test/a.png',
    intHomeScore: '1',
    intAwayScore: '0',
    strStatus: '1H',
    strProgress: '26',
    strTimestamp: '2026-09-01T20:00:00',
    dateEvent: '2026-09-01',
    strEventTime: '20:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Only live games belong on the Live page
// ---------------------------------------------------------------------------

describe('live status filtering', () => {
  it('includes a game in progress', () => {
    assert.equal(isLiveRow(row({ strStatus: '1H' })), true);
    assert.equal(isLiveRow(row({ strStatus: '2H' })), true);
    assert.equal(isLiveRow(row({ strStatus: 'HT' })), true);
    assert.equal(isLiveRow(row({ strStatus: 'ET' })), true);
    assert.equal(isLiveRow(row({ strStatus: 'Q3' })), true);
    assert.equal(isLiveRow(row({ strStatus: 'P2' })), true);
  });

  it('excludes a scheduled game', () => {
    assert.equal(isLiveRow(row({ strStatus: 'NS' })), false);
  });

  it('excludes a finished game', () => {
    assert.equal(isLiveRow(row({ strStatus: 'FT' })), false);
    assert.equal(isLiveRow(row({ strStatus: 'AOT' })), false);
  });

  it('excludes postponed and cancelled games', () => {
    assert.equal(isLiveRow(row({ strStatus: 'PPD' })), false);
    assert.equal(isLiveRow(row({ strStatus: 'CANC' })), false);
  });

  it('treats a penalty shootout in progress as live', () => {
    assert.equal(normaliseStatus('P'), 'live');
    assert.equal(isLiveRow(row({ strStatus: 'P' })), true);
  });

  it('filters a mixed feed down to live rows only', () => {
    const games = normaliseLiveResponse(
      {
        livescore: [
          row({ idEvent: '1', strStatus: '2H' }),
          row({ idEvent: '2', strStatus: 'NS' }),
          row({ idEvent: '3', strStatus: 'FT' }),
          row({ idEvent: '4', strStatus: 'HT' }),
        ],
      },
      'football',
    );
    assert.deepEqual(games.map((g) => g.id), ['1', '4']);
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe('live game normalisation', () => {
  it('maps a live row onto the contract', () => {
    const game = normaliseLiveRow(row(), 'football');
    assert.ok(game);
    assert.equal(game.id, '2481672');
    assert.equal(game.sport, 'football');
    assert.equal(game.status, 'live');
    assert.equal(game.provider_status, '1H');
    assert.equal(game.league, 'Peruvian Primera Division');
    const sides = sidesOf(game);
    assert.ok(sides, 'a football fixture has two sides');
    assert.equal(sides.home.name, 'Atletico Grau');
    assert.equal(sides.away.name, 'Melgar');
    assert.deepEqual(game.score, { home: 1, away: 0 });
    assert.equal(game.start_time, '2026-09-01T20:00:00.000Z');
  });

  it('keeps a genuine nil-nil score rather than treating it as missing', () => {
    const game = normaliseLiveRow(row({ intHomeScore: '0', intAwayScore: '0' }), 'football');
    assert.deepEqual(game?.score, { home: 0, away: 0 });
  });

  it('reports an absent score as null, never zero or NaN', () => {
    const game = normaliseLiveRow(row({ intHomeScore: '', intAwayScore: null }), 'football');
    assert.deepEqual(game?.score, { home: null, away: null });
  });

  it('returns null for rows that are not usable games', () => {
    assert.equal(normaliseLiveRow(row({ idEvent: null }), 'football'), null);
    assert.equal(normaliseLiveRow(row({ strHomeTeam: '', strAwayTeam: '' }), 'football'), null);
    assert.equal(normaliseLiveRow({}, 'football'), null);
  });

  it('handles an empty or malformed provider response', () => {
    assert.deepEqual(normaliseLiveResponse({ livescore: null }, 'football'), []);
    assert.deepEqual(normaliseLiveResponse({}, 'football'), []);
    assert.deepEqual(normaliseLiveResponse(null, 'football'), []);
    assert.deepEqual(normaliseLiveResponse(undefined, 'football'), []);
  });

  it('exposes no betting or prediction fields', () => {
    const game = normaliseLiveRow(row(), 'football');
    assert.ok(game);
    for (const key of [
      'odds', 'moneyline', 'spread', 'totals', 'bookmaker', 'markets',
      'prediction', 'confidence', 'projected_winner',
    ]) {
      assert.equal(key in game, false, `live game must not expose "${key}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// Sport-aware game state
// ---------------------------------------------------------------------------

describe('game state', () => {
  it('describes a football match by minute and half', () => {
    const state = describeGameState('football', '2H', '68');
    assert.equal(state.clock, "68'");
    assert.equal(state.period, 'Second Half');
    assert.equal(state.display, "68' • Second Half");
  });

  it('handles first half and extra time', () => {
    assert.equal(describeGameState('football', '1H', '26').display, "26' • First Half");
    assert.equal(describeGameState('football', 'ET', '112').display, "112' • Extra Time");
    assert.equal(describeGameState('football', 'P', null).display, 'Penalties');
  });

  it('describes basketball and gridiron quarters', () => {
    assert.equal(periodLabel('nba', 'Q3'), 'Q3');
    assert.equal(describeGameState('nba', 'Q3', null).display, 'Q3');
    assert.equal(describeGameState('nfl', 'Q4', null).display, 'Q4');
  });

  it('describes hockey periods', () => {
    assert.equal(periodLabel('nhl', 'P2'), 'Period 2');
    assert.equal(describeGameState('nhl', 'P2', null).display, 'Period 2');
  });

  it('describes baseball innings', () => {
    assert.equal(periodLabel('mlb', '7I'), 'Inning 7');
    assert.equal(describeGameState('mlb', '7I', null).display, 'Inning 7');
  });

  it('describes half time', () => {
    assert.equal(describeGameState('football', 'HT', null).display, 'Half Time');
  });

  it('returns nothing rather than inventing state when the provider is silent', () => {
    const state = describeGameState('tennis', null, null);
    assert.equal(state.display, null);
    assert.equal(state.period, null);
    assert.equal(state.clock, null);

    assert.equal(periodLabel('nba', 'WEIRD'), null);
    assert.equal(clockLabel('nba', ''), null);
    assert.equal(clockLabel('football', null), null);
  });

  it('does not add a minute mark to non-football progress values', () => {
    assert.equal(clockLabel('nhl', '10:45'), '10:45');
    assert.equal(clockLabel('football', '68'), "68'");
  });
});

// ---------------------------------------------------------------------------
// Enrichment from today's fixtures
// ---------------------------------------------------------------------------

describe('fixture enrichment', () => {
  const fixture: Game = {
    id: '2481672',
    sport: 'football',
    league: 'Peruvian Primera Division',
    league_badge: 'https://example.test/league.png',
    season: '2026',
    round: '7',
    start_time: '2026-09-01T20:00:00.000Z',
    status: 'scheduled',
    provider_status: 'NS',
    home_team: { id: '138313', name: 'Atletico Grau', logo: null },
    away_team: { id: '138323', name: 'Melgar', logo: null },
    venue: { name: 'Estadio Municipal', city: 'Piura', country: 'Peru' },
    broadcast: null,
  };

  it('adds venue and round without touching live score or state', () => {
    const live = normaliseLiveRow(row(), 'football') as LiveGame;
    const enriched = enrichFromFixture(live, fixture);

    assert.equal(enriched.venue.name, 'Estadio Municipal');
    assert.equal(enriched.venue.city, 'Piura');
    assert.equal(enriched.round, '7');
    assert.equal(enriched.season, '2026');

    // Live data wins.
    assert.equal(enriched.status, 'live');
    assert.deepEqual(enriched.score, { home: 1, away: 0 });
    assert.equal(enriched.game_state.display, "26' • First Half");
  });

  it('is a no-op when no fixture is cached', () => {
    const live = normaliseLiveRow(row(), 'football') as LiveGame;
    const enriched = enrichFromFixture(live, undefined);
    assert.equal(enriched.venue.name, null);
    assert.equal(enriched.id, live.id);
  });
});

// ---------------------------------------------------------------------------
// Refresh behaviour
// ---------------------------------------------------------------------------

describe('refresh transitions', () => {
  const feed = (rows: RawLiveRow[]) => normaliseLiveResponse({ livescore: rows }, 'football');

  it('replaces a previous score with the new one', () => {
    const before = feed([row({ idEvent: '1', intHomeScore: '1', intAwayScore: '0' })]);
    const after = feed([row({ idEvent: '1', intHomeScore: '2', intAwayScore: '0' })]);
    assert.deepEqual(before[0].score, { home: 1, away: 0 });
    assert.deepEqual(after[0].score, { home: 2, away: 0 });
    assert.equal(after[0].id, before[0].id, 'the same game keeps its id across refreshes');
  });

  it('drops a game that has finished', () => {
    const before = feed([row({ idEvent: '1', strStatus: '2H' })]);
    const after = feed([row({ idEvent: '1', strStatus: 'FT' })]);
    assert.equal(before.length, 1);
    assert.equal(after.length, 0);
  });

  it('adds a game that has kicked off', () => {
    const before = feed([row({ idEvent: '1', strStatus: 'NS' })]);
    const after = feed([row({ idEvent: '1', strStatus: '1H' })]);
    assert.equal(before.length, 0);
    assert.equal(after.length, 1);
  });

  it('advances the clock between refreshes', () => {
    const before = feed([row({ idEvent: '1', strProgress: '26' })]);
    const after = feed([row({ idEvent: '1', strProgress: '31' })]);
    assert.equal(before[0].game_state.clock, "26'");
    assert.equal(after[0].game_state.clock, "31'");
  });
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

describe('ordering', () => {
  it('is stable across refreshes and independent of score', () => {
    const games = normaliseLiveResponse(
      {
        livescore: [
          row({ idEvent: 'c', strLeague: 'B League', strTimestamp: '2026-09-01T21:00:00' }),
          row({ idEvent: 'a', strLeague: 'A League', strTimestamp: '2026-09-01T20:00:00' }),
          row({ idEvent: 'b', strLeague: 'A League', strTimestamp: '2026-09-01T21:00:00' }),
        ],
      },
      'football',
    );
    assert.deepEqual(sortLiveGames(games).map((g) => g.id), ['a', 'b', 'c']);

    // A score change must not reorder the board.
    const rescored = games.map((g) => ({ ...g, score: { home: 9, away: 0 } }));
    assert.deepEqual(sortLiveGames(rescored).map((g) => g.id), ['a', 'b', 'c']);
  });
});

// ---------------------------------------------------------------------------
// Upcoming today
// ---------------------------------------------------------------------------

describe('upcoming today', () => {
  const LONDON = 'Europe/London';
  // 18:00 BST on 1 September.
  const now = new Date('2026-09-01T17:00:00.000Z');

  function fixture(overrides: Partial<Game> = {}): Game {
    return {
      id: 'f1',
      sport: 'football',
      league: 'Premier League',
      league_badge: null,
      season: '2026',
      round: '4',
      start_time: '2026-09-01T19:00:00.000Z',
      status: 'scheduled',
      provider_status: 'NS',
      home_team: { id: '1', name: 'Arsenal', logo: null },
      away_team: { id: '2', name: 'Chelsea', logo: null },
      venue: { name: 'Emirates', city: 'London', country: 'England' },
      broadcast: null,
      ...overrides,
    };
  }

  it('includes a scheduled game later today', () => {
    const upcoming = selectUpcomingToday([fixture()], LONDON, now);
    assert.equal(upcoming.length, 1);
    assert.equal(upcoming[0].id, 'f1');
  });

  it('excludes games that are not scheduled', () => {
    for (const status of ['live', 'finished', 'postponed', 'cancelled', 'unknown'] as const) {
      assert.equal(selectUpcomingToday([fixture({ status })], LONDON, now).length, 0, status);
    }
  });

  it('excludes a game on a different day', () => {
    // Tomorrow.
    assert.equal(
      selectUpcomingToday([fixture({ start_time: '2026-09-02T19:00:00.000Z' })], LONDON, now).length,
      0,
    );
    // Yesterday.
    assert.equal(
      selectUpcomingToday([fixture({ start_time: '2026-08-31T19:00:00.000Z' })], LONDON, now).length,
      0,
    );
  });

  it('excludes a game whose kick-off is well past', () => {
    // 14:00Z is three hours before `now`, beyond the grace period.
    assert.equal(
      selectUpcomingToday([fixture({ start_time: '2026-09-01T14:00:00.000Z' })], LONDON, now).length,
      0,
    );
  });

  it('keeps a game whose kick-off just passed but has not gone live yet', () => {
    // Five minutes ago: inside the grace period, so it does not vanish from
    // both lists while the provider catches up.
    assert.equal(
      selectUpcomingToday([fixture({ start_time: '2026-09-01T16:55:00.000Z' })], LONDON, now).length,
      1,
    );
  });

  it('uses the local day, not the UTC day', () => {
    // 23:30Z on 1 September is 00:30 on 2 September in London, so relative to a
    // London "now" late on the 1st it is not today.
    const lateNow = new Date('2026-09-01T22:00:00.000Z');
    assert.equal(
      selectUpcomingToday(
        [fixture({ start_time: '2026-09-01T23:30:00.000Z' })],
        LONDON,
        lateNow,
      ).length,
      0,
    );
  });

  it('excludes a fixture with no start time, since it cannot be placed on a day', () => {
    assert.equal(selectUpcomingToday([fixture({ start_time: null })], LONDON, now).length, 0);
  });

  it('sorts by kick-off', () => {
    const upcoming = selectUpcomingToday(
      [
        fixture({ id: 'c', start_time: '2026-09-01T21:00:00.000Z' }),
        fixture({ id: 'a', start_time: '2026-09-01T18:00:00.000Z' }),
        fixture({ id: 'b', start_time: '2026-09-01T19:30:00.000Z' }),
      ],
      LONDON,
      now,
    );
    assert.deepEqual(upcoming.map((g) => g.id), ['a', 'b', 'c']);
  });

  it('returns nothing for an empty fixture list', () => {
    assert.deepEqual(selectUpcomingToday([], LONDON, now), []);
  });
});
