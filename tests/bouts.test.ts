import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  BOUT_CONFIG,
  STARTING_ELO,
  buildBoutRatings,
  projectBout,
  ratingKey,
  toBoutResults,
} from '../lib/projections/bout-model.ts';
import { backtestBouts, calibrationBands } from '../lib/projections/bout-backtest.ts';
import { normaliseBoutFixtures } from '../lib/providers/espn/bouts.ts';
import { findLeague } from '../lib/leagues/registry.ts';
import type { Game } from '../lib/home/types';

const UFC = findLeague('ufc')!;

function fight(overrides: Partial<Game> & Record<string, unknown> = {}): Game {
  return {
    id: Math.random().toString(36).slice(2),
    sport: 'mma',
    league: 'UFC',
    league_badge: null,
    season: '2025',
    round: null,
    start_time: '2025-06-07T22:00:00.000Z',
    status: 'finished',
    provider_status: 'Final',
    home_team: { id: 'a', name: 'Fighter A', logo: null },
    away_team: { id: 'b', name: 'Fighter B', logo: null },
    venue: { name: null, city: null, country: null, indoor: null },
    broadcast: null,
    winner: 'home',
    division: 'Lightweight',
    scheduledRounds: 3,
    ...overrides,
  } as Game;
}

describe('reading a card from the provider', () => {
  const payload = {
    events: [
      {
        id: '600',
        name: 'UFC 316: Dvalishvili vs. O’Malley 2',
        date: '2025-06-07T22:00Z',
        season: { year: 2025 },
        venue: { fullName: 'Prudential Center', address: { city: 'Newark', country: 'USA' } },
        competitions: [
          {
            id: '1',
            date: '2025-06-07T23:00Z',
            status: { type: { name: 'STATUS_FINAL', completed: true, shortDetail: 'Final' } },
            type: { abbreviation: 'Lightweight' },
            format: { regulation: { periods: 3 } },
            competitors: [
              { id: '111', order: 1, winner: false, athlete: { displayName: 'Joe Solecki' } },
              { id: '222', order: 2, winner: true, athlete: { displayName: 'Nurullo Aliev' } },
            ],
          },
          {
            id: '2',
            date: '2025-06-07T23:45Z',
            status: { type: { name: 'STATUS_FINAL', completed: true, shortDetail: 'Final' } },
            type: { abbreviation: 'Heavyweight' },
            format: { regulation: { periods: 5 } },
            competitors: [
              { id: '333', order: 1, athlete: { displayName: 'Drawn One' } },
              { id: '444', order: 2, athlete: { displayName: 'Drawn Two' } },
            ],
          },
        ],
      },
    ],
  };

  const games = normaliseBoutFixtures(payload, UFC);

  it('turns one card into one fixture per fight', () => {
    // The opposite of every team sport, where one event is one fixture.
    assert.equal(games.length, 2);
  });

  it('never invents a scoreline', () => {
    /*
     * The whole reason `winner` exists. Recording a fight as 1-0 would put a
     * score on a sport that has none, and would let anything reading `score`
     * treat it as a one-nil football match.
     */
    for (const game of games) assert.equal(game.score, undefined);
  });

  it('records who won, by card order', () => {
    assert.equal(games[0].home_team?.name, 'Joe Solecki');
    assert.equal(games[0].away_team?.name, 'Nurullo Aliev');
    assert.equal(games[0].winner, 'away');
  });

  it('reads a draw or no-contest as neither fighter winning', () => {
    // Both are real outcomes rather than missing data, and both settle as void.
    assert.equal(games[1].winner, null);
  });

  it('carries the division and the scheduled distance', () => {
    assert.equal(games[0].division, 'Lightweight');
    assert.equal(games[0].scheduledRounds, 3);
    assert.equal(games[1].scheduledRounds, 5);
  });

  it('names the card each fight belongs to', () => {
    assert.ok(games[0].title?.includes('UFC 316'));
  });

  it('drops anything that is not two distinct fighters', () => {
    const broken = normaliseBoutFixtures(
      {
        events: [
          {
            id: '1',
            competitions: [
              { id: '9', competitors: [{ id: '1', athlete: { displayName: 'Only One' } }] },
              {
                id: '10',
                competitors: [
                  { id: '5', order: 1, athlete: { displayName: 'Same' } },
                  { id: '5', order: 2, athlete: { displayName: 'Same' } },
                ],
              },
            ],
          },
        ],
      },
      UFC,
    );
    assert.equal(broken.length, 0);
  });
});

