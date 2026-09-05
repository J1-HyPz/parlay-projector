import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isRaceSession,
  normaliseRaceFixtures,
  normaliseSession,
  sessionName,
} from '../lib/providers/espn/racing.ts';
import {
  RACE_CONFIG,
  buildRaceRatings,
  finishProbability,
  headToHeadProbability,
  jointRaceProbability,
  meanPosition,
  raceDataQuality,
  raceQualityReasons,
  simulateRace,
  toRaceResults,
} from '../lib/projections/race-model.ts';
import { gridFrom, projectRace, raceSelections } from '../lib/projections/race-selections.ts';
import { evidenceFor, outcomeOf, settle } from '../lib/projections/settlement.ts';
import { whatNeedsToHappen, selectionLabel } from '../lib/markets/explain.ts';
import { isSettlementRule } from '../lib/projections/store-parse.ts';
import { sidesOf } from '../lib/home/types.ts';
import type { Game } from '../lib/home/types.ts';
import type { League } from '../lib/leagues/registry.ts';

const F1: League = {
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
};

/** A grid of drivers, quickest first. */
const FIELD = [
  'Alpha',
  'Bravo',
  'Charlie',
  'Delta',
  'Echo',
  'Foxtrot',
  'Golf',
  'Hotel',
  'India',
  'Juliet',
  'Kilo',
  'Lima',
];

function raceGame(id: string, overrides: Partial<Game> = {}): Game {
  return {
    id,
    sport: 'f1',
    league: 'Formula 1',
    league_badge: null,
    season: '2026',
    round: null,
    start_time: '2026-09-06T13:00:00.000Z',
    status: 'scheduled',
    provider_status: null,
    session: 'Race',
    title: 'Italian Grand Prix',
    entrants: [],
    venue: { name: 'Monza', city: 'Monza', country: 'Italy' },
    broadcast: null,
    ...overrides,
  };
}

/** A finished race where the field came home in the order given. */
function finishedRace(id: string, date: string, order: readonly string[]): Game {
  return raceGame(id, {
    status: 'finished',
    start_time: date,
    entrants: order.map((name, index) => ({
      id: name,
      name,
      affiliation: null,
      position: index + 1,
      logo: null,
    })),
  });
}

/** A season where the field's order is stable, so strength is learnable. */
function syntheticSeason(count: number): Game[] {
  return Array.from({ length: count }, (_, i) =>
    finishedRace(
      `race-${i}`,
      `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}T13:00:00.000Z`,
      FIELD,
    ),
  );
}

// ---------------------------------------------------------------------------
// Provider normalisation
// ---------------------------------------------------------------------------

