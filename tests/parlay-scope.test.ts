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
import {
  bestPerGame,
  eligible,
  fixtureOptions,
  optimise,
  selectionsForGames,
} from '../lib/projections/optimiser.ts';
import { RISK_PROFILES } from '../lib/projections/config.ts';
import { selectionScore } from '../lib/projections/project.ts';
import { priceFromDecimal } from '../lib/markets/price.ts';
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
// Building from fixtures the reader chose
// ---------------------------------------------------------------------------

describe('building from chosen fixtures', () => {
  /*
   * The reader picks the matches; the model picks what to back on them; the
   * risk profile still decides what is allowed at all. Each of those three is
   * tested here, because the value of the feature is that they stay separate.
   */
  const card = [
    selection('a1', 'g1', { probability: 0.8 }),
    selection('a2', 'g1', { probability: 0.74, type: 'total' }),
    selection('b1', 'g2', { probability: 0.77 }),
    selection('c1', 'g3', { probability: 0.75 }),
    selection('d1', 'g4', { probability: 0.9 }),
  ];

  it('narrows to the fixtures named and nothing else', () => {
    const pool = selectionsForGames(card, ['g1', 'g3']);
    assert.deepEqual(
      pool.map((entry) => entry.id).sort(),
      ['a1', 'a2', 'c1'],
      'every market on a chosen fixture stays; nothing from an unchosen one does',
    );
  });

  it('returns nothing when nothing was chosen', () => {
    // An empty choice is not "everything" — a caller that means everything
    // simply does not narrow.
    assert.deepEqual(selectionsForGames(card, []), []);
  });

  it('ignores a fixture id that matches nothing', () => {
    const pool = selectionsForGames(card, ['g2', 'not-a-fixture']);
    assert.deepEqual(
      pool.map((entry) => entry.id),
      ['b1'],
    );
  });

  it('builds a line only from the fixtures chosen, however strong the rest', () => {
    /*
     * `d1` is the best selection on the card by some way. It must not appear,
     * because the reader did not pick its fixture — the same guarantee the
     * sport and competition filters give.
     */
    const pool = selectionsForGames(card, ['g1', 'g2', 'g3']);
    const { parlay } = optimise(pool, { risk: 'low', legs: 4 });

    assert.ok(parlay);
    assert.equal(parlay.legs.length, 3, 'three fixtures make at most three legs');
    assert.deepEqual(
      [...new Set(parlay.legs.map((leg) => leg.game_id))].sort(),
      ['g1', 'g2', 'g3'],
    );
    assert.ok(
      !parlay.legs.some((leg) => leg.id === 'd1'),
      'an unchosen fixture must be unreachable',
    );
  });

  it('takes the best market on each chosen fixture, one per fixture', () => {
    const pool = selectionsForGames(card, ['g1', 'g2']);
    const { parlay } = optimise(pool, { risk: 'low', legs: 2 });

    assert.ok(parlay);
    assert.equal(parlay.legs.length, 2);
    // g1 offers two markets; the stronger is taken and the other left.
    assert.equal(parlay.legs.filter((leg) => leg.game_id === 'g1').length, 1);
    assert.equal(parlay.legs.find((leg) => leg.game_id === 'g1')?.id, 'a1');
  });

  it('builds the best subset when fewer legs are asked for than fixtures chosen', () => {
    const pool = selectionsForGames(card, ['g1', 'g2', 'g3']);
    const { parlay } = optimise(pool, { risk: 'low', legs: 2 });

    assert.ok(parlay);
    assert.equal(parlay.legs.length, 2, 'the reader may ask for the best two of three');
  });

  it('drops a chosen fixture that clears no threshold rather than weakening the line', () => {
    /*
     * The behaviour a reader most needs explained: three fixtures picked, two
     * legs returned. The third is left out because the risk profile refused
     * its markets, not because the fixture vanished.
     */
    const withWeak = [
      selection('s1', 'g1', { probability: 0.82 }),
      selection('s2', 'g2', { probability: 0.79 }),
      selection('weak', 'g3', { probability: 0.30 }),
    ];

    const pool = selectionsForGames(withWeak, ['g1', 'g2', 'g3']);
    const result = optimise(pool, { risk: 'low', legs: 3 });

    assert.ok(result.parlay);
    assert.equal(result.parlay.legs.length, 2);
    assert.equal(result.gamesAvailable, 2, 'the count the interface explains the gap with');
    assert.ok(!result.parlay.legs.some((leg) => leg.game_id === 'g3'));
  });
});

describe('offering fixtures to choose from', () => {
  const card = [
    selection('a1', 'g1', { probability: 0.8 }),
    selection('a2', 'g1', { probability: 0.74, type: 'total' }),
    selection('b1', 'g2', { probability: 0.77 }),
    selection('weak', 'g3', { probability: 0.3 }),
  ];

  it('offers one row per fixture, not one per market', () => {
    const options = fixtureOptions(card, RISK_PROFILES.low);
    assert.deepEqual(
      options.map((option) => option.game_id),
      ['g1', 'g2'],
      'picking a fixture is picking a leg, so a fixture appears once',
    );
  });

  it('shows the market the optimiser would actually take', () => {
    const options = fixtureOptions(card, RISK_PROFILES.low);
    const first = options.find((option) => option.game_id === 'g1');
    assert.equal(first?.best.id, 'a1', 'the strongest, by the score the optimiser ranks on');
    assert.equal(first?.candidates, 2, 'and how many others on the fixture qualify');
  });

  it('omits a fixture with nothing that clears the risk profile', () => {
    const options = fixtureOptions(card, RISK_PROFILES.low);
    assert.ok(
      !options.some((option) => option.game_id === 'g3'),
      'offering a fixture that can never contribute would waste a choice',
    );
  });

  it('is a property of the risk level, not of the day', () => {
    // The same card offers different fixtures at different risk levels, which
    // is why the list is rebuilt when the profile changes.
    const low = fixtureOptions(card, RISK_PROFILES.low).length;
    const high = fixtureOptions(card, RISK_PROFILES.high).length;
    assert.notEqual(low, high);
  });

  it('ranks by the optimiser score rather than by raw probability', () => {
    const options = fixtureOptions(card, RISK_PROFILES.low);
    const scores = options.map((option) => option.best.score);
    assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  });
});
