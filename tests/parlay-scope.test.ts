/**
 * Sport and competition selection for parlays.
 *
 * Two things are being defended here.
 *
 * That the selector stays in step with the registry. The list it replaced had
 * gone stale — six sports, no tennis, no Formula 1 — so these tests assert the
 * relationship rather than the contents: every sport the application knows is
 * offered, and every competition offered is one the engine has a model for.
 *
 * That a filter is binding. A reader who asks for the Premier League and gets
 * two eligible matches must be told there were two. The failure that would
 * matter is the quiet one — a third leg arriving from the NBA because it
 * scored better — so it is tested directly.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALL_COMPETITIONS,
  ALL_SPORTS,
  describeScope,
  isProjectable,
  projectableLeagues,
  resolveScope,
  sportOptions,
} from '../lib/leagues/catalogue.ts';
import { LEAGUES, findLeague } from '../lib/leagues/registry.ts';
import { SPORT_IDS } from '../lib/home/types.ts';
import { bestPerGame, eligible, optimise } from '../lib/projections/optimiser.ts';
import { RISK_PROFILES } from '../lib/projections/config.ts';
import { selectionScore } from '../lib/projections/project.ts';
import { priceFromDecimal } from '../lib/markets/price.ts';
import { buildMixed } from '../lib/projections/same-game.ts';
import type { FixtureBundle } from '../lib/projections/same-game.ts';
import { simulate } from '../lib/projections/model.ts';
import type { Distribution } from '../lib/projections/model.ts';
import { jointProbability } from '../lib/projections/correlation.ts';
import type { SettlementRule } from '../lib/markets/types.ts';
import { modelConfigFor } from '../lib/projections/config.ts';
import type { MarketContext } from '../lib/markets/types.ts';
import type { ConcreteSportId } from '../lib/home/types.ts';
import type { Selection } from '../lib/projections/types.ts';

// ---------------------------------------------------------------------------
// The sport selector
// ---------------------------------------------------------------------------

describe('the sport catalogue', () => {
  it('offers every sport the application recognises', () => {
    const offered = sportOptions().map((option) => option.id);
    const expected = SPORT_IDS.filter((id) => id !== 'all');
    assert.deepEqual(offered, [...expected], 'the selector must not drift from SPORT_IDS');
  });

  it('offers the sports the project actually tracks', () => {
    const byId = new Map(sportOptions().map((option) => [option.id, option]));
    for (const id of ['nfl', 'nba', 'mlb', 'nhl', 'football', 'f1'] as const) {
      assert.ok(byId.get(id)?.supported, `${id} must be buildable`);
    }
  });

  it('never offers a competition the engine has no model for', () => {
    for (const option of sportOptions()) {
      for (const competition of option.competitions) {
        const league = findLeague(competition.id);
        assert.ok(league && isProjectable(league), `${competition.id} has no model`);
      }
    }
  });

  it('keeps an unsupported sport visible, with the reason', () => {
    for (const option of sportOptions()) {
      if (option.supported) {
        assert.equal(option.unavailable, null);
      } else {
        assert.ok(option.unavailable, `${option.id} must say why it cannot be built`);
        assert.equal(option.competitions.length, 0);
      }
    }
  });

  it('drops the catch-all where a sport has a single competition', () => {
    for (const option of sportOptions()) {
      if (option.competitions.length === 1) {
        assert.equal(option.all_label, null, `${option.id} needs no "all" option`);
      } else if (option.competitions.length > 1) {
        assert.ok(option.all_label, `${option.id} needs an "all" option`);
      }
    }
  });
});

describe('the competition selector', () => {
  const byId = new Map(sportOptions().map((option) => [option.id, option]));

  it('populates football from the catalogue', () => {
    const ids = byId.get('football')?.competitions.map((entry) => entry.id) ?? [];
    for (const id of ['epl', 'ucl', 'uel', 'laliga', 'bundesliga', 'seriea']) {
      assert.ok(ids.includes(id), `${id} must be offered under football`);
    }
  });

  it('never shows the competitions of one sport under another', () => {
    const basketball = byId.get('nba')?.competitions.map((entry) => entry.id) ?? [];
    assert.ok(!basketball.includes('epl'), 'the Premier League is not basketball');

    const motorsport = byId.get('f1')?.competitions.map((entry) => entry.id) ?? [];
    assert.deepEqual(motorsport, ['f1'], 'Formula 1 has exactly one competition');
    assert.ok(!motorsport.includes('nba'));
  });

  it('groups football by region and leaves the rest ungrouped', () => {
    const football = byId.get('football')?.competitions ?? [];
    assert.ok(
      football.some((entry) => entry.group === 'England'),
      'the catalogue already knows the regions',
    );

    for (const option of sportOptions()) {
      if (option.id === 'football') continue;
      for (const competition of option.competitions) {
        assert.equal(competition.group, null, `${competition.id} needs no invented grouping`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Resolving a request
// ---------------------------------------------------------------------------

describe('resolving a sport and competition', () => {
  it('defaults to everything', () => {
    const scope = resolveScope(null, null);
    assert.ok(scope);
    assert.equal(scope.sport, ALL_SPORTS);
    assert.equal(scope.league, null);
    assert.deepEqual(
      scope.leagues.map((league) => league.id).sort(),
      projectableLeagues()
        .map((league) => league.id)
        .sort(),
    );
  });

  it('narrows to one sport', () => {
    const scope = resolveScope('football', ALL_COMPETITIONS);
    assert.ok(scope);
    assert.ok(scope.leagues.length > 1);
    assert.ok(scope.leagues.every((league) => league.sport === 'football'));
  });

  it('narrows to one competition', () => {
    const scope = resolveScope('football', 'epl');
    assert.ok(scope);
    assert.deepEqual(
      scope.leagues.map((league) => league.id),
      ['epl'],
    );
  });

  it('resolves Formula 1 to its single competition', () => {
    const scope = resolveScope('f1', ALL_COMPETITIONS);
    assert.ok(scope);
    assert.deepEqual(
      scope.leagues.map((league) => league.id),
      ['f1'],
    );
  });

  it('rejects a competition from another sport', () => {
    assert.equal(resolveScope('nba', 'epl'), null, 'a contradiction is not a widening');
    assert.equal(resolveScope('f1', 'nba'), null);
  });

  it('rejects an unknown sport or competition', () => {
    assert.equal(resolveScope('quidditch', null), null);
    assert.equal(resolveScope('football', 'not-a-league'), null);
  });

  it('rejects a tracked competition the engine cannot project', () => {
    const unprojectable = LEAGUES.find((league) => !isProjectable(league));
    // Every tracked competition currently has a model, so this only guards
    // against a future one being offered before its model exists.
    if (!unprojectable) return;
    assert.equal(resolveScope(unprojectable.sport, unprojectable.id), null);
  });

  it('describes itself for a heading', () => {
    const epl = resolveScope('football', 'epl');
    assert.ok(epl);
    assert.deepEqual(describeScope(epl), {
      sport: 'Football',
      competition: 'Premier League',
    });

    const everything = resolveScope(null, null);
    assert.ok(everything);
    assert.equal(describeScope(everything).sport, 'All sports');

    const f1 = resolveScope('f1', null);
    assert.ok(f1);
    assert.equal(describeScope(f1).competition, 'Formula 1');
  });
});

// ---------------------------------------------------------------------------
// The filter is the reader's
// ---------------------------------------------------------------------------

function selection(id: string, gameId: string, overrides: Partial<Selection> = {}): Selection {
  const sport = (overrides.sport ?? 'football') as ConcreteSportId;
  const price = priceFromDecimal(1.5);
  assert.ok(price);

  const market: MarketContext = {
    type: 'moneyline',
    period: 'full_game',
    label: 'Moneyline',
    selection: `${id} label`,
    line: null,
    availability: 'verified',
    price,
    source: 'Test Book',
    fetchedAt: new Date().toISOString(),
    fairProbability: 0.66,
    margin: 0.05,
  };

  return {
    id,
    game_id: gameId,
    sport,
    league: 'Premier League',
    league_id: 'epl',
    start_time: '2026-09-10T14:00:00.000Z',
    fixture: `${gameId} fixture`,
    type: 'winner',
    label: `${id} label`,
    market,
    explanation: 'Home must win the game.',
    probability_label: 'Win probability',
    probability: 0.78,
    confidence: 0.8,
    data_quality: 0.8,
    score: selectionScore(0.78, 0.8, 0.8),
    correlation_group: gameId,
    settlement: { kind: 'winner', side: 'home' },
    reasoning: { support: [], risks: [], context: [] },
    ...overrides,
  } as Selection;
}

describe('a filter is never overruled', () => {
  /*
   * The scenario from the brief: the Premier League, five legs asked for, three
   * eligible matches. Three legs come back. Nothing arrives from anywhere else,
   * however much better it scores.
   */
  const premierLeague = [selection('a', 'g1'), selection('b', 'g2'), selection('c', 'g3')];

  it('returns what the filter supports rather than filling from elsewhere', () => {
    const { parlay, gamesAvailable } = optimise(premierLeague, { risk: 'medium', legs: 5 });

    assert.ok(parlay);
    assert.equal(parlay.legs.length, 3, 'three eligible matches make three legs');
    assert.equal(gamesAvailable, 3);
    assert.ok(
      parlay.legs.every((leg) => leg.league_id === 'epl'),
      'no leg may come from outside the chosen competition',
    );
  });

  it('cannot reach a selection that was never in the pool', () => {
    /*
     * The optimiser only ever sees the candidates it is handed, which is what
     * makes the filter structural rather than a rule it has to remember: the
     * narrowing happens before anything is projected.
     */
    const stronger = selection('nba-leg', 'g9', {
      sport: 'nba',
      league: 'NBA',
      league_id: 'nba',
      probability: 0.94,
      score: selectionScore(0.94, 0.95, 0.95),
    });

    const { parlay } = optimise(premierLeague, { risk: 'medium', legs: 5 });
    assert.ok(parlay);
    assert.ok(
      !parlay.legs.some((leg) => leg.id === stronger.id),
      'a candidate outside the pool must be unreachable',
    );
  });

  it('caps the legs at one per fixture, which is what the selector greys out', () => {
    const qualified = eligible(premierLeague, RISK_PROFILES.medium);
    // The ceiling the API reports: fixtures, not candidates. Two markets on one
    // match is one leg, so offering four here would be offering nothing.
    assert.equal(bestPerGame(qualified).length, 3);
  });

  it('keeps every leg inside a single sport when one is chosen', () => {
    const { parlay } = optimise(premierLeague, { risk: 'medium', legs: 3 });
    assert.ok(parlay);
    assert.equal(new Set(parlay.legs.map((leg) => leg.sport)).size, 1);
  });
});