describe('rating fighters', () => {
  it('never lets a fight see its own result', () => {
    const games = [
      fight({ id: 'early', start_time: '2024-01-01T00:00:00.000Z' }),
      fight({ id: 'late', start_time: '2025-01-01T00:00:00.000Z' }),
    ];
    const cutoff = Date.parse('2025-01-01T00:00:00.000Z');
    const results = toBoutResults(games, cutoff);
    assert.deepEqual(results.map((r) => r.date), [Date.parse('2024-01-01T00:00:00.000Z')]);
  });

  it('rates a fighter separately at each division', () => {
    /*
     * §4.8.a step 8. A rating carried across weight classes would assert an
     * equivalence nobody has established, so a fighter moving up starts where
     * a debutant does.
     */
    const games = [
      fight({ division: 'Lightweight' }),
      fight({ division: 'Welterweight', winner: 'away' }),
    ];
    const ratings = buildBoutRatings(toBoutResults(games, Number.POSITIVE_INFINITY));
    const light = ratings.fighters.get(ratingKey('a', 'Lightweight'));
    const welter = ratings.fighters.get(ratingKey('a', 'Welterweight'));

    assert.equal(light?.fights, 1);
    assert.equal(welter?.fights, 1);
    // Won one, lost the other: the two ratings must move opposite ways.
    assert.ok((light?.elo ?? 0) > STARTING_ELO);
    assert.ok((welter?.elo ?? 0) < STARTING_ELO);
  });

  it('remembers that a fighter has moved weight', () => {
    const games = [fight({ division: 'Lightweight' }), fight({ division: 'Welterweight' })];
    const ratings = buildBoutRatings(toBoutResults(games, Number.POSITIVE_INFINITY));
    assert.equal(ratings.divisionsFought.get('a')?.size, 2);
  });

  it('moves the winner up and the loser down by the same amount', () => {
    // Nothing is created or destroyed in a single Elo exchange.
    const ratings = buildBoutRatings(toBoutResults([fight()], Number.POSITIVE_INFINITY));
    const winner = ratings.fighters.get(ratingKey('a', 'Lightweight'))!;
    const loser = ratings.fighters.get(ratingKey('b', 'Lightweight'))!;
    assert.ok(Math.abs(winner.elo - STARTING_ELO - (STARTING_ELO - loser.elo)) < 1e-9);
  });

  it('leaves a draw with both fighters where they started', () => {
    const ratings = buildBoutRatings(
      toBoutResults([fight({ winner: null })], Number.POSITIVE_INFINITY),
    );
    assert.ok(Math.abs(ratings.fighters.get(ratingKey('a', 'Lightweight'))!.elo - STARTING_ELO) < 1e-9);
    assert.ok(Math.abs(ratings.fighters.get(ratingKey('b', 'Lightweight'))!.elo - STARTING_ELO) < 1e-9);
  });

  it('rewards beating a rated fighter more than beating an unrated one', () => {
    // Elo carries opposition strength on its own, which is why this model has
    // no second pass for it the way the team model does.
    const build = (opponentWins: number) => {
      const games: Game[] = [];
      for (let i = 0; i < opponentWins; i += 1) {
        games.push(
          fight({
            id: `warm${i}`,
            start_time: `2023-0${(i % 9) + 1}-01T00:00:00.000Z`,
            home_team: { id: 'strong', name: 'Strong', logo: null },
            away_team: { id: `jobber${i}`, name: `Jobber ${i}`, logo: null },
            winner: 'home',
          }),
        );
      }
      games.push(
        fight({
          id: 'test',
          start_time: '2024-01-01T00:00:00.000Z',
          home_team: { id: 'challenger', name: 'Challenger', logo: null },
          away_team: { id: 'strong', name: 'Strong', logo: null },
          winner: 'home',
        }),
      );
      const ratings = buildBoutRatings(toBoutResults(games, Number.POSITIVE_INFINITY));
      return ratings.fighters.get(ratingKey('challenger', 'Lightweight'))!.elo;
    };

    assert.ok(build(5) > build(0));
  });
});

