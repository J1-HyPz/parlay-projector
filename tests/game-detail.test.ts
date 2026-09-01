import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  findStanding,
  isValidGameId,
  normaliseGameDetail,
  normaliseRecentGames,
  normaliseScore,
  normaliseStanding,
  normaliseTeam,
  num,
  parseForm,
  resultFor,
  sportFromProvider,
} from '../lib/games/normalise.ts';
import type { GameDetailInput, RawStanding, RawTeam } from '../lib/games/normalise.ts';
import type { RawEvent } from '../lib/home/sports/normalise.ts';

/** Shaped from a real TheSportsDB lookupevent.php response. */
function rawEvent(overrides: Record<string, unknown> = {}): RawEvent & Record<string, unknown> {
  return {
    idEvent: '2398051',
    strSport: 'Soccer',
    strLeague: 'Argentinian Primera Division',
    strLeagueBadge: 'https://example.test/league.png',
    idLeague: '4406',
    strSeason: '2026',
    intRound: '7',
    strHomeTeam: 'Instituto',
    strAwayTeam: 'San Lorenzo',
    idHomeTeam: '137786',
    idAwayTeam: '135173',
    strHomeTeamBadge: 'https://example.test/home.png',
    strAwayTeamBadge: 'https://example.test/away.png',
    strVenue: 'Estadio Juan Domingo Peron',
    strCity: '',
    strCountry: 'Argentina',
    strTimestamp: '2026-09-01T00:15:00',
    strStatus: 'NS',
    strPostponed: 'no',
    intHomeScore: '',
    intAwayScore: '',
    ...overrides,
  };
}

function build(overrides: Partial<GameDetailInput> = {}): GameDetailInput {
  return { event: rawEvent(), ...overrides };
}

describe('game id validation', () => {
  it('accepts provider numeric ids', () => {
    assert.equal(isValidGameId('2398051'), true);
    assert.equal(isValidGameId(' 2398051 '), true);
  });

  it('rejects anything that is not a provider id', () => {
    assert.equal(isValidGameId('arsenal-vs-spurs'), false);
    assert.equal(isValidGameId('../../etc/passwd'), false);
    assert.equal(isValidGameId(''), false);
    assert.equal(isValidGameId(null), false);
    assert.equal(isValidGameId(undefined), false);
    assert.equal(isValidGameId('12345678901234567890123'), false);
  });
});

describe('numeric parsing', () => {
  it('never turns an absent value into zero', () => {
    assert.equal(num(''), null);
    assert.equal(num(null), null);
    assert.equal(num(undefined), null);
    assert.equal(num('   '), null);
    assert.equal(num('abc'), null);
  });

  it('parses real numbers, including a genuine zero', () => {
    assert.equal(num('0'), 0);
    assert.equal(num('21'), 21);
    assert.equal(num(17), 17);
  });
});

