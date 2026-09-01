import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { findMatchingGame, sameTeam, teamTokens } from '../lib/providers/matching.ts';
import {
  BETTING_FIELDS,
  calendarDate,
  normaliseEvent,
  normaliseScoreboard,
  normaliseSeasonSeries,
  overallRecord,
  parseForm,
  stripBetting,
} from '../lib/providers/espn/normalise.ts';
import type { RawEspnEvent } from '../lib/providers/espn/normalise.ts';
import { espnPathFor } from '../lib/providers/espn/paths.ts';
import { meetingsToRecentGames, recordToStanding } from '../lib/providers/merge.ts';
import type { TeamStanding } from '../lib/games/types';

const LONDON = 'Europe/London';

// ---------------------------------------------------------------------------
// Entity matching — the part that must never guess
// ---------------------------------------------------------------------------

describe('team name matching', () => {
  it('normalises away punctuation, accents and corporate noise', () => {
    assert.deepEqual(teamTokens('Atlético Madrid'), ['atletico', 'madrid']);
    assert.deepEqual(teamTokens('Arsenal FC'), ['arsenal']);
    assert.deepEqual(teamTokens('  Liverpool   F.C. '), ['liverpool']);
  });

  it('resolves common shorthand', () => {
    assert.equal(sameTeam('Man Utd', 'Manchester United'), true);
    assert.equal(sameTeam('Spurs', 'Tottenham Hotspur'), true);
    assert.equal(sameTeam('Wolves', 'Wolverhampton Wanderers'), true);
  });

  it('matches the same club written differently', () => {
    assert.equal(sameTeam('Arsenal', 'Arsenal FC'), true);
    assert.equal(sameTeam('Inter', 'Internazionale'), true);
  });

  it('does NOT match different clubs that share a city', () => {
    assert.equal(sameTeam('Manchester United', 'Manchester City'), false);
    assert.equal(sameTeam('Atletico Madrid', 'Real Madrid'), false);
    assert.equal(sameTeam('AC Milan', 'Inter Milan'), false);
  });

  it('rejects empty or missing names', () => {
    assert.equal(sameTeam(null, 'Arsenal'), false);
    assert.equal(sameTeam('Arsenal', ''), false);
    assert.equal(sameTeam(undefined, undefined), false);
  });
});

describe('fixture matching', () => {
  const target = { date: '2026-09-01', homeTeam: 'Arsenal', awayTeam: 'Chelsea' };

  it('matches on date plus both teams', () => {
    const match = findMatchingGame(target, [
      { date: '2026-09-01', homeTeam: 'Arsenal FC', awayTeam: 'Chelsea FC', id: 'right' },
      { date: '2026-09-01', homeTeam: 'Everton', awayTeam: 'Fulham', id: 'wrong' },
    ]);
    assert.equal(match?.id, 'right');
  });

  it('tolerates home and away being reversed', () => {
    const match = findMatchingGame(target, [
      { date: '2026-09-01', homeTeam: 'Chelsea', awayTeam: 'Arsenal', id: 'reversed' },
    ]);
    assert.equal(match?.id, 'reversed');
  });

  it('refuses a match when only one team agrees', () => {
    assert.equal(
      findMatchingGame(target, [
        { date: '2026-09-01', homeTeam: 'Arsenal', awayTeam: 'Everton', id: 'half' },
      ]),
      null,
    );
  });

  it('refuses a match on a different day', () => {
    assert.equal(
      findMatchingGame(target, [
        { date: '2026-09-02', homeTeam: 'Arsenal', awayTeam: 'Chelsea', id: 'tomorrow' },
      ]),
      null,
    );
  });

  it('treats an ambiguous match as no match', () => {
    assert.equal(
      findMatchingGame(target, [
        { date: '2026-09-01', homeTeam: 'Arsenal', awayTeam: 'Chelsea', id: 'a' },
        { date: '2026-09-01', homeTeam: 'Arsenal FC', awayTeam: 'Chelsea FC', id: 'b' },
      ]),
      null,
    );
  });

  it('returns null with no candidates or no target date', () => {
    assert.equal(findMatchingGame(target, []), null);
    assert.equal(findMatchingGame({ ...target, date: null }, []), null);
  });
});

// ---------------------------------------------------------------------------
// Betting fields must not survive the adapter boundary
// ---------------------------------------------------------------------------