describe('race weekend normalisation', () => {
  const payload = {
    events: [
      {
        id: '600057427',
        date: '2026-09-04T10:30Z',
        name: 'Pirelli Italian Grand Prix',
        shortName: 'Italian GP',
        season: { year: 2026 },
        circuit: { fullName: 'Autodromo di Monza', address: { city: 'Monza', country: 'Italy' } },
        competitions: [
          {
            id: '1',
            date: '2026-09-04T11:30Z',
            type: { abbreviation: 'FP1' },
            status: { type: { name: 'STATUS_FINAL', completed: true } },
            competitors: [
              { id: 'a', order: 1, winner: false, athlete: { id: '5', displayName: 'Alpha' } },
              { id: 'b', order: 2, winner: false, athlete: { id: '6', displayName: 'Bravo' } },
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
    ],
  };

  const games = normaliseRaceFixtures(payload, F1);

  it('produces one fixture per session', () => {
    // Sessions run on different days with their own statuses, so a day-based
    // schedule needs them separately.
    assert.equal(games.length, 3);
    assert.deepEqual(
      games.map((game) => game.session),
      ['Practice 1', 'Qualifying', 'Race'],
    );
  });

  it('never invents two sides for a race', () => {
    for (const game of games) {
      assert.equal(game.home_team, undefined, game.session ?? '');
      assert.equal(game.away_team, undefined, game.session ?? '');
      assert.equal(sidesOf(game), null);
    }
  });

  it('names the event rather than a pairing of its drivers', () => {
    assert.equal(games[0].title, 'Pirelli Italian Grand Prix');
    assert.equal(games[0].venue.name, 'Autodromo di Monza');
  });

  it('carries the field, in the order the provider classified it', () => {
    assert.deepEqual(
      games[0].entrants?.map((entrant) => `${entrant.position}:${entrant.name}`),
      ['1:Alpha', '2:Bravo'],
    );
  });

  it('gives each session its own start time and status', () => {
    assert.equal(games[0].status, 'finished');
    assert.equal(games[2].status, 'scheduled');
    assert.equal(games[2].start_time, '2026-09-06T13:00:00.000Z');
  });

  it('translates the provider shorthand', () => {
    assert.equal(sessionName('FP2', null), 'Practice 2');
    assert.equal(sessionName('Qual', null), 'Qualifying');
    assert.equal(sessionName('SS', null), 'Sprint Shootout');
    // An unknown code falls back rather than being dropped.
    assert.equal(sessionName('XYZ', 'Warm Up'), 'Warm Up');
    assert.equal(isRaceSession('Race'), true);
    assert.equal(isRaceSession('Qual'), false);
  });

  it('drops a session with no identity rather than guessing one', () => {
    assert.equal(normaliseSession({ name: 'GP' }, { type: { abbreviation: 'Race' } }, F1), null);
  });
});

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

describe('driver ratings', () => {
  const season = syntheticSeason(12);

  it('reads only the race, never practice or qualifying', () => {
    const withPractice = [
      ...season,
      finishedRace('fp', '2026-05-01T11:00:00.000Z', [...FIELD].reverse()),
    ];
    withPractice[withPractice.length - 1].session = 'Practice 1';

    const results = toRaceResults(withPractice, Number.POSITIVE_INFINITY);
    assert.equal(results.length, 12, 'the practice session was not counted');
  });

  it('refuses to see a race that had not happened', () => {
    // The look-ahead guard, in the same shape as the scoring model's.
    const cutoff = Date.parse('2026-01-10T00:00:00.000Z');
    const results = toRaceResults(season, cutoff);
    assert.ok(results.length > 0 && results.length < 12);
    for (const race of results) assert.ok(race.date < cutoff);
  });

  it('rates a consistent winner above a consistent backmarker', () => {
    const ratings = buildRaceRatings(toRaceResults(season, Number.POSITIVE_INFINITY));
    const best = ratings.drivers.get('Alpha')!;
    const worst = ratings.drivers.get('Lima')!;

    assert.ok(best.strength > worst.strength, `${best.strength} vs ${worst.strength}`);
    assert.equal(best.meanPosition, 1);
    assert.equal(worst.meanPosition, FIELD.length);
  });

  it('regresses a thin record toward the field average', () => {
    const one = buildRaceRatings(toRaceResults(syntheticSeason(1), Number.POSITIVE_INFINITY));
    const many = buildRaceRatings(toRaceResults(syntheticSeason(20), Number.POSITIVE_INFINITY));

    // One race is barely evidence; twenty is a season.
    const thin = one.drivers.get('Alpha')!.strength;
    const full = many.drivers.get('Alpha')!.strength;
    assert.ok(thin < full, `${thin} should be pulled toward the average more than ${full}`);
    assert.ok(thin > 0.5, 'but still above average, since they did win');
  });

  it('ignores a race with nobody classified', () => {
    const empty = raceGame('empty', { status: 'finished', entrants: [] });
    assert.deepEqual(toRaceResults([empty], Number.POSITIVE_INFINITY), []);
  });
});

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

describe('race simulation', () => {
  const ratings = buildRaceRatings(toRaceResults(syntheticSeason(20), Number.POSITIVE_INFINITY));
  const distribution = simulateRace(FIELD, ratings, {
    simulations: 8000,
    seed: 7,
    noise: RACE_CONFIG.raceNoise,
  });

  it('finishes exactly one driver in each position', () => {
    for (const order of distribution.positions.slice(0, 50)) {
      const places = [...order].sort((a, b) => a - b);
      assert.deepEqual(places, FIELD.map((_, i) => i + 1));
    }
  });

  it('has exactly one winner per race, so win probabilities sum to one', () => {
    const total = FIELD.reduce(
      (sum, driver) => sum + finishProbability(distribution, driver, 1),
      0,
    );
    assert.ok(Math.abs(total - 1) < 0.02, `win probabilities sum to ${total}`);
  });

  it('never rates a narrower market above a wider one', () => {
    // They come off the same simulated orders, so this holds by construction
    // rather than by assertion — which is the point of doing it this way.
    for (const driver of FIELD) {
      const win = finishProbability(distribution, driver, 1);
      const podium = finishProbability(distribution, driver, 3);
      const five = finishProbability(distribution, driver, 5);
      const points = finishProbability(distribution, driver, 10);

      assert.ok(win <= podium + 1e-9, driver);
      assert.ok(podium <= five + 1e-9, driver);
      assert.ok(five <= points + 1e-9, driver);
    }
  });

  it('favours the quicker driver without making them certain', () => {
    const best = finishProbability(distribution, 'Alpha', 1);
    const worst = finishProbability(distribution, 'Lima', 1);
    assert.ok(best > worst);
    // A model that says the quickest car always wins is not modelling a race.
    assert.ok(best < 0.95, `a single driver won ${best} of simulated races`);
  });

  it('makes head-to-heads symmetric', () => {
    const forward = headToHeadProbability(distribution, 'Alpha', 'Bravo');
    const reverse = headToHeadProbability(distribution, 'Bravo', 'Alpha');
    // Somebody finishes ahead; there is no dead heat in a classified order.
    assert.ok(Math.abs(forward + reverse - 1) < 0.02, `${forward} + ${reverse}`);
  });

  it('orders the field by mean finishing position', () => {
    assert.ok(meanPosition(distribution, 'Alpha') < meanPosition(distribution, 'Lima'));
  });

  it('counts a combination rather than multiplying it', () => {
    // A driver winning and the same driver on the podium are nearly the same
    // bet; the product would understate the pair badly.
    const win = finishProbability(distribution, 'Alpha', 1);
    const podium = finishProbability(distribution, 'Alpha', 3);
    const joint = jointRaceProbability(distribution, [
      { driver: 'Alpha', within: 1 },
      { driver: 'Alpha', within: 3 },
    ]);

    // Winning implies the podium, so the joint is exactly the win.
    assert.ok(Math.abs(joint - win) < 1e-9);
    assert.ok(joint > win * podium, 'multiplying would have understated it');
  });

  it('shifts the order when a grid is known', () => {
    // Alpha is quickest but starts last; a known grid should cost them.
    const grid = new Map(FIELD.map((driver, index) => [driver, FIELD.length - index]));
    const gridded = simulateRace(FIELD, ratings, {
      simulations: 8000,
      seed: 7,
      noise: RACE_CONFIG.raceNoise,
      grid,
    });

    assert.ok(
      finishProbability(gridded, 'Alpha', 1) < finishProbability(distribution, 'Alpha', 1),
      'starting last should reduce the win probability',
    );
  });

  it('is reproducible from its seed', () => {
    const again = simulateRace(FIELD, ratings, {
      simulations: 2000,
      seed: 7,
      noise: RACE_CONFIG.raceNoise,
    });
    const once = simulateRace(FIELD, ratings, {
      simulations: 2000,
      seed: 7,
      noise: RACE_CONFIG.raceNoise,
    });
    assert.equal(finishProbability(again, 'Alpha', 3), finishProbability(once, 'Alpha', 3));
  });
});

// ---------------------------------------------------------------------------
// Data quality
// ---------------------------------------------------------------------------

describe('race data quality', () => {
  const full = buildRaceRatings(toRaceResults(syntheticSeason(20), Number.POSITIVE_INFINITY));
  const thin = buildRaceRatings(toRaceResults(syntheticSeason(1), Number.POSITIVE_INFINITY));

  it('rates a full season above a single race', () => {
    assert.ok(raceDataQuality(FIELD, full, false) > raceDataQuality(FIELD, thin, false));
  });

  it('counts a known grid as real information', () => {
    assert.ok(raceDataQuality(FIELD, full, true) > raceDataQuality(FIELD, full, false));
  });

  it('is never inflated by drivers it has never seen', () => {
    const unknown = [...FIELD, 'Mystery', 'Unknown', 'Nobody'];
    assert.ok(raceDataQuality(unknown, full, false) < raceDataQuality(FIELD, full, false));
  });

  it('always states what is missing from this competition', () => {
    const reasons = raceQualityReasons(FIELD, full, false);
    assert.ok(reasons.some((reason) => /no lap times/i.test(reason)));
    assert.ok(reasons.some((reason) => /qualifying has not been run/i.test(reason)));
  });
});

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

describe('race selections', () => {
  const ratings = buildRaceRatings(toRaceResults(syntheticSeason(20), Number.POSITIVE_INFINITY));
  const race = raceGame('espn-f1-3');
  const outcome = projectRace(race, ratings, {
    simulations: 6000,
    field: FIELD,
    fieldSource: 'recent',
  })!;
  const selections = raceSelections(race, outcome, ratings);

  it('projects a race the provider lists no entrants for', () => {
    // Every upcoming session arrives with an empty field, so the model is
    // given one from a session that actually ran.
    assert.ok(outcome);
    assert.equal(outcome.projection.field_size, FIELD.length);
    assert.equal(outcome.projection.field_source, 'recent');
  });

  it('refuses a race with no field at all', () => {
    assert.equal(projectRace(race, ratings, { simulations: 500 }), null);
  });

  it('produces finishing and head-to-head markets', () => {
    const types = new Set(selections.map((selection) => selection.type));
    assert.ok(types.has('finish_position'));
    assert.ok(types.has('head_to_head'));
    assert.equal(types.size, 2, 'nothing else is modelled for a race');
  });

  it('marks every race market as unverified', () => {
    // No bookmaker publishes motorsport markets on this feed.
    for (const selection of selections) {
      assert.equal(selection.market.availability, 'model_only', selection.label);
      assert.equal(selection.market.price, null);
      assert.equal(selection.edge, null);
    }
  });

  it('carries a race projection instead of a scoreline', () => {
    for (const selection of selections) {
      assert.ok(selection.race, selection.label);
      assert.equal(selection.projection, undefined);
    }
  });

  it('shares one correlation group per race', () => {
    // Two markets on one Grand Prix are nearly the same bet, so the optimiser
    // takes at most one.
    assert.equal(new Set(selections.map((s) => s.correlation_group)).size, 1);
  });

  it('explains every selection in plain words', () => {
    for (const selection of selections) {
      assert.ok(selection.explanation.length > 10, selection.label);
      assert.ok(selection.probability > 0 && selection.probability < 1);
      assert.ok(isSettlementRule(selection.settlement), selection.label);
    }
  });

  it('gives a stable id to the same bet', () => {
    const again = raceSelections(race, outcome, ratings);
    assert.deepEqual(selections.map((s) => s.id), again.map((s) => s.id));
  });
});

// ---------------------------------------------------------------------------
// Look-ahead protection
// ---------------------------------------------------------------------------

describe('the starting grid', () => {
  const qualifying = raceGame('q', {
    session: 'Qualifying',
    status: 'finished',
    start_time: '2026-09-05T14:00:00.000Z',
    entrants: FIELD.map((name, index) => ({
      id: name,
      name,
      affiliation: null,
      position: index + 1,
      logo: null,
    })),
  });

  it('is used once qualifying has been run', () => {
    const grid = gridFrom([qualifying], Date.parse('2026-09-06T00:00:00.000Z'));
    assert.equal(grid?.get('Alpha'), 1);
    assert.equal(grid?.size, FIELD.length);
  });

  it('is invisible to a projection made before it', () => {
    // The look-ahead guard: a pre-qualifying projection must not be handed a
    // grid that did not exist when it was made.
    assert.equal(gridFrom([qualifying], Date.parse('2026-09-05T09:00:00.000Z')), null);
  });

  it('is absent while qualifying is still to run', () => {
    const scheduled = { ...qualifying, status: 'scheduled' as const };
    assert.equal(gridFrom([scheduled], Date.parse('2026-09-06T00:00:00.000Z')), null);
  });
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

describe('race settlement', () => {
  const order = FIELD.map((entrant, index) => ({ entrant, position: index + 1 }));
  const final = { home: 0, away: 0, status: 'finished' as const, order };

  it('settles a finishing market on the classified position', () => {
    assert.equal(settle({ kind: 'finish_position', entrant: 'Alpha', within: 1 }, final), 'won');
    assert.equal(settle({ kind: 'finish_position', entrant: 'Charlie', within: 3 }, final), 'won');
    assert.equal(settle({ kind: 'finish_position', entrant: 'Delta', within: 3 }, final), 'lost');
    assert.equal(settle({ kind: 'finish_position', entrant: 'Juliet', within: 10 }, final), 'won');
    assert.equal(settle({ kind: 'finish_position', entrant: 'Kilo', within: 10 }, final), 'lost');
  });

  it('loses a retirement rather than voiding it', () => {
    // A retired driver is still classified, at the back. A top-ten selection
    // on them has been tested and it failed.
    assert.equal(settle({ kind: 'finish_position', entrant: 'Lima', within: 10 }, final), 'lost');
  });

  it('voids a driver who never took part', () => {
    // Not classified at all is a withdrawal — untested, not failed.
    assert.equal(settle({ kind: 'finish_position', entrant: 'Absent', within: 10 }, final), 'void');
  });

  it('settles a head-to-head on the two positions', () => {
    assert.equal(settle({ kind: 'head_to_head', entrant: 'Alpha', over: 'Bravo' }, final), 'won');
    assert.equal(settle({ kind: 'head_to_head', entrant: 'Bravo', over: 'Alpha' }, final), 'lost');
  });

  it('voids a head-to-head where one side is absent', () => {
    assert.equal(settle({ kind: 'head_to_head', entrant: 'Alpha', over: 'Absent' }, final), 'void');
  });

  it('voids everything when the race was not run', () => {
    const cancelled = { ...final, status: 'cancelled' as const };
    assert.equal(
      settle({ kind: 'finish_position', entrant: 'Alpha', within: 1 }, cancelled),
      'void',
    );
  });

  it('voids rather than guessing when no order was published', () => {
    const noOrder = { home: 0, away: 0, status: 'finished' as const };
    assert.equal(settle({ kind: 'finish_position', entrant: 'Alpha', within: 3 }, noOrder), 'void');
  });
});

// ---------------------------------------------------------------------------
// Reading a finished race
// ---------------------------------------------------------------------------

describe('the evidence a race prediction needs', () => {
  const order = FIELD.map((entrant, index) => ({ entrant, position: index + 1 }));
  const rule = { kind: 'finish_position', entrant: 'Alpha', within: 3 } as const;

  it('reads the finishing order, not a scoreline', () => {
    /*
     * A race publishes no score, so the tracker records nulls for both sides.
     * The correction path used to require two numbers here and so skipped
     * every race — a stewards' penalty applied after the flag never reached
     * the prediction it changed.
     */
    const evidence = evidenceFor(rule, {
      status: 'finished',
      home: null,
      away: null,
      order,
    });

    assert.ok(evidence, 'a race with an order has everything it needs');
    assert.deepEqual(evidence.order, order);
    assert.equal(settle(rule, evidence), 'won');
  });

  it('never settles a race against a scoreline that arrived without an order', () => {
    // The dangerous case: a score present, the order missing. Judging it would
    // find no competitor at all and void a correctly settled prediction.
    assert.equal(
      evidenceFor(rule, { status: 'finished', home: 2, away: 1 }),
      null,
      'no order means no evidence, not an empty field',
    );
  });

  it('gives nothing for a race still running', () => {
    assert.equal(evidenceFor(rule, { status: 'live', home: null, away: null, order }), null);
    assert.equal(
      evidenceFor(rule, { status: 'cancelled', home: null, away: null, order }),
      null,
    );
  });

  it('still reads a scoreline for a fixture', () => {
    const winner = { kind: 'winner', side: 'home' } as const;
    const evidence = evidenceFor(winner, { status: 'finished', home: 2, away: 1 });
    assert.ok(evidence);
    assert.equal(settle(winner, evidence), 'won');
    assert.equal(evidenceFor(winner, { status: 'finished', home: null, away: 1 }), null);
  });
});

describe('describing what happened in a race', () => {
  const order = FIELD.map((entrant, index) => ({ entrant, position: index + 1 }));
  const evidence = { home: 0, away: 0, status: 'finished' as const, order };

  it('records the classified position and the field size', () => {
    const outcome = outcomeOf({ kind: 'finish_position', entrant: 'Charlie', within: 3 }, evidence);
    assert.equal(outcome.text, `Classified P3 of ${order.length}`);
    assert.equal(outcome.actual.position, 3);
    assert.equal(outcome.actual.field_size, order.length);
  });

  it('says so when a competitor never took part', () => {
    const outcome = outcomeOf({ kind: 'finish_position', entrant: 'Absent', within: 3 }, evidence);
    assert.equal(outcome.text, 'Did not take part');
    assert.equal(outcome.actual.position, null);
  });

  it('describes a fixture as a scoreline', () => {
    const outcome = outcomeOf(
      { kind: 'winner', side: 'home' },
      { home: 3, away: 1, status: 'finished' },
    );
    assert.equal(outcome.text, '3-1');
    assert.equal(outcome.actual.home_score, 3);
    assert.equal(outcome.actual.margin, 2);
    assert.equal(outcome.actual.total, 4);
  });
});

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

describe('race market wording', () => {
  const names = { homeTeam: '', awayTeam: '', sport: 'f1' as const };

  it('names each finishing market the way the sport does', () => {
    assert.equal(selectionLabel({ kind: 'finish_position', entrant: 'Alpha', within: 1 }, names), 'Alpha to win');
    assert.equal(selectionLabel({ kind: 'finish_position', entrant: 'Alpha', within: 3 }, names), 'Alpha podium');
    assert.equal(selectionLabel({ kind: 'finish_position', entrant: 'Alpha', within: 10 }, names), 'Alpha top 10');
    assert.equal(selectionLabel({ kind: 'head_to_head', entrant: 'Alpha', over: 'Bravo' }, names), 'Alpha to beat Bravo');
  });

  it('says a retirement loses, because that is the surprising part', () => {
    const text = whatNeedsToHappen({ kind: 'finish_position', entrant: 'Alpha', within: 3 }, names);
    assert.match(text, /top three/);
    assert.match(text, /retiring, loses/);
  });

  it('calls a win a win rather than a top one', () => {
    assert.match(
      whatNeedsToHappen({ kind: 'finish_position', entrant: 'Alpha', within: 1 }, names),
      /must win the race/,
    );
  });

  it('explains a head-to-head including the retirement case', () => {
    const text = whatNeedsToHappen({ kind: 'head_to_head', entrant: 'Alpha', over: 'Bravo' }, names);
    assert.match(text, /classified ahead of Bravo/);
    assert.match(text, /retires/);
  });
});