describe('game detail normalisation', () => {
  it('maps a scheduled game onto the contract', () => {
    const game = normaliseGameDetail(build());
    assert.ok(game);
    assert.equal(game.id, '2398051');
    assert.equal(game.sport, 'football');
    assert.equal(game.league, 'Argentinian Primera Division');
    assert.equal(game.season, '2026');
    assert.equal(game.round, '7');
    assert.equal(game.status, 'scheduled');
    assert.equal(game.start_time, '2026-09-01T00:15:00.000Z');
    assert.equal(game.home_team.name, 'Instituto');
    assert.equal(game.away_team.name, 'San Lorenzo');
    assert.equal(game.venue.name, 'Estadio Juan Domingo Peron');
  });

  it('shows no score for a scheduled game', () => {
    const game = normaliseGameDetail(build());
    assert.ok(game);
    assert.equal(game.score, null);
    assert.equal(game.game_state, null);
  });

  it('does not invent a 0-0 when the provider sends empty scores', () => {
    const game = normaliseGameDetail(
      build({ event: rawEvent({ strStatus: 'FT', intHomeScore: '', intAwayScore: '' }) }),
    );
    assert.ok(game);
    assert.equal(game.score, null);
  });

  it('shows the score for a finished game', () => {
    const game = normaliseGameDetail(
      build({ event: rawEvent({ strStatus: 'FT', intHomeScore: '1', intAwayScore: '0' }) }),
    );
    assert.ok(game);
    assert.equal(game.status, 'finished');
    assert.deepEqual(game.score, { home: 1, away: 0 });
    assert.equal(game.game_state, null);
  });

  it('exposes live state only while a game is live', () => {
    const game = normaliseGameDetail(
      build({ event: rawEvent({ strStatus: '2H', intHomeScore: '1', intAwayScore: '1' }) }),
    );
    assert.ok(game);
    assert.equal(game.status, 'live');
    assert.equal(game.game_state, '2H');
    assert.deepEqual(game.score, { home: 1, away: 1 });
  });

  it('falls back to country when the provider sends an empty city', () => {
    const game = normaliseGameDetail(build());
    assert.ok(game);
    assert.equal(game.venue.city, 'Argentina');
  });

  it('returns null for a missing or unusable event', () => {
    assert.equal(normaliseGameDetail({ event: {} }), null);
    assert.equal(normaliseGameDetail({ event: rawEvent({ idEvent: null }) }), null);
    assert.equal(
      normaliseGameDetail({ event: rawEvent({ strHomeTeam: '', strAwayTeam: '' }) }),
      null,
    );
    assert.equal(normaliseGameDetail({ event: rawEvent({ strSport: 'Darts' }) }), null);
  });

  it('never exposes betting fields', () => {
    const game = normaliseGameDetail(build());
    assert.ok(game);
    for (const key of ['odds', 'moneyline', 'spread', 'totals', 'bookmaker', 'markets']) {
      assert.equal(key in game, false, `game must not expose "${key}"`);
    }
  });

  it('carries an empty head-to-head, since the provider has none', () => {
    const game = normaliseGameDetail(build());
    assert.ok(game);
    assert.deepEqual(game.head_to_head, []);
  });
});

describe('sport mapping', () => {
  it('maps provider sports onto internal ids', () => {
    assert.equal(sportFromProvider('Soccer'), 'football');
    assert.equal(sportFromProvider('American Football'), 'nfl');
    assert.equal(sportFromProvider('Basketball'), 'nba');
    assert.equal(sportFromProvider('Baseball'), 'mlb');
    assert.equal(sportFromProvider('Ice Hockey'), 'nhl');
  });

  it('returns null for unsupported sports rather than guessing', () => {
    assert.equal(sportFromProvider('Darts'), null);
    assert.equal(sportFromProvider(''), null);
    assert.equal(sportFromProvider(null), null);
  });
});

describe('teams', () => {
  it('normalises a team lookup', () => {
    const raw: RawTeam = {
      idTeam: '137786',
      strTeam: 'Instituto',
      strTeamShort: 'INS',
      strBadge: 'https://example.test/badge.png',
      strStadium: 'Estadio Juan Domingo Peron',
      strLocation: 'Cordoba, Argentina',
      intFormedYear: '1918',
    };
    const team = normaliseTeam(raw, 'fallback');
    assert.equal(team.name, 'Instituto');
    assert.equal(team.abbreviation, 'INS');
    assert.equal(team.formed_year, 1918);
  });

  it('omits an abbreviation the provider left blank', () => {
    const team = normaliseTeam({ strTeam: 'Jukurit', strTeamShort: '' }, 'fallback');
    assert.equal(team.abbreviation, null);
  });

  it('uses the event name when the team lookup failed', () => {
    const team = normaliseTeam(null, 'San Lorenzo');
    assert.equal(team.name, 'San Lorenzo');
    assert.equal(team.logo, null);
  });

  it('keeps event badges when the team lookup gave none', () => {
    const game = normaliseGameDetail(build({ homeTeam: { strTeam: 'Instituto' } }));
    assert.ok(game);
    assert.equal(game.home_team.logo, 'https://example.test/home.png');
  });
});