describe('betting field stripping', () => {
  it('removes every betting field', () => {
    const cleaned = stripBetting({
      venue: 'Emirates',
      odds: [{ provider: 'x', spread: -3.5 }],
      pickcenter: [{ moneyline: 120 }],
      hasOdds: true,
      ticketsInfo: { price: 40 },
    });

    for (const field of BETTING_FIELDS) {
      assert.equal(field in cleaned, false, `${field} must be stripped`);
    }
    assert.equal(cleaned.venue, 'Emirates');
  });

  it('never lets odds reach a normalised game', () => {
    const raw = {
      id: '401',
      date: '2026-09-01T19:00Z',
      competitions: [
        {
          odds: [{ spread: -3.5 }],
          pickcenter: [{ moneyline: 120 }],
          hasOdds: true,
          venue: { fullName: 'Emirates Stadium' },
          competitors: [
            { homeAway: 'home', team: { id: '1', displayName: 'Arsenal' } },
            { homeAway: 'away', team: { id: '2', displayName: 'Chelsea' } },
          ],
        },
      ],
    } as RawEspnEvent;

    const game = normaliseEvent(raw, LONDON);
    assert.ok(game);
    const serialised = JSON.stringify(game);
    for (const term of ['odds', 'moneyline', 'spread', 'pickcenter', 'ticketsInfo']) {
      assert.equal(serialised.includes(term), false, `"${term}" must not appear`);
    }
  });
});

// ---------------------------------------------------------------------------
// ESPN normalisation
// ---------------------------------------------------------------------------

/** Shaped from a real site.web.api.espn.com scoreboard response. */
function espnEvent(overrides: Record<string, unknown> = {}): RawEspnEvent {
  return {
    id: '401879288',
    date: '2026-09-01T19:00Z',
    name: 'Liverpool at Ipswich Town',
    competitions: [
      {
        venue: { fullName: 'Portman Road', address: { city: 'Ipswich', country: 'England' } },
        broadcasts: [{ names: ['USA Net'] }],
        competitors: [
          {
            homeAway: 'home',
            team: { id: '373', displayName: 'Ipswich Town', abbreviation: 'IPS', logo: 'l.png' },
            records: [{ type: 'total', summary: '1-0-1' }],
            form: 'LWWWD',
          },
          {
            homeAway: 'away',
            team: { id: '364', displayName: 'Liverpool', abbreviation: 'LIV', logo: 'a.png' },
            records: [{ type: 'total', summary: '2-1-0' }],
            form: 'WWLWW',
          },
        ],
      },
    ],
    ...overrides,
  } as RawEspnEvent;
}

describe('espn normalisation', () => {
  it('extracts records, form, venue and broadcast', () => {
    const game = normaliseEvent(espnEvent(), LONDON);
    assert.ok(game);
    assert.equal(game.id, '401879288');
    assert.equal(game.home?.name, 'Ipswich Town');
    assert.equal(game.home?.abbreviation, 'IPS');
    assert.equal(game.home?.record, '1-0-1');
    assert.deepEqual(game.home?.form, ['L', 'W', 'W', 'W', 'D']);
    assert.equal(game.away?.name, 'Liverpool');
    assert.equal(game.venue.name, 'Portman Road');
    assert.equal(game.venue.city, 'Ipswich');
    assert.equal(game.broadcast, 'USA Net');
  });

  it('computes the match date in the given timezone', () => {
    // 23:30Z on 1 September is 00:30 on 2 September in London.
    const game = normaliseEvent(espnEvent({ date: '2026-09-01T23:30Z' }), LONDON);
    assert.equal(game?.matchDate, '2026-09-02');
    assert.equal(calendarDate('2026-09-01T23:30Z', 'UTC'), '2026-09-01');
  });

  it('leaves absent fields null rather than defaulting them', () => {
    const game = normaliseEvent(
      {
        id: '1',
        competitions: [
          { competitors: [{ homeAway: 'home', team: { displayName: 'Team' } }] },
        ],
      } as RawEspnEvent,
      LONDON,
    );
    assert.ok(game);
    assert.equal(game.venue.name, null);
    assert.equal(game.broadcast, null);
    assert.equal(game.home?.record, null);
    assert.deepEqual(game.home?.form, []);
  });

  it('handles malformed or empty payloads', () => {
    assert.deepEqual(normaliseScoreboard({ events: null }, LONDON), []);
    assert.deepEqual(normaliseScoreboard({}, LONDON), []);
    assert.deepEqual(normaliseScoreboard(null, LONDON), []);
    assert.equal(normaliseEvent({} as RawEspnEvent, LONDON), null);
    assert.equal(normaliseEvent({ id: '1' } as RawEspnEvent, LONDON), null);
  });

  it('prefers the overall record over splits', () => {
    assert.equal(
      overallRecord([
        { type: 'home', summary: '5-1' },
        { type: 'total', summary: '11-2' },
      ]),
      '11-2',
    );
    assert.equal(overallRecord([]), null);
    assert.equal(overallRecord(undefined), null);
  });

  it('parses form strings, ignoring junk', () => {
    assert.deepEqual(parseForm('WWDL'), ['W', 'W', 'D', 'L']);
    assert.deepEqual(parseForm('W-W?D'), ['W', 'W', 'D']);
    assert.deepEqual(parseForm(''), []);
    assert.deepEqual(parseForm(null), []);
  });

  it('extracts previous meetings from seasonseries', () => {
    const meetings = normaliseSeasonSeries({
      seasonseries: [
        {
          events: [
            {
              id: 'm1',
              date: '2026-04-01T14:00Z',
              competitors: [
                { homeAway: 'home', team: { displayName: 'Arsenal' }, score: '2' },
                { homeAway: 'away', team: { displayName: 'Chelsea' }, score: '1' },
              ],
            },
          ],
        },
      ],
    });
    assert.equal(meetings.length, 1);
    assert.equal(meetings[0].home, 'Arsenal');
    assert.equal(meetings[0].homeScore, 2);
    assert.equal(meetings[0].awayScore, 1);
  });

  it('returns no meetings for an absent series', () => {
    assert.deepEqual(normaliseSeasonSeries({}), []);
    assert.deepEqual(normaliseSeasonSeries(null), []);
  });
});

