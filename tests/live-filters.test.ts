/**
 * Narrowing the live scoreboard.
 *
 * The behaviour worth defending is that the filters describe the application
 * rather than the minute: every tracked sport appears whether or not it has a
 * game on, so a quiet morning still says what is followed. The old row was
 * built from whatever happened to be in play and collapsed to a single button.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_COMPETITIONS,
  ALL_SPORTS,
  competitionTallies,
  describeFilters,
  isFiltered,
  leagueIdFor,
  matchesLive,
  NO_FILTERS,
  tallySports,
  TRACKED_COMPETITIONS,
} from '../lib/live/filters.ts';
import { SPORT_IDS } from '../lib/home/types.ts';
import type { ConcreteSportId, Game } from '../lib/home/types.ts';

function game(overrides: Partial<Game> = {}): Game {
  return {
    id: overrides.id ?? 'g1',
    sport: 'football',
    league: 'Premier League',
    league_badge: null,
    season: '2026',
    round: null,
    start_time: '2026-09-05T14:00:00.000Z',
    status: 'live',
    provider_status: null,
    home_team: { id: 'h', name: 'Arsenal', logo: null },
    away_team: { id: 'a', name: 'Chelsea', logo: null },
    venue: { name: 'Emirates Stadium', city: 'London', country: 'England' },
    broadcast: null,
    ...overrides,
  };
}

const NBA = game({
  id: 'nba1',
  sport: 'nba',
  league: 'NBA',
  home_team: { id: 'h', name: 'Boston Celtics', logo: null },
  away_team: { id: 'a', name: 'Los Angeles Lakers', logo: null },
  venue: { name: 'TD Garden', city: 'Boston', country: 'USA' },
});

const RACE = game({
  id: 'f1r',
  sport: 'f1',
  league: 'Formula 1',
  home_team: undefined,
  away_team: undefined,
  title: 'Italian Grand Prix',
  session: 'Race',
  entrants: [
    { id: '1', name: 'Max Verstappen', affiliation: 'Red Bull', position: 1, logo: null },
    { id: '2', name: 'Lando Norris', affiliation: 'McLaren', position: 2, logo: null },
  ],
  venue: { name: 'Monza', city: 'Monza', country: 'Italy' },
});

/**
 * A competition the application does not follow.
 *
 * The scoreboard's provider answers with every live game in a sport worldwide,
 * so this is the *common* case, not an edge one: on a normal afternoon the
 * board carries Chilean, Salvadoran and Venezuelan football and none of it is
 * in the catalogue.
 */
const UNTRACKED = game({
  id: 'chi1',
  league: 'Chile Segunda Division',
  home_team: { id: 'h', name: 'Santiago Morning', logo: null },
  away_team: { id: 'a', name: 'Deportes Recoleta', logo: null },
  venue: { name: 'Estadio Municipal', city: 'Santiago', country: 'Chile' },
});

// ---------------------------------------------------------------------------
// Identifying a competition
// ---------------------------------------------------------------------------

