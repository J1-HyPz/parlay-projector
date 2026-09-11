import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOUT_CONFIG,
  TENNIS_CONFIG,
  WTA_CONFIG,
  boutConfigForLeague,
  buildBoutRatings,
  toBoutResults,
} from '../lib/projections/bout-model.ts';
import { normaliseTennisFixtures } from '../lib/providers/espn/tennis.ts';
import { findLeague } from '../lib/leagues/registry.ts';
import { sportOptions } from '../lib/leagues/catalogue.ts';

const ATP = findLeague('atp')!;

const payload = {
  events: [
    {
      id: '900',
      name: 'Brisbane International',
      date: '2025-01-02T05:00Z',
      season: { year: 2025 },
      venue: { displayName: 'Brisbane, Australia' },
      groupings: [
        {
          grouping: { slug: 'mens-singles' },
          competitions: [
            {
              id: '1',
              date: '2025-01-02T06:00Z',
              round: { displayName: 'Round 1' },
              status: { type: { name: 'STATUS_FINAL', completed: true, shortDetail: 'Final' } },
              competitors: [
                {
                  id: '310',
                  order: 1,
                  winner: true,
                  athlete: { displayName: 'Richard Gasquet' },
                  linescores: [{ value: 6 }, { value: 6 }],
                },
                {
                  id: '12297',
                  order: 2,
                  winner: false,
                  athlete: { displayName: 'Derek Pham' },
                  linescores: [{ value: 1 }, { value: 2 }],
                },
              ],
            },
            {
              id: '2',
              date: '2025-01-02T08:00Z',
              round: { displayName: 'Round 1' },
              status: { type: { name: 'STATUS_RETIRED', completed: true, shortDetail: 'Retired' } },
              competitors: [
                { id: '55', order: 1, winner: true, athlete: { displayName: 'Kei Nishikori' }, linescores: [{ value: 4 }] },
                { id: '66', order: 2, winner: false, athlete: { displayName: 'Shang Juncheng' }, linescores: [{ value: 3 }] },
              ],
            },
            {
              id: '3',
              date: '2025-01-02T09:00Z',
              round: { displayName: 'Round 1' },
              status: { type: { name: 'STATUS_WALKOVER', completed: true, shortDetail: 'Walkover' } },
              competitors: [
                { id: '77', order: 1, winner: true, athlete: { displayName: 'Given A Bye' } },
                { id: '88', order: 2, winner: false, athlete: { displayName: 'Withdrew' } },
              ],
            },
          ],
        },
        {
          grouping: { slug: 'mens-doubles' },
          competitions: [
            {
              id: '4',
              date: '2025-01-02T10:00Z',
              status: { type: { name: 'STATUS_FINAL', completed: true } },
              competitors: [
                { id: '901', order: 1, winner: true, roster: { athletes: [{ displayName: 'A' }, { displayName: 'B' }] } },
                { id: '902', order: 2, winner: false, roster: { athletes: [{ displayName: 'C' }, { displayName: 'D' }] } },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('reading a tennis draw', () => {
  const games = normaliseTennisFixtures(payload, ATP, 'mens-singles');

  it('reaches the matches nested inside a tournament', () => {
    // A tennis event is a tournament, and the matches are two levels down.
    assert.equal(games.length, 3);
  });

  it('never lets a doubles pair into a singles competition', () => {
    /*
     * Structural rather than by name: a doubles competitor has no `athlete` at
     * all, it has a `roster` of two. A pair is not an individual and must never
     * reach a rating keyed on one person.
     */
    const doubles = normaliseTennisFixtures(payload, ATP, 'mens-doubles');
    assert.equal(doubles.length, 0);
  });

  it('keeps games per set rather than flattening them', () => {
    // 6-1 6-2. Sets-won would throw away what a total-games market needs, and
    // total games would read as a scoreline nobody recognises.
    assert.deepEqual(games[0].setGames, { home: [6, 6], away: [1, 2] });
    assert.equal(games[0].score, undefined);
  });

  it('tells a retirement and a walkover apart from an ordinary win', () => {
    // Both are real outcomes the provider publishes as their own statuses, and
    // §4.8.b requires a retirement to settle as void rather than as a loss.
    assert.equal(games[0].completion, 'played');
    assert.equal(games[1].completion, 'retired');
    assert.equal(games[2].completion, 'walkover');
  });

  it('carries the round and the tournament', () => {
    assert.equal(games[0].round, 'Round 1');
    assert.equal(games[0].title, 'Brisbane International');
  });

  it('drops an unfilled draw slot, which is a bracket row and not a match', () => {
    /*
     * A tournament that has not started publishes its whole empty bracket —
     * 64 slots, then 32, then 16, down to the final, every one "TBD v TBD".
     * Measured 2026-09-11: 247 of 249 upcoming ATP matches were these. Left
     * in, the Schedule shows rows naming nobody and the projection engine
     * reports them as matches it declined for want of history, which is not
     * why it declined them.
     *
     * Structural, like the doubles guard: a placeholder carries a negative
     * id, the same pair in every slot of every tournament.
     */
    const bracket = normaliseTennisFixtures(
      {
        events: [
          {
            id: '441-2026',
            name: 'Chengdu Open',
            date: '2026-09-23T04:00Z',
            groupings: [
              {
                grouping: { slug: 'mens-singles' },
                competitions: [
                  {
                    id: '183393',
                    date: '2026-09-23T04:00Z',
                    round: { displayName: 'Round 1' },
                    status: { type: { name: 'STATUS_SCHEDULED' } },
                    competitors: [
                      { id: '-3', order: 1, athlete: { displayName: 'TBD' } },
                      { id: '-4', order: 2, athlete: { displayName: 'TBD' } },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      ATP,
      'mens-singles',
    );

    assert.equal(bracket.length, 0);
  });

  it('keeps a real match, so the guard cannot swallow the draw it came for', () => {
    // The same check from the other side: a positive id is a person.
    assert.equal(games.length, 3);
    assert.ok(games.every((game) => Number(game.home_team?.id) > 0));
  });
});

describe('what a tennis rating counts', () => {
  const games = normaliseTennisFixtures(payload, ATP, 'mens-singles');

  it('drops a walkover, because no tennis was played', () => {
    /*
     * The opponent withdrew before play, so the winner did nothing to earn it.
     * A retirement is different and is kept: a set was played and the player
     * who stopped was losing it.
     */
    const results = toBoutResults(games, Number.POSITIVE_INFINITY);
    const ids = results.flatMap((r) => [r.homeId, r.awayId]);
    assert.ok(!ids.includes('77'), 'a walkover must not rate anybody');
    assert.ok(ids.includes('55'), 'a retirement is still a played match');
  });

  it('rates a retirement as a win for whoever was still standing', () => {
    const ratings = buildBoutRatings(
      toBoutResults(games, Number.POSITIVE_INFINITY),
      TENNIS_CONFIG,
    );
    const winner = [...ratings.fighters.values()].find((r) => r.fighter === '55');
    assert.equal(winner?.wins, 1);
  });
});

describe('tennis configuration', () => {
  it('moves a rating far more slowly than a fighter’s', () => {
    /*
     * The schedule, not a judgement about the sports. A tour player contests
     * fifty or eighty matches a year where a fighter has two or three, so a
     * rating has vastly more chances to find its level and each should move it
     * less.
     */
    assert.ok(TENNIS_CONFIG.eloK < BOUT_CONFIG.eloK / 3);
  });

  it('gives the two tours their own K, because they measured differently', () => {
    // One config was tried for both and left the WTA 2.1 points
    // under-confident; its own K brings that to 0.15.
    assert.notEqual(WTA_CONFIG.eloK, TENNIS_CONFIG.eloK);
    assert.equal(boutConfigForLeague('atp'), TENNIS_CONFIG);
    assert.equal(boutConfigForLeague('wta'), WTA_CONFIG);
    assert.equal(boutConfigForLeague('ufc'), BOUT_CONFIG);
  });

  it('refuses a competition this engine does not rate', () => {
    // A team fixture handed to the individual model would be rated as though
    // two people had played it.
    assert.equal(boutConfigForLeague('nba'), null);
    assert.equal(boutConfigForLeague('f1'), null);
    assert.equal(boutConfigForLeague('epl'), null);
  });
});

describe('the tennis catalogue entries', () => {
  it('keeps the two tours as separate competitions', () => {
    // Separately drawn and separately ranked, and the feeds are genuinely
    // different: of 46 tournaments in one quarter only 7 appear in both.
    const atp = findLeague('atp');
    const wta = findLeague('wta');
    assert.equal(atp?.sport, 'tennis');
    assert.equal(wta?.sport, 'tennis');
    assert.notEqual(atp?.espnPath, wta?.espnPath);
  });

  it('names the draw to read, because a tour alone does not identify one', () => {
    /*
     * A tournament payload holds every draw it ran, singles and all three
     * doubles. Without the draw, a singles competition would be built from
     * doubles pairs as well.
     */
    assert.equal(findLeague('atp')?.espnDraw, 'mens-singles');
    assert.equal(findLeague('wta')?.espnDraw, 'womens-singles');
  });

  it('claims no standings, because a rolling ranking is not a table', () => {
    assert.equal(findLeague('atp')?.hasStandings, false);
    assert.equal(findLeague('wta')?.hasStandings, false);
  });

  it('offers both tours in parlays', () => {
    // The model exists, is calibrated, and is now wired to the selection
    // layer — so the selector lists the tours rather than explaining their
    // absence.
    const tennis = sportOptions().find((option) => option.id === 'tennis');
    assert.ok(tennis?.supported);
    assert.equal(tennis.unavailable, null);
    assert.deepEqual(
      tennis.competitions.map((competition) => competition.id).sort(),
      ['atp', 'wta'],
    );
  });
});