// ---------------------------------------------------------------------------
// Path mapping
// ---------------------------------------------------------------------------

describe('espn path mapping', () => {
  it('maps the North American leagues', () => {
    assert.equal(espnPathFor('nfl', null), 'football/nfl');
    assert.equal(espnPathFor('nba', null), 'basketball/nba');
    assert.equal(espnPathFor('mlb', null), 'baseball/mlb');
    assert.equal(espnPathFor('nhl', null), 'hockey/nhl');
  });

  it('maps football by competition', () => {
    assert.equal(espnPathFor('football', 'English Premier League'), 'soccer/eng.1');
    assert.equal(espnPathFor('football', 'UEFA Champions League'), 'soccer/uefa.champions');
    assert.equal(espnPathFor('football', 'Spanish La Liga'), 'soccer/esp.1');
  });

  it('returns null for an uncovered competition rather than guessing', () => {
    assert.equal(espnPathFor('football', 'Peruvian Primera Division'), null);
    assert.equal(espnPathFor('football', null), null);
  });
});

// ---------------------------------------------------------------------------
// Merge rules
// ---------------------------------------------------------------------------

describe('record parsing and merge', () => {
  const existing: TeamStanding = {
    rank: 3, played: 10, wins: 6, draws: 2, losses: 2,
    goals_for: 20, goals_against: 12, goal_difference: 8, points: 20,
    form: ['W', 'W'], group: 'Group A',
  };

  it('parses a two-part record', () => {
    const standing = recordToStanding('11-2', null);
    assert.equal(standing?.wins, 11);
    assert.equal(standing?.losses, 2);
    assert.equal(standing?.draws, null, 'a two-part record has no draws');
  });

  it('parses a three-part record', () => {
    const standing = recordToStanding('1-0-1', null);
    assert.equal(standing?.wins, 1);
    assert.equal(standing?.draws, 0);
    assert.equal(standing?.losses, 1);
  });

  it('keeps existing detail the enrichment provider does not supply', () => {
    const standing = recordToStanding('7-1-2', existing);
    assert.equal(standing?.wins, 7, 'enriched value wins for the record');
    assert.equal(standing?.rank, 3, 'existing rank is preserved');
    assert.equal(standing?.points, 20, 'existing points are preserved');
  });

  it('returns the existing standing untouched for an unparseable record', () => {
    assert.equal(recordToStanding('not-a-record', existing), existing);
    assert.equal(recordToStanding(null, existing), existing);
    assert.equal(recordToStanding(null, null), null);
  });

  it('maps meetings from the chosen team perspective', () => {
    const meetings = [
      { id: 'm1', date: '2026-04-01T14:00Z', home: 'Arsenal', away: 'Chelsea', homeScore: 2, awayScore: 1 },
      { id: 'm2', date: '2026-01-01T14:00Z', home: 'Chelsea', away: 'Arsenal', homeScore: 0, awayScore: 3 },
    ];

    const arsenal = meetingsToRecentGames(meetings, 'Arsenal');
    assert.equal(arsenal.length, 2);
    assert.equal(arsenal[0].result, 'W');
    assert.equal(arsenal[0].home, true);
    assert.equal(arsenal[1].result, 'W');
    assert.equal(arsenal[1].home, false);
    assert.equal(arsenal[1].opponent, 'Chelsea');
  });

  it('leaves a result null when a score is missing', () => {
    const games = meetingsToRecentGames(
      [{ id: 'm', date: null, home: 'Arsenal', away: 'Chelsea', homeScore: null, awayScore: null }],
      'Arsenal',
    );
    assert.equal(games[0].result, null);
  });

  it('returns nothing when the team is unknown', () => {
    assert.deepEqual(meetingsToRecentGames([], null), []);
  });
});