describe('mapping a game to its competition', () => {
  it('resolves the catalogue id from the label a game carries', () => {
    assert.equal(leagueIdFor(game()), 'epl');
    assert.equal(leagueIdFor(NBA), 'nba');
    assert.equal(leagueIdFor(RACE), 'f1');
  });

  it('gives nothing for a competition outside the catalogue', () => {
    // Better than forcing it into the nearest match, which would file a game
    // under a competition it is not in.
    assert.equal(leagueIdFor(game({ league: 'Sunday League' })), null);
    assert.equal(leagueIdFor(game({ league: null })), null);
  });
});

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('narrowing the board', () => {
  const all = [game(), NBA, RACE];

  it('keeps everything when nothing is chosen', () => {
    assert.equal(all.filter((entry) => matchesLive(entry, NO_FILTERS)).length, 3);
    assert.equal(isFiltered(NO_FILTERS), false);
  });

  it('narrows to one sport', () => {
    const matched = all.filter((entry) =>
      matchesLive(entry, { ...NO_FILTERS, sport: 'nba' }),
    );
    assert.deepEqual(
      matched.map((entry) => entry.id),
      ['nba1'],
    );
  });

  it('narrows to one competition, by the name a game carries', () => {
    /*
     * Matched on the name rather than a catalogue id, because most live games
     * have no catalogue id at all. Filtering on ids here would drop nine games
     * in ten without saying so.
     */
    const matched = all.filter((entry) =>
      matchesLive(entry, { sport: 'football', league: 'Premier League', search: '' }),
    );
    assert.deepEqual(
      matched.map((entry) => entry.id),
      ['g1'],
    );
    assert.equal(
      all.filter((entry) =>
        matchesLive(entry, { sport: 'football', league: 'La Liga', search: '' }),
      ).length,
      0,
    );
  });

  it('keeps a competition the catalogue does not carry', () => {
    const board = [game(), UNTRACKED];
    assert.deepEqual(
      board
        .filter((entry) =>
          matchesLive(entry, { ...NO_FILTERS, league: 'Chile Segunda Division' }),
        )
        .map((entry) => entry.id),
      ['chi1'],
      'the scoreboard shows what is on, not only what is followed',
    );
  });

  it('narrows to the competitions the application follows', () => {
    const board = [game(), NBA, UNTRACKED];
    assert.deepEqual(
      board
        .filter((entry) => matchesLive(entry, { ...NO_FILTERS, league: TRACKED_COMPETITIONS }))
        .map((entry) => entry.id),
      ['g1', 'nba1'],
    );
  });

  it('searches teams, competitions, venues and a race field', () => {
    const find = (term: string) =>
      all.filter((entry) => matchesLive(entry, { ...NO_FILTERS, search: term }));

    assert.deepEqual(find('lakers').map((entry) => entry.id), ['nba1']);
    assert.deepEqual(find('arsenal').map((entry) => entry.id), ['g1']);
    assert.deepEqual(find('emirates').map((entry) => entry.id), ['g1']);
    // A race has no two sides, so it is found by its name and its drivers.
    assert.deepEqual(find('italian grand prix').map((entry) => entry.id), ['f1r']);
    assert.deepEqual(find('verstappen').map((entry) => entry.id), ['f1r']);
  });

  it('combines filters rather than replacing one with another', () => {
    // Basketball AND "lakers", not the second instead of the first.
    assert.equal(
      all.filter((entry) => matchesLive(entry, { sport: 'nba', league: ALL_COMPETITIONS, search: 'lakers' }))
        .length,
      1,
    );
    assert.equal(
      all.filter((entry) =>
        matchesLive(entry, { sport: 'football', league: ALL_COMPETITIONS, search: 'lakers' }),
      ).length,
      0,
      'a search must not escape the chosen sport',
    );
  });
});

// ---------------------------------------------------------------------------
// What each choice would give you
// ---------------------------------------------------------------------------

describe('counting what each sport holds', () => {
  it('lists every tracked sport, even the ones with nothing on', () => {
    const tally = tallySports([game()], []);
    assert.deepEqual(
      tally.map((entry) => entry.id),
      SPORT_IDS.filter((id): id is ConcreteSportId => id !== 'all'),
      'the row must not shrink to whatever happens to be in play',
    );

    const quiet = tally.find((entry) => entry.id === 'nhl');
    assert.equal(quiet?.live, 0, 'a sport with no game still has its place');
    assert.ok(quiet && quiet.tracked > 0);
  });

  it('separates "nothing on" from "not tracked at all"', () => {
    const tally = tallySports([], []);
    const hockey = tally.find((entry) => entry.id === 'nhl');
    const tennis = tally.find((entry) => entry.id === 'tennis');

    assert.ok((hockey?.tracked ?? 0) > 0);
    assert.equal(hockey?.unavailable, null, 'hockey is tracked, just not on');

    assert.equal(tennis?.tracked, 0);
    assert.ok(tennis?.unavailable, 'tennis must say why it can never appear');
  });

  it('counts live and upcoming apart', () => {
    const tally = tallySports([NBA], [game({ id: 'later', status: 'scheduled' })]);
    assert.equal(tally.find((entry) => entry.id === 'nba')?.live, 1);
    assert.equal(tally.find((entry) => entry.id === 'nba')?.upcoming, 0);
    assert.equal(tally.find((entry) => entry.id === 'football')?.live, 0);
    assert.equal(tally.find((entry) => entry.id === 'football')?.upcoming, 1);
  });

  it('respects the search term, so the counts answer the right question', () => {
    const tally = tallySports([game(), NBA], [], 'lakers');
    assert.equal(tally.find((entry) => entry.id === 'nba')?.live, 1);
    assert.equal(tally.find((entry) => entry.id === 'football')?.live, 0);
  });
});