describe('standings and form', () => {
  const row: RawStanding = {
    idTeam: '137786',
    intRank: '1',
    intPlayed: '7',
    intWin: '4',
    intDraw: '2',
    intLoss: '1',
    intGoalsFor: '12',
    intGoalsAgainst: '5',
    intGoalDifference: '7',
    intPoints: '14',
    strForm: 'DLWLL',
    strGroup: 'Apertura - Group A',
  };

  it('parses a league table row', () => {
    const standing = normaliseStanding(row);
    assert.ok(standing);
    assert.equal(standing.rank, 1);
    assert.equal(standing.wins, 4);
    assert.equal(standing.points, 14);
    assert.deepEqual(standing.form, ['D', 'L', 'W', 'L', 'L']);
  });

  it('returns null for a row where nothing parsed', () => {
    assert.equal(normaliseStanding({}), null);
    assert.equal(normaliseStanding(null), null);
  });

  it('finds the row for a given team', () => {
    assert.ok(findStanding([row], '137786'));
    assert.equal(findStanding([row], '999'), null);
    assert.equal(findStanding(null, '137786'), null);
    assert.equal(findStanding([row], null), null);
  });

  it('ignores unrecognised characters in a form string', () => {
    assert.deepEqual(parseForm('W-D?L'), ['W', 'D', 'L']);
    assert.deepEqual(parseForm(''), []);
    assert.deepEqual(parseForm(null), []);
  });
});

describe('recent games', () => {
  const events = [
    {
      idEvent: '1',
      idHomeTeam: '137786',
      idAwayTeam: '900',
      strHomeTeam: 'Instituto',
      strAwayTeam: 'Gimnasia',
      intHomeScore: '1',
      intAwayScore: '0',
      dateEvent: '2026-08-25',
    },
    {
      idEvent: '2',
      idHomeTeam: '901',
      idAwayTeam: '137786',
      strHomeTeam: 'Boca',
      strAwayTeam: 'Instituto',
      intHomeScore: '2',
      intAwayScore: '2',
      dateEvent: '2026-08-18',
    },
  ] as RawEvent[];

  it('reads results from the chosen team perspective', () => {
    const games = normaliseRecentGames(events, '137786');
    assert.equal(games.length, 2);

    assert.equal(games[0].home, true);
    assert.equal(games[0].opponent, 'Gimnasia');
    assert.equal(games[0].result, 'W');

    assert.equal(games[1].home, false);
    assert.equal(games[1].opponent, 'Boca');
    assert.equal(games[1].result, 'D');
  });

  it('skips games the team did not play in', () => {
    assert.deepEqual(normaliseRecentGames(events, '555'), []);
  });

  it('caps the number returned', () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...events[0],
      idEvent: String(index),
    })) as RawEvent[];
    assert.equal(normaliseRecentGames(many, '137786').length, 5);
    assert.equal(normaliseRecentGames(many, '137786', 3).length, 3);
  });

  it('handles absent input', () => {
    assert.deepEqual(normaliseRecentGames(null, '137786'), []);
    assert.deepEqual(normaliseRecentGames(undefined, '137786'), []);
  });

  it('leaves the result null when a score is missing', () => {
    const noScore = [{ ...events[0], intHomeScore: '', intAwayScore: '' }] as RawEvent[];
    assert.equal(normaliseRecentGames(noScore, '137786')[0].result, null);
  });
});

describe('result and score helpers', () => {
  it('derives win, draw and loss', () => {
    assert.equal(resultFor(3, 1), 'W');
    assert.equal(resultFor(1, 3), 'L');
    assert.equal(resultFor(2, 2), 'D');
  });

  it('returns null when a score is unknown', () => {
    assert.equal(resultFor(null, 1), null);
    assert.equal(resultFor(1, null), null);
  });

  it('withholds the score until a game has started', () => {
    const event = rawEvent({ intHomeScore: '3', intAwayScore: '1' });
    assert.equal(normaliseScore(event, 'scheduled'), null);
    assert.equal(normaliseScore(event, 'postponed'), null);
    assert.deepEqual(normaliseScore(event, 'finished'), { home: 3, away: 1 });
    assert.deepEqual(normaliseScore(event, 'live'), { home: 3, away: 1 });
  });
});