// ---------------------------------------------------------------------------
// Several bets on one match
// ---------------------------------------------------------------------------

describe('more than one bet per match', () => {
  /*
   * Real simulations rather than a hand-built distribution: the point of this
   * builder is that legs from one fixture are measured against the games they
   * were read from, and a fabricated distribution would not exercise that.
   */
  /*
   * Each leg's probability is read from the distribution it will be judged
   * against, so the fixture is self-consistent. A leg claiming 78% that the
   * simulations put at 50% is refused by the conditional test - correctly, and
   * it would make this a test of nothing.
   */
  function leg(
    gameId: string,
    name: string,
    rule: SettlementRule,
    market: { type: string; line: number | null },
    distribution: Distribution,
  ): Selection {
    const probability = jointProbability(distribution, [rule]);
    const base = selection(`${gameId}-${name}`, gameId, { probability });

    return {
      ...base,
      settlement: rule,
      score: selectionScore(probability, 0.8, 0.8),
      // Distinct market identities, or `conflicts` would treat these as the
      // same bet and refuse the second and third.
      market: { ...base.market, type: market.type, line: market.line },
    } as Selection;
  }

  function bundle(gameId: string, seed: number): FixtureBundle {
    const distribution = simulate(
      { home: 1.7, away: 1.1, eloEdge: 0, homeRest: null, awayRest: null, shortRested: null },
      modelConfigFor('football')!,
      { simulations: 4000, seed },
    );

    return {
      gameId,
      distribution,
      selections: [
        leg(gameId, 'a', { kind: 'total', direction: 'under', line: 5.5 }, { type: 'total', line: 5.5 }, distribution),
        leg(gameId, 'b', { kind: 'team_total', side: 'home', direction: 'over', line: 0.5 }, { type: 'team_total', line: 0.5 }, distribution),
        leg(gameId, 'c', { kind: 'double_chance', sides: ['home', 'draw'] }, { type: 'double_chance', line: null }, distribution),
      ],
    };
  }

  const bundles = [bundle('g1', 1), bundle('g2', 2), bundle('g3', 3)];

  const spread = (parlay: { legs: { game_id: string }[] }) => {
    const counts = new Map<string, number>();
    for (const leg of parlay.legs) counts.set(leg.game_id, (counts.get(leg.game_id) ?? 0) + 1);
    return counts;
  };

  it('reproduces one leg per match when asked for one', () => {
    const { parlay } = buildMixed(bundles, { risk: 'low', perGame: 1, legs: 3 });
    assert.ok(parlay);
    assert.equal(parlay.legs.length, 3);
    assert.equal(spread(parlay).size, 3);
    assert.equal(parlay.kind, 'multi_game', 'nothing doubled up, so nothing changed');
  });

  it('takes several bets from one match when asked', () => {
    const { parlay } = buildMixed(bundles, { risk: 'low', perGame: 2, legs: 6 });
    assert.ok(parlay);

    const counts = [...spread(parlay).values()];
    assert.ok(counts.some((count) => count > 1), 'a match contributed more than one leg');
    assert.ok(counts.every((count) => count <= 2), 'and none exceeded the limit asked for');
  });

  it('spreads across matches before doubling up on one', () => {
    /*
     * Four legs from three matches is 2-1-1, never 3-1 or 4. Loading a line
     * onto whichever fixture ranks first would concentrate it exactly where
     * correlation is strongest.
     */
    const { parlay } = buildMixed(bundles, { risk: 'low', perGame: 3, legs: 4 });
    assert.ok(parlay);
    assert.deepEqual([...spread(parlay).values()].sort((a, b) => a - b), [1, 1, 2]);
  });

  it('counts within a match and multiplies between them', () => {
    /*
     * The arithmetic that makes this honest. Legs from one fixture are related,
     * so multiplying throughout would misstate the line — and counting
     * throughout is impossible, because two fixtures share no simulations.
     */
    const { parlay } = buildMixed(bundles, { risk: 'low', perGame: 2, legs: 4 });
    assert.ok(parlay);
    assert.equal(parlay.kind, 'mixed');
    assert.notEqual(
      parlay.combined_probability,
      parlay.independent_probability,
      'a doubled-up match must not price as if its legs were independent',
    );
  });

  it('never claims correlation was measured when nothing doubled up', () => {
    const { parlay } = buildMixed(bundles, { risk: 'low', perGame: 3, legs: 3 });
    assert.ok(parlay);
    assert.equal(parlay.kind, 'multi_game');
    assert.equal(parlay.correlation.ratio, 1);
  });

  it('is bounded by the matches available, not by what was asked for', () => {
    const { parlay } = buildMixed([bundles[0]], { risk: 'low', perGame: 3, legs: 6 });
    assert.ok(parlay);
    assert.ok(parlay.legs.length <= 3, 'one match cannot supply six bets here');
    assert.ok(parlay.legs.every((leg) => leg.game_id === 'g1'));
  });

  it('returns nothing rather than a one-leg line', () => {
    const thin = [{ ...bundles[0], selections: [selection('only', 'g1', { probability: 0.78 })] }];
    assert.equal(buildMixed(thin, { risk: 'low', perGame: 3, legs: 4 }).parlay, null);
  });
});
