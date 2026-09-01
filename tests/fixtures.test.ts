import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  compactDate,
  espnGameId,
  isEspnGameId,
  normaliseFixture,
  normaliseFixtures,
  parseEspnGameId,
  statusFromEspn,
} from '../lib/providers/espn/fixtures.ts';
import type { RawFixtureEvent } from '../lib/providers/espn/fixtures.ts';
import { findLeague } from '../lib/leagues/registry.ts';
import type { League } from '../lib/leagues/registry.ts';
import { isValidGameId } from '../lib/games/normalise.ts';

const nfl = findLeague('nfl') as League;
const leagueOne = findLeague('league-one') as League;

describe('namespaced game ids', () => {
  it('round-trips through build and parse', () => {
    const id = espnGameId('nfl', '401779');
    assert.equal(id, 'espn-nfl-401779');
    assert.deepEqual(parseEspnGameId(id), { leagueId: 'nfl', eventId: '401779' });
  });

  it('handles a league id that itself contains a hyphen', () => {
    const id = espnGameId('league-one', '77');
    assert.equal(id, 'espn-league-one-77');
    assert.deepEqual(parseEspnGameId(id), { leagueId: 'league-one', eventId: '77' });
  });

  it('rejects malformed ids', () => {
    assert.equal(parseEspnGameId('espn-nfl-abc'), null);
    assert.equal(parseEspnGameId('espn-401779'), null, 'a league is required');
    assert.equal(parseEspnGameId('401779'), null);
    assert.equal(parseEspnGameId('espn-'), null);
  });

  it('distinguishes ESPN ids from the primary provider', () => {
    assert.equal(isEspnGameId('espn-nfl-1'), true);
    assert.equal(isEspnGameId('2398051'), false);
  });

  it('keeps existing bare-numeric links valid', () => {
    assert.equal(isValidGameId('2398051'), true, 'pre-existing links must not break');
    assert.equal(isValidGameId('espn-nfl-401779'), true);
    assert.equal(isValidGameId('espn-league-one-77'), true);
    assert.equal(isValidGameId('../../etc/passwd'), false);
    assert.equal(isValidGameId('arsenal-vs-spurs'), false);
  });
});

describe('espn status mapping', () => {
  it('maps the vocabulary onto internal statuses', () => {
    assert.equal(statusFromEspn({ name: 'STATUS_SCHEDULED', state: 'pre' }), 'scheduled');
    assert.equal(statusFromEspn({ name: 'STATUS_IN_PROGRESS', state: 'in' }), 'live');
    assert.equal(statusFromEspn({ name: 'STATUS_HALFTIME', state: 'in' }), 'live');
    assert.equal(
      statusFromEspn({ name: 'STATUS_FINAL', state: 'post', completed: true }),
      'finished',
    );
    assert.equal(statusFromEspn({ name: 'STATUS_POSTPONED' }), 'postponed');
    assert.equal(statusFromEspn({ name: 'STATUS_CANCELED' }), 'cancelled');
  });

  it('falls back to the coarse state', () => {
    assert.equal(statusFromEspn({ state: 'pre' }), 'scheduled');
    assert.equal(statusFromEspn({ state: 'in' }), 'live');
    assert.equal(statusFromEspn({ state: 'post', completed: true }), 'finished');
  });

  it('does not guess when nothing is recognisable', () => {
    assert.equal(statusFromEspn(undefined), 'unknown');
    assert.equal(statusFromEspn({ name: 'WEIRD' }), 'unknown');
  });
});

/** Shaped from a real ESPN NFL scoreboard response. */
function event(overrides: Record<string, unknown> = {}): RawFixtureEvent {
  return {
    id: '401779',
    date: '2026-09-07T17:00Z',
    season: { year: 2026 },
    week: { number: 1 },
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', shortDetail: 'Sun 1:00 PM' } },
    competitions: [
      {
        venue: {
          fullName: 'Highmark Stadium',
          address: { city: 'Orchard Park', country: 'USA' },
        },
        broadcasts: [{ names: ['CBS'] }],
        competitors: [
          {
            homeAway: 'home',
            score: '0',
            team: { id: '2', displayName: 'Buffalo Bills', abbreviation: 'BUF', logo: 'b.png' },
          },
          {
            homeAway: 'away',
            score: '0',
            team: {
              id: '12',
              displayName: 'Kansas City Chiefs',
              abbreviation: 'KC',
              logo: 'k.png',
            },
          },
        ],
      },
    ],
    ...overrides,
  } as RawFixtureEvent;
}

describe('fixture normalisation', () => {
  it('maps an NFL fixture into the shared game model', () => {
    const game = normaliseFixture(event(), nfl);
    assert.ok(game);
    assert.equal(game.id, 'espn-nfl-401779');
    assert.equal(game.sport, 'nfl');
    assert.equal(game.league, 'NFL', 'uses the catalogue label, not the provider slug');
    assert.equal(game.season, '2026');
    assert.equal(game.round, '1');
    assert.equal(game.status, 'scheduled');
    assert.equal(game.home_team.name, 'Buffalo Bills');
    assert.equal(game.away_team.name, 'Kansas City Chiefs');
    assert.equal(game.venue.name, 'Highmark Stadium');
    assert.equal(game.venue.city, 'Orchard Park');
    assert.equal(game.broadcast, 'CBS');
    assert.equal(game.start_time, '2026-09-07T17:00:00.000Z');
  });

  it('exposes no betting fields', () => {
    const game = normaliseFixture(event(), nfl);
    assert.ok(game);
    const serialised = JSON.stringify(game);
    for (const term of ['odds', 'moneyline', 'spread', 'pickcenter']) {
      assert.equal(serialised.includes(term), false, `"${term}" must not appear`);
    }
  });

  it('drops rows that are not usable games', () => {
    assert.equal(normaliseFixture({} as RawFixtureEvent, nfl), null);
    assert.equal(normaliseFixture(event({ id: null }), nfl), null);
    assert.equal(normaliseFixture(event({ competitions: [{ competitors: [] }] }), nfl), null);
  });

  it('handles malformed responses', () => {
    assert.deepEqual(normaliseFixtures({ events: null }, nfl), []);
    assert.deepEqual(normaliseFixtures({}, nfl), []);
    assert.deepEqual(normaliseFixtures(null, nfl), []);
  });

  it('builds ids for a hyphenated league correctly', () => {
    const game = normaliseFixture(event({ id: '900' }), leagueOne);
    assert.equal(game?.id, 'espn-league-one-900');
    assert.deepEqual(parseEspnGameId(game?.id ?? ''), {
      leagueId: 'league-one',
      eventId: '900',
    });
  });
});

describe('date range formatting', () => {
  it('compacts dates for the provider', () => {
    assert.equal(compactDate('2026-09-02'), '20260902');
    assert.equal(compactDate('2026-12-31'), '20261231');
  });
});