describe('offering competitions', () => {
  it('offers nothing when there is nothing to choose between', () => {
    assert.deepEqual(competitionTallies('f1', [RACE]), [], 'a choice of one is not a choice');
    assert.deepEqual(competitionTallies('mlb', []), []);
  });

  it('lists what is actually on, not what the catalogue holds', () => {
    /*
     * The version driven by the catalogue read every competition as (0) while
     * nineteen games sat visible below it, because almost nothing on this feed
     * is in the catalogue.
     */
    const rows = competitionTallies('football', [game(), UNTRACKED, UNTRACKED]);
    const named = rows.filter(
      (entry) => entry.id !== ALL_COMPETITIONS && entry.id !== TRACKED_COMPETITIONS,
    );

    assert.deepEqual(
      named.map((entry) => [entry.label, entry.live, entry.tracked]),
      [
        ['Premier League', 1, true],
        ['Chile Segunda Division', 2, false],
      ],
      'followed competitions lead, and every row has a real count',
    );
  });

  it('leads with a catch-all carrying the total', () => {
    const rows = competitionTallies('football', [game(), UNTRACKED]);
    assert.equal(rows[0].id, ALL_COMPETITIONS);
    assert.equal(rows[0].live, 2);
  });

  it('offers a tracked-only row when the two sets differ', () => {
    const rows = competitionTallies(ALL_SPORTS, [game(), UNTRACKED]);
    const tracked = rows.find((entry) => entry.id === TRACKED_COMPETITIONS);
    assert.equal(tracked?.live, 1, 'one of the two is followed here');
  });

  it('omits the tracked-only row when it would narrow nothing', () => {
    // Every game already followed: the row would be a no-op dressed as a choice.
    const rows = competitionTallies('football', [game(), game({ id: 'g2', league: 'La Liga' })]);
    assert.equal(
      rows.find((entry) => entry.id === TRACKED_COMPETITIONS),
      undefined,
    );
  });

  it('never offers the competitions of another sport', () => {
    const labels = competitionTallies('nba', [NBA, game()]).map((entry) => entry.label);
    assert.ok(!labels.includes('Premier League'));
  });

  it('respects the search term', () => {
    const rows = competitionTallies(ALL_SPORTS, [game(), UNTRACKED], 'arsenal');
    assert.equal(rows.length, 0, 'one match leaves nothing to choose between');
  });
});

// ---------------------------------------------------------------------------
// Saying what is being looked at
// ---------------------------------------------------------------------------

describe('describing the current view', () => {
  it('says nothing when nothing is narrowed', () => {
    assert.equal(describeFilters(NO_FILTERS), '');
  });

  it('names the sport, the competition and the search term', () => {
    assert.equal(describeFilters({ ...NO_FILTERS, sport: 'nba' }), 'Basketball');
    assert.equal(
      describeFilters({ sport: 'football', league: 'Premier League', search: '' }),
      'Premier League',
    );
    assert.match(
      describeFilters({ sport: 'football', league: 'Premier League', search: 'arsenal' }),
      /^Premier League matching/,
    );
    assert.match(describeFilters({ ...NO_FILTERS, search: 'arsenal' }), /^matching/);
    assert.match(
      describeFilters({ ...NO_FILTERS, league: TRACKED_COMPETITIONS }),
      /tracked competition/,
    );
  });

  it('knows when anything is active', () => {
    assert.equal(isFiltered({ ...NO_FILTERS, search: '   ' }), false, 'whitespace is not a filter');
    assert.equal(isFiltered({ ...NO_FILTERS, search: 'a' }), true);
    assert.equal(isFiltered({ ...NO_FILTERS, sport: 'nba' }), true);
    assert.equal(isFiltered({ ...NO_FILTERS, league: 'Premier League' }), true);
  });
});
