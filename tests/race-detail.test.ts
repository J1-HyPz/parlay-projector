/**
 * A race session, from the scoreboard fixture to a page a reader can open.
 *
 * Every practice, qualifying and race page used to return "temporarily
 * unavailable": the detail service asked the provider's `summary` endpoint,
 * which serves no motorsport event and answers 404. The cards knew and routed
 * around it, pointing at the sport hub, so a Grand Prix could be seen and
 * never opened.
 *
 * What is worth guarding here is what a race does *not* have. It has no home
 * side and no away side, so nothing may invent a pair of names — a
 * placeholder is a name, and a name leaks into the slip, the watchlist and
 * every heading. And it has no score, so the result is the classified order
 * rather than a scoreline.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normaliseRaceFixtures } from '../lib/providers/espn/racing.ts';
import { raceDetailFrom, weekendOf } from '../lib/games/race-detail.ts';
import { detailSides, isFieldDetail } from '../lib/games/types.ts';
import type { League } from '../lib/leagues/registry';

const F1 = {
  id: 'f1',
  label: 'Formula 1',
  shortLabel: 'F1',
  group: 'motorsport',
  sport: 'f1',
  provider: 'espn',
  espnPath: 'racing/f1',
  format: 'race',
  sportsdbLeagueId: null,
  hasStandings: true,
  hasTransactions: false,
  collegiate: false,
} as unknown as League;

const payload = {
  events: [
    {
      id: '900',
      date: '2026-09-04T10:30Z',
      name: 'Pirelli Italian Grand Prix',
      season: { year: 2026 },
      circuit: {
        fullName: 'Autodromo di Monza',
        address: { city: 'Monza', country: 'Italy' },
      },
      competitions: [
        {
          id: '1',
          date: '2026-09-04T11:30Z',
          type: { abbreviation: 'FP1' },
          status: { type: { name: 'STATUS_FINAL', completed: true } },
          competitors: [
            { id: 'a', order: 2, athlete: { id: '5', displayName: 'Bravo' } },
            { id: 'b', order: 1, athlete: { id: '6', displayName: 'Alpha' } },
          ],
        },
        {
          id: '2',
          date: '2026-09-05T14:00Z',
          type: { abbreviation: 'Qual' },
          status: { type: { name: 'STATUS_SCHEDULED' } },
          competitors: [],
        },
        {
          id: '3',
          date: '2026-09-06T13:00Z',
          type: { abbreviation: 'Race' },
          status: { type: { name: 'STATUS_SCHEDULED' } },
          competitors: [],
        },
      ],
    },
    {
      id: '901',
      date: '2026-09-18T10:30Z',
      name: 'Tag Heuer Spanish Grand Prix',
      season: { year: 2026 },
      competitions: [
        {
          id: '9',
          date: '2026-09-20T13:00Z',
          type: { abbreviation: 'Race' },
          status: { type: { name: 'STATUS_SCHEDULED' } },
          competitors: [],
        },
      ],
    },
  ],
};

const sessions = normaliseRaceFixtures(payload, F1);
const practice = sessions.find((game) => game.session === 'Practice 1')!;
const race = sessions.find((game) => game.id === 'espn-f1-3')!;

describe('a race session as a detail', () => {
  const detail = raceDetailFrom(practice, sessions);

  it('opens at all', () => {
    // The whole point: the summary endpoint 404s for a session id, so the
    // page is built from the fixture the scoreboard already normalised.
    assert.ok(detail);
    assert.equal(detail.id, 'espn-f1-1');
    assert.equal(detail.league, 'Formula 1');
  });

  it('has no home side and no away side', () => {
    // Not a placeholder, and not a pair of drivers nominated from twenty. A
    // name here would reach the slip and the watchlist as a fixture label.
    assert.equal(detail?.home_team, undefined);
    assert.equal(detail?.away_team, undefined);
    assert.equal(detailSides(detail!), null);
    assert.equal(isFieldDetail(detail!), true);
  });

  it('carries the field rather than a score', () => {
    assert.equal(detail?.score, null);
    assert.equal(detail?.entrants?.length, 2);
    assert.equal(detail?.session, 'Practice 1');
    assert.equal(detail?.title, 'Pirelli Italian Grand Prix');
  });

  it('reports nothing a race does not publish', () => {
    // Empty, deliberately: there is no league table for a driver, no season
    // series between twenty of them, and no injury report.
    assert.equal(detail?.standings.home, null);
    assert.deepEqual(detail?.head_to_head, []);
    assert.equal(detail?.head_to_head_record, null);
    assert.equal(detail?.availability, null);
  });

  it('refuses a fixture that is not contested by a field', () => {
    const twoSided = { ...practice, entrants: undefined };
    assert.equal(raceDetailFrom(twoSided, sessions), null);
  });
});

describe('the rest of the weekend', () => {
  it('lists the sessions of this event, in running order', () => {
    const weekend = weekendOf(practice, sessions);
    assert.deepEqual(
      weekend.map((entry) => entry.session),
      ['Practice 1', 'Qualifying', 'Race'],
    );
  });

  it('leaves out another weekend entirely', () => {
    // Two Grands Prix are two events; a session list that mixed them would
    // send a reader to the wrong Sunday.
    const spanish = sessions.find((game) => game.id === 'espn-f1-9')!;
    const weekend = weekendOf(spanish, sessions);
    assert.equal(weekend.length, 1);
    assert.equal(weekend[0].id, 'espn-f1-9');
  });

  it('includes the session being viewed, so the list is the whole weekend', () => {
    const weekend = weekendOf(race, sessions);
    assert.ok(weekend.some((entry) => entry.id === race.id));
  });
});