describe('projecting a fight', () => {
  const seasoned = (id: string, wins: number) => {
    const games: Game[] = [];
    for (let i = 0; i < wins; i += 1) {
      games.push(
        fight({
          id: `${id}-${i}`,
          start_time: `2024-0${(i % 9) + 1}-01T00:00:00.000Z`,
          home_team: { id, name: id, logo: null },
          away_team: { id: `foe-${id}-${i}`, name: 'Foe', logo: null },
          winner: 'home',
        }),
      );
    }
    return games;
  };

  it('says nothing when either fighter is below the floor', () => {
    /*
     * The answer for most of a card, and correct. §4.8.a step 6: a prospect
     * with two fights gets "insufficient data", not a confident guess.
     */
    const ratings = buildBoutRatings(toBoutResults(seasoned('a', 8), Number.POSITIVE_INFINITY));
    assert.equal(projectBout('a', 'nobody', 'Lightweight', ratings), null);
    assert.equal(projectBout('nobody', 'a', 'Lightweight', ratings), null);
  });

  it('says nothing at a division neither has fought at', () => {
    const ratings = buildBoutRatings(toBoutResults(seasoned('a', 8), Number.POSITIVE_INFINITY));
    assert.equal(projectBout('a', 'a', 'Heavyweight', ratings), null);
  });

  it('favours the fighter with the better record', () => {
    const games = [...seasoned('winner', 6), ...seasoned('loser', 6).map((g, i) => ({
      ...g,
      id: `l${i}`,
      winner: 'away' as const,
    }))];
    const ratings = buildBoutRatings(toBoutResults(games, Number.POSITIVE_INFINITY));
    const projection = projectBout('winner', 'loser', 'Lightweight', ratings);
    assert.ok(projection);
    assert.ok(projection.home > 0.5, `expected the winner favoured, got ${projection.home}`);
    assert.ok(Math.abs(projection.home + projection.away - 1) < 1e-9);
  });

  it('gives two identical records an even fight, with no advantage to card order', () => {
    /*
     * There is no home side in a fight. If listing order ever moved the
     * number, the model would be reading a venue advantage into a presentation
     * detail.
     */
    const games = [...seasoned('x', 6), ...seasoned('y', 6)];
    const ratings = buildBoutRatings(toBoutResults(games, Number.POSITIVE_INFINITY));
    const forward = projectBout('x', 'y', 'Lightweight', ratings)!;
    const reversed = projectBout('y', 'x', 'Lightweight', ratings)!;
    assert.ok(Math.abs(forward.home - reversed.home) < 1e-9);
    assert.ok(Math.abs(forward.home - 0.5) < 1e-9);
  });

  it('reports lower data quality for a thinner record', () => {
    const thin = buildBoutRatings(
      toBoutResults([...seasoned('a', 3), ...seasoned('b', 3)], Number.POSITIVE_INFINITY),
    );
    const thick = buildBoutRatings(
      toBoutResults([...seasoned('a', 10), ...seasoned('b', 10)], Number.POSITIVE_INFINITY),
    );
    const thinQ = projectBout('a', 'b', 'Lightweight', thin)!.dataQuality;
    const thickQ = projectBout('a', 'b', 'Lightweight', thick)!.dataQuality;
    assert.ok(thickQ > thinQ);
    assert.ok(thickQ <= 1);
  });
});

describe('the fight backtest', () => {
  it('reports what it could not project rather than hiding it', () => {
    // Coverage is the honest half of the result: on a real card this model
    // declines more fights than it takes.
    const report = backtestBouts([fight(), fight({ id: 'other' })], { minHistory: 0 });
    assert.ok(report.skipped > 0);
    assert.equal(report.evaluated, 0);
  });

  it('buckets calibration on the favourite, not on card order', () => {
    /*
     * A fight has no home side, so bucketing on "probability the first-listed
     * fighter wins" would smear every band toward even money and make a badly
     * calibrated model look perfect.
     */
    const bands = calibrationBands([
      { game_id: '1', probability_home: 0.2, actual: 'away', correct: true, brier: 0, log_loss: 0, data_quality: 1, division: 'x' },
      { game_id: '2', probability_home: 0.8, actual: 'home', correct: true, brier: 0, log_loss: 0, data_quality: 1, division: 'x' },
    ]);
    // Both are 80% calls on the favourite, so both belong in the same band.
    assert.equal(bands.length, 1);
    assert.equal(bands[0].count, 2);
    assert.equal(bands[0].actual, 1);
  });
});

describe('the UFC catalogue entry', () => {
  it('is a bout competition, not a fixture one', () => {
    assert.equal(UFC.format, 'bout');
    assert.equal(UFC.sport, 'mma');
  });

  it('claims no standings or transactions', () => {
    // Neither exists for an individual athlete on this provider, and claiming
    // them would show a permanently empty section that looks broken.
    assert.equal(UFC.hasStandings, false);
    assert.equal(UFC.hasTransactions, false);
  });

  it('has no boxing sibling, because the provider has no boxing', () => {
    // Checked 2026-09-10: every boxing path 404s. A placeholder entry would be
    // a competition the application could never fill.
    assert.equal(findLeague('boxing'), null);
  });

  it('carries a bout config the sport actually needs', () => {
    // A fighter has a handful of fights in a career, so the window is years and
    // the rating has to move fast enough to arrive somewhere within it.
    assert.ok(BOUT_CONFIG.historyDays >= 3 * 365);
    assert.ok(BOUT_CONFIG.eloK > 100);
  });
});
