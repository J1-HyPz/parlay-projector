import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SPORT_DEFINITIONS,
  countActiveSports,
  normaliseEvent,
  normaliseEvents,
  normaliseStartTime,
  normaliseStatus,
  sortGames,
} from '../lib/home/sports/normalise.ts';
import type { RawEvent, SportDefinition } from '../lib/home/sports/normalise.ts';

const soccer = SPORT_DEFINITIONS.find((d) => d.id === 'football') as SportDefinition;
const nfl = SPORT_DEFINITIONS.find((d) => d.id === 'nfl') as SportDefinition;

/** Shaped from a real TheSportsDB eventsday.php response. */
function rawEvent(overrides: RawEvent = {}): RawEvent {
  return {
    idEvent: '2398051',
    strSport: 'Soccer',
    strLeague: 'Argentinian Primera Division',
    strLeagueBadge: 'https://example.test/league.png',
    strHomeTeam: 'Instituto',
    strAwayTeam: 'San Lorenzo',
    idHomeTeam: '137786',
    idAwayTeam: '135173',
    strHomeTeamBadge: 'https://example.test/home.png',
    strAwayTeamBadge: 'https://example.test/away.png',
    strVenue: 'Estadio Juan Domingo Peron',
    strCountry: 'Argentina',
    strTimestamp: '2026-09-01T00:15:00',
    dateEvent: '2026-09-01',
    strTime: '00:15:00',
    strStatus: 'NS',
    strPostponed: 'no',
    ...overrides,
  };
}

describe('game normalisation', () => {
  it('maps a provider event onto the Parlay Projector contract', () => {
    const games = normaliseEvents({ events: [rawEvent()] }, soccer);
    assert.equal(games.length, 1);

    const game = games[0];
    assert.equal(game.id, '2398051');
    assert.equal(game.sport, 'football');
    assert.equal(game.league, 'Argentinian Primera Division');
    assert.equal(game.status, 'scheduled');
    assert.equal(game.provider_status, 'NS');
    assert.equal(game.home_team.name, 'Instituto');
    assert.equal(game.away_team.name, 'San Lorenzo');
    assert.equal(game.home_team.logo, 'https://example.test/home.png');
    assert.equal(game.venue.name, 'Estadio Juan Domingo Peron');
    assert.equal(game.venue.city, 'Argentina');
    assert.equal(game.start_time, '2026-09-01T00:15:00.000Z');
  });

  it('never exposes betting fields', () => {
    const game = normaliseEvents({ events: [rawEvent()] }, soccer)[0];
    for (const key of ['odds', 'moneyline', 'spread', 'totals', 'bookmaker', 'returns']) {
      assert.equal(key in game, false, `game must not expose "${key}"`);
    }
  });

  it('treats a null events list as no games', () => {
    assert.deepEqual(normaliseEvents({ events: null }, soccer), []);
    assert.deepEqual(normaliseEvents({}, soccer), []);
    assert.deepEqual(normaliseEvents(null, soccer), []);
    assert.deepEqual(normaliseEvents(undefined, soccer), []);
  });

  it('drops malformed rows rather than emitting broken games', () => {
    const games = normaliseEvents(
      {
        events: [
          rawEvent(),
          {} as RawEvent,
          { idEvent: '1' } as RawEvent, // no teams
          { strHomeTeam: 'A', strAwayTeam: 'B' } as RawEvent, // no id
          null as unknown as RawEvent,
        ],
      },
      soccer,
    );
    assert.equal(games.length, 1);
  });

  it('filters by league so nfl means the NFL only', () => {
    const events = [
      rawEvent({ idEvent: '1', strLeague: 'NFL', strSport: 'American Football' }),
      rawEvent({ idEvent: '2', strLeague: 'NCAA Division 1', strSport: 'American Football' }),
    ];
    const games = normaliseEvents({ events }, nfl);
    assert.equal(games.length, 1);
    assert.equal(games[0].league, 'NFL');
    assert.equal(games[0].sport, 'nfl');
  });

  it('applies no league filter for football', () => {
    const events = [
      rawEvent({ idEvent: '1', strLeague: 'Premier League' }),
      rawEvent({ idEvent: '2', strLeague: 'Serie A' }),
    ];
    assert.equal(normaliseEvents({ events }, soccer).length, 2);
  });

  it('returns null for an event with no usable identity', () => {
    assert.equal(normaliseEvent({}, 'football'), null);
  });
});

describe('status normalisation', () => {
  it('maps provider codes onto the internal vocabulary', () => {
    assert.equal(normaliseStatus('NS'), 'scheduled');
    assert.equal(normaliseStatus('FT'), 'finished');
    assert.equal(normaliseStatus('AOT'), 'finished');
    assert.equal(normaliseStatus('PPD'), 'postponed');
    assert.equal(normaliseStatus('CANC'), 'cancelled');
    assert.equal(normaliseStatus('HT'), 'live');
    assert.equal(normaliseStatus('1H'), 'live');
    assert.equal(normaliseStatus('Q3'), 'live');
    assert.equal(normaliseStatus('P2'), 'live');
  });

  it('defaults to scheduled when the provider says nothing', () => {
    assert.equal(normaliseStatus(null), 'scheduled');
    assert.equal(normaliseStatus(''), 'scheduled');
    assert.equal(normaliseStatus(undefined), 'scheduled');
  });

  it('does not guess at unrecognised codes', () => {
    assert.equal(normaliseStatus('WEIRD'), 'unknown');
  });

  it('lets the postponed flag win over the status code', () => {
    assert.equal(normaliseStatus('NS', 'yes'), 'postponed');
  });
});

describe('start times', () => {
  it('treats a zoneless provider timestamp as UTC', () => {
    assert.equal(
      normaliseStartTime({ strTimestamp: '2026-09-01T00:15:00' }),
      '2026-09-01T00:15:00.000Z',
    );
  });

  it('respects an explicit zone when present', () => {
    assert.equal(
      normaliseStartTime({ strTimestamp: '2026-09-01T00:15:00Z' }),
      '2026-09-01T00:15:00.000Z',
    );
  });

  it('falls back to date and time fields', () => {
    assert.equal(
      normaliseStartTime({ dateEvent: '2026-09-01', strTime: '19:45:00' }),
      '2026-09-01T19:45:00.000Z',
    );
  });

  it('returns null when nothing is parseable', () => {
    assert.equal(normaliseStartTime({}), null);
    assert.equal(normaliseStartTime({ strTimestamp: 'not-a-date' }), null);
  });
});

describe('ordering and counting', () => {
  it('sorts by kick-off and puts unknown times last', () => {
    const games = normaliseEvents(
      {
        events: [
          rawEvent({ idEvent: 'c', strTimestamp: 'nonsense', dateEvent: null, strTime: null }),
          rawEvent({ idEvent: 'b', strTimestamp: '2026-09-01T20:00:00' }),
          rawEvent({ idEvent: 'a', strTimestamp: '2026-09-01T12:00:00' }),
        ],
      },
      soccer,
    );
    assert.deepEqual(sortGames(games).map((g) => g.id), ['a', 'b', 'c']);
  });

  it('counts distinct sports', () => {
    const games = [
      ...normaliseEvents({ events: [rawEvent({ idEvent: '1' })] }, soccer),
      ...normaliseEvents(
        { events: [rawEvent({ idEvent: '2', strLeague: 'NFL' })] },
        nfl,
      ),
    ];
    assert.equal(countActiveSports(games), 2);
    assert.equal(countActiveSports([]), 0);
  });
});
