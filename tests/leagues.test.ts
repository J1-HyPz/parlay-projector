import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  LEAGUES,
  findLeague,
  leagueIds,
  leaguesInGroup,
  parseLeagueId,
} from '../lib/leagues/registry.ts';
import {
  normalisePlayer,
  normaliseRoster,
  normaliseStandings,
  normaliseStandingsEntry,
  normaliseTeam,
  normaliseTeams,
  statDisplay,
  statValue,
} from '../lib/leagues/normalise.ts';
import type {
  RawRosterResponse,
  RawStandingsGroup,
  RawTeamsResponse,
} from '../lib/leagues/normalise.ts';

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

describe('league catalogue', () => {
  it('covers every requested competition', () => {
    for (const id of ['nfl', 'ncaaf', 'nba', 'wnba', 'ncaam', 'ncaaw', 'mlb', 'nhl']) {
      assert.ok(findLeague(id), `${id} must be in the catalogue`);
    }
  });

  it('covers exactly the requested football competitions', () => {
    for (const id of [
      'epl', 'championship', 'league-one', 'ucl', 'uel', 'uecl',
      'laliga', 'bundesliga', 'seriea',
    ]) {
      assert.ok(findLeague(id), `${id} must be in the catalogue`);
    }
  });

  it('excludes football leagues that were not requested', () => {
    // A sport-wide query returned every league on earth; the catalogue is the
    // allow-list that keeps the schedule to competitions anyone wants.
    assert.equal(findLeague('ligue1'), null);
    assert.equal(findLeague('mls'), null);
  });

  it('separates college competitions from their professional equivalents', () => {
    assert.equal(findLeague('ncaaf')?.collegiate, true);
    assert.equal(findLeague('nfl')?.collegiate, false);
    assert.equal(findLeague('ncaam')?.collegiate, true);
    assert.equal(findLeague('nba')?.collegiate, false);

    // Distinct provider paths, so college fixtures never leak into the pro league.
    assert.notEqual(findLeague('ncaam')?.espnPath, findLeague('nba')?.espnPath);
    assert.notEqual(findLeague('ncaaw')?.espnPath, findLeague('wnba')?.espnPath);
  });

  it('groups leagues usefully', () => {
    assert.equal(leaguesInGroup('basketball').length, 4);
    // NFL, NCAA Football, CFL and the two European competitions.
    assert.equal(leaguesInGroup('american-football').length, 5);
    assert.equal(leaguesInGroup('baseball').length, 1);
    assert.equal(leaguesInGroup('hockey').length, 1);
    assert.equal(leaguesInGroup('football').length, 9);
  });

  it('offers a league for every sport chip, so no chip is dead', () => {
    // A chip that can never return a game is worse than no chip.
    for (const sport of ['nfl', 'nba', 'mlb', 'nhl', 'football'] as const) {
      assert.ok(
        LEAGUES.some((league) => league.sport === sport),
        `sport chip "${sport}" has no league behind it`,
      );
    }
  });

  it('has unique ids and non-empty provider paths', () => {
    const ids = leagueIds();
    assert.equal(new Set(ids).size, ids.length, 'league ids must be unique');
    for (const league of LEAGUES) {
      // Whichever provider serves it, the identifier that provider needs must
      // be present — an ESPN path or a TheSportsDB league id.
      const identifier = league.provider === 'espn' ? league.espnPath : league.sportsdbLeagueId;
      assert.ok(
        identifier && identifier.length > 0,
        `${league.id} needs an identifier for provider "${league.provider}"`,
      );
      assert.ok(league.label.length > 0);
      assert.ok(league.shortLabel.length > 0);
      // The schedule row badge is a 32px circle at 9px text; anything longer
      // overflows it.
      assert.ok(
        league.shortLabel.length <= 5,
        `${league.id} short label "${league.shortLabel}" is too long for the badge`,
      );
    }
  });

  it('validates league ids from a request', () => {
    assert.equal(parseLeagueId('nba')?.id, 'nba');
    assert.equal(parseLeagueId('NBA')?.id, 'nba');
    assert.equal(parseLeagueId('  wnba  ')?.id, 'wnba');
    assert.equal(parseLeagueId('nope'), null);
    assert.equal(parseLeagueId('../../etc/passwd'), null);
    assert.equal(parseLeagueId(''), null);
    assert.equal(parseLeagueId(null), null);
  });
});

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/** Shaped from a real WNBA teams response. */
const TEAMS: RawTeamsResponse = {
  sports: [
    {
      leagues: [
        {
          teams: [
            {
              team: {
                id: '20',
                displayName: 'Atlanta Dream',
                name: 'Dream',
                abbreviation: 'ATL',
                location: 'Atlanta',
                color: 'e31837',
                logos: [{ href: 'https://example.test/atl.png' }],
              },
            },
            {
              team: {
                id: '19',
                displayName: 'Chicago Sky',
                name: 'Sky',
                abbreviation: 'CHI',
                location: 'Chicago',
                logos: [],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('team normalisation', () => {
  it('reads teams out of the nested payload', () => {
    const teams = normaliseTeams(TEAMS);
    assert.equal(teams.length, 2);
    // Sorted by name.
    assert.equal(teams[0].name, 'Atlanta Dream');
    assert.equal(teams[0].short_name, 'Dream');
    assert.equal(teams[0].abbreviation, 'ATL');
    assert.equal(teams[0].location, 'Atlanta');
    assert.equal(teams[0].logo, 'https://example.test/atl.png');
    assert.equal(teams[0].colour, '#e31837');
  });

  it('leaves absent fields null rather than defaulting them', () => {
    const teams = normaliseTeams(TEAMS);
    assert.equal(teams[1].logo, null);
    assert.equal(teams[1].colour, null);
  });

  it('handles malformed payloads', () => {
    assert.deepEqual(normaliseTeams({}), []);
    assert.deepEqual(normaliseTeams(null), []);
    assert.deepEqual(normaliseTeams({ sports: [] }), []);
    assert.equal(normaliseTeam({}), null);
    assert.equal(normaliseTeam({ team: { id: '1' } }), null, 'a team needs a name');
  });
});

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

/** Shaped from a real NBA standings response, with the actual stat names. */
const STANDINGS: RawStandingsGroup = {
  id: '0',
  name: 'National Basketball Association',
  children: [
    {
      id: '5',
      name: 'Eastern Conference',
      abbreviation: 'East',
      standings: {
        entries: [
          {
            team: { id: '8', displayName: 'Detroit Pistons', abbreviation: 'DET', logos: [{ href: 'd.png' }] },
            stats: [
              { name: 'wins', value: 41, displayValue: '41' },
              { name: 'losses', value: 12, displayValue: '12' },
              { name: 'winPercent', value: 0.774, displayValue: '.774' },
              { name: 'gamesBehind', value: 0, displayValue: '-' },
              { name: 'pointsFor', value: 4828, displayValue: '4828' },
              { name: 'pointsAgainst', value: 4494, displayValue: '4494' },
              { name: 'playoffSeed', value: 1, displayValue: '1' },
              { name: 'streak', value: 3, displayValue: 'W3' },
              { name: 'overall', value: 0, displayValue: '41-12' },
            ],
          },
          {
            team: { id: '2', displayName: 'Boston Celtics', abbreviation: 'BOS', logos: [] },
            stats: [
              { name: 'wins', value: 30, displayValue: '30' },
              { name: 'losses', value: 22, displayValue: '22' },
              { name: 'playoffSeed', value: 2, displayValue: '2' },
            ],
          },
        ],
      },
    },
    { id: '6', name: 'Western Conference', standings: { entries: [] } },
  ],
};

describe('standings normalisation', () => {
  it('flattens conferences into named groups', () => {
    const groups = normaliseStandings(STANDINGS);
    assert.equal(groups.length, 1, 'an empty conference yields no group');
    assert.equal(groups[0].name, 'Eastern Conference');
    assert.equal(groups[0].abbreviation, 'East');
    assert.equal(groups[0].rows.length, 2);
  });

  it('reads the real stat names', () => {
    const row = normaliseStandings(STANDINGS)[0].rows[0];
    assert.equal(row.team_name, 'Detroit Pistons');
    assert.equal(row.wins, 41);
    assert.equal(row.losses, 12);
    assert.equal(row.win_percent, 0.774);
    assert.equal(row.points_for, 4828);
    assert.equal(row.rank, 1);
    assert.equal(row.record, '41-12');
    assert.equal(row.streak, 'W3');
  });

  it('orders rows by seed', () => {
    const rows = normaliseStandings(STANDINGS)[0].rows;
    assert.deepEqual(rows.map((r) => r.abbreviation), ['DET', 'BOS']);
  });

  it('leaves statistics a league does not publish as null', () => {
    const row = normaliseStandings(STANDINGS)[0].rows[1];
    assert.equal(row.ties, null, 'basketball has no ties');
    assert.equal(row.points_for, null);
    assert.equal(row.record, null);
  });

  it('handles malformed payloads', () => {
    assert.deepEqual(normaliseStandings(null), []);
    assert.deepEqual(normaliseStandings({}), []);
    assert.deepEqual(normaliseStandings({ children: [] }), []);
    assert.equal(normaliseStandingsEntry({}), null);
  });

  it('reads individual statistics safely', () => {
    const stats = [{ name: 'wins', value: 10, displayValue: '10' }];
    assert.equal(statValue(stats, 'wins'), 10);
    assert.equal(statValue(stats, 'losses'), null);
    assert.equal(statValue(undefined, 'wins'), null);
    assert.equal(statDisplay(stats, 'wins'), '10');
    assert.equal(statDisplay(stats, 'nope'), null);
  });
});

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

/** Flat shape, as NCAA basketball returns. */
const FLAT_ROSTER: RawRosterResponse = {
  athletes: [
    {
      id: '5105550',
      fullName: 'Cayden Boozer',
      jersey: '2',
      position: { abbreviation: 'G', displayName: 'Guard' },
      height: 76,
      displayHeight: "6' 4\"",
      weight: 205,
      age: 19,
      headshot: { href: 'https://example.test/p.png' },
      experience: { years: 1 },
    },
    { id: '2', fullName: 'No Position Player' },
  ],
};

/** Grouped-by-position shape, as some leagues return. */
const GROUPED_ROSTER: RawRosterResponse = {
  athletes: [
    { items: [{ id: '10', fullName: 'Quarterback One', position: { abbreviation: 'QB' } }] },
    { items: [{ id: '11', fullName: 'Runner Two', position: { abbreviation: 'RB' } }] },
  ],
};

describe('player normalisation', () => {
  it('reads a flat roster', () => {
    const players = normaliseRoster(FLAT_ROSTER);
    assert.equal(players.length, 2);

    const first = players[0];
    assert.equal(first.name, 'Cayden Boozer');
    assert.equal(first.jersey, '2');
    assert.equal(first.position, 'G');
    assert.equal(first.height, "6' 4\"", 'prefers the readable height over raw inches');
    assert.equal(first.weight, 205);
    assert.equal(first.age, 19);
    assert.equal(first.experience_years, 1);
  });

  it('reads a roster grouped by position', () => {
    const players = normaliseRoster(GROUPED_ROSTER);
    assert.equal(players.length, 2);
    assert.deepEqual(players.map((p) => p.position), ['QB', 'RB']);
  });

  it('leaves absent player fields null', () => {
    const player = normaliseRoster(FLAT_ROSTER)[1];
    assert.equal(player.position, null);
    assert.equal(player.jersey, null);
    assert.equal(player.height, null);
    assert.equal(player.weight, null);
    assert.equal(player.headshot, null);
  });

  it('handles malformed payloads', () => {
    assert.deepEqual(normaliseRoster({}), []);
    assert.deepEqual(normaliseRoster(null), []);
    assert.deepEqual(normaliseRoster({ athletes: [] }), []);
    assert.equal(normalisePlayer({}), null);
    assert.equal(normalisePlayer({ id: '1' }), null, 'a player needs a name');
    assert.equal(normalisePlayer(null), null);
  });

  it('exposes no betting or prediction fields', () => {
    const player = normaliseRoster(FLAT_ROSTER)[0];
    for (const key of ['odds', 'projection', 'confidence', 'prop', 'line']) {
      assert.equal(key in player, false, `player must not expose "${key}"`);
    }
  });
});
