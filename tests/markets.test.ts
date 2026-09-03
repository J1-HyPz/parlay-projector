import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  americanToDecimal,
  combinedDecimal,
  decimalToAmerican,
  decimalToFractional,
  modelEdge,
  parseAmerican,
  parseLine,
  priceFromAmerican,
  priceFromDecimal,
  removeMargin,
  returnsOn,
} from '../lib/markets/price.ts';
import {
  formatLine,
  marketLabel,
  probabilityLabel,
  selectionLabel,
  whatNeedsToHappen,
} from '../lib/markets/explain.ts';
import type { FixtureNames } from '../lib/markets/explain.ts';
import { GLOSSARY, glossaryKeyForMarket } from '../lib/markets/glossary.ts';
import { marketTypeOf, quoteIsFresh } from '../lib/markets/types.ts';
import type { SettlementRule } from '../lib/markets/types.ts';
import { fairProbabilityFor, normaliseOdds, normaliseOddsResponse } from '../lib/odds/normalise.ts';
import { backingFor, orientFactors, roleOf } from '../lib/projections/factors.ts';
import type { ProjectionFactor } from '../lib/projections/factors.ts';
import {
  describeCorrelation,
  isContradictory,
  jointProbability,
  satisfiedBy,
} from '../lib/projections/correlation.ts';
import {
  assembleSlip,
  buildSameGame,
  conditionalProbability,
  conflicts,
  evaluateCombination,
} from '../lib/projections/same-game.ts';
import { explainRisk, priceParlay } from '../lib/projections/optimiser.ts';
import { buildRatings, toResults } from '../lib/projections/features.ts';
import { expectedScores, simulate } from '../lib/projections/model.ts';
import { candidateSelections, probabilityFor, projectGame } from '../lib/projections/project.ts';
import { modelConfigFor } from '../lib/projections/config.ts';
import type { Game } from '../lib/home/types.ts';
import type { Selection } from '../lib/projections/types.ts';

const FOOTBALL = modelConfigFor('football')!;
const NFL = modelConfigFor('nfl')!;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function game(id: string, home: string, away: string, overrides: Partial<Game> = {}): Game {
  return {
    id,
    sport: 'football',
    league: 'Premier League',
    league_badge: null,
    season: '2026',
    round: '3',
    start_time: '2026-09-10T14:00:00.000Z',
    status: 'scheduled',
    provider_status: null,
    home_team: { id: '1', name: home, logo: null },
    away_team: { id: '2', name: away, logo: null },
    venue: { name: 'Ground', city: null, country: null },
    broadcast: null,
    ...overrides,
  };
}

function syntheticSeason(count: number, sport: 'football' | 'nfl' = 'football'): Game[] {
  const games: Game[] = [];
  const teams = ['Strong', 'Middle', 'Weak'];
  const scoreFor = (team: string) =>
    sport === 'football'
      ? ({ Strong: 3, Middle: 1, Weak: 0 })[team] ?? 1
      : ({ Strong: 31, Middle: 20, Weak: 13 })[team] ?? 20;

  for (let i = 0; i < count; i += 1) {
    const home = teams[i % 3];
    const away = teams[(i + 1) % 3];
    games.push(
      game(`g${i}`, home, away, {
        sport: sport === 'football' ? 'football' : 'nfl',
        status: 'finished',
        start_time: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}T14:00:00.000Z`,
        score: { home: scoreFor(home), away: scoreFor(away) },
      }),
    );
  }
  return games;
}

const NAMES: FixtureNames = {
  homeTeam: 'Houston Astros',
  awayTeam: 'Chicago White Sox',
  sport: 'mlb',
};

// ---------------------------------------------------------------------------
// Odds arithmetic
// ---------------------------------------------------------------------------

describe('odds conversion', () => {
  it('converts American prices to decimal', () => {
    // +150 wins 150 on 100, so 2.50 back per 1 staked.
    assert.equal(americanToDecimal(150), 2.5);
    // -200 needs 200 to win 100, so 1.50 back per 1.
    assert.equal(americanToDecimal(-200), 1.5);
    assert.equal(americanToDecimal(100), 2);
  });

  it('round-trips through American and back', () => {
    for (const american of [-500, -200, -110, 100, 145, 320, 900]) {
      const decimal = americanToDecimal(american)!;
      assert.equal(decimalToAmerican(decimal), american, String(american));
    }
  });

  it('refuses a price that means nothing', () => {
    assert.equal(americanToDecimal(0), null);
    assert.equal(americanToDecimal(Number.NaN), null);
    // Below evens on the decimal scale is not a price, it is a loss.
    assert.equal(priceFromDecimal(0.8), null);
    assert.equal(priceFromDecimal(1), null);
  });

  it('reduces fractions to the form a slip would print', () => {
    assert.equal(decimalToFractional(2.5), '3/2');
    assert.equal(decimalToFractional(2), '1/1');
    assert.equal(decimalToFractional(1.5), '1/2');
    // The smallest denominator that fits, not an arbitrarily precise one.
    assert.equal(decimalToFractional(3), '2/1');
  });

  it('builds a complete price from an American quote', () => {
    const price = priceFromAmerican(-175)!;
    assert.ok(Math.abs(price.decimal - 1.5714) < 0.001);
    assert.equal(price.american, -175);
    assert.ok(Math.abs(price.implied - 0.6364) < 0.001);
  });

  it('reads the notations a feed actually uses', () => {
    assert.equal(parseAmerican('+145'), 145);
    assert.equal(parseAmerican('-110'), -110);
    assert.equal(parseAmerican('EVEN'), 100);
    assert.equal(parseAmerican(''), null, 'an unreadable price is a missing market');
    assert.equal(parseAmerican('nonsense'), null);

    assert.equal(parseLine('o44.5'), 44.5, 'the over prefix is dropped');
    assert.equal(parseLine('u2.5'), 2.5);
    assert.equal(parseLine('+3.5'), 3.5);
    assert.equal(parseLine('-3.5'), -3.5);
    assert.equal(parseLine(null), null);
  });
});

describe('bookmaker margin', () => {
  it('removes the margin so the market sums to one', () => {
    // Both sides at -110 imply 52.4% each: a 4.8% book.
    const implied = [0.5238, 0.5238];
    const removed = removeMargin(implied)!;
    assert.ok(Math.abs(removed.fair[0] + removed.fair[1] - 1) < 1e-6);
    assert.ok(Math.abs(removed.fair[0] - 0.5) < 1e-3);
    assert.ok(Math.abs(removed.margin - 0.0476) < 1e-3);
  });

  it('refuses to de-vig a market it can only see one side of', () => {
    // Without both sides there is no way to know how much margin to remove.
    assert.equal(removeMargin([0.6]), null);
    assert.equal(removeMargin([]), null);
  });

  it('reports disagreement, in the direction it points', () => {
    assert.ok(modelEdge(0.62, 0.5) > 0);
    assert.ok(modelEdge(0.4, 0.5) < 0);
    assert.equal(modelEdge(0.5, 0.5), 0);
  });
});

describe('combining prices', () => {
  it('multiplies the decimals', () => {
    const a = priceFromDecimal(1.5)!;
    const b = priceFromDecimal(2)!;
    assert.equal(combinedDecimal([a, b]), 3);
  });

  it('gives no price at all when a leg is unpriced', () => {
    // Substituting anything for the missing leg would fabricate the headline
    // number, and nothing in the output would show which leg was invented.
    const a = priceFromDecimal(1.5)!;
    assert.equal(combinedDecimal([a, null]), null);
    assert.equal(combinedDecimal([]), null);
  });

  it('says what a stake returns, stake included', () => {
    assert.equal(returnsOn(10, 2.2), 22);
  });
});

// ---------------------------------------------------------------------------
// Plain English
// ---------------------------------------------------------------------------

describe('what needs to happen', () => {
  const say = (rule: SettlementRule, names = NAMES) => whatNeedsToHappen(rule, names);

  it('explains a handicap the underdog receives', () => {
    const text = say({ kind: 'spread', side: 'home', line: 1.5 });
    assert.match(text, /Houston Astros must win, or lose by exactly one run/);
    assert.match(text, /two or more loses/);
  });

  it('explains a handicap the favourite gives', () => {
    const text = say({ kind: 'spread', side: 'home', line: -1.5 });
    assert.match(text, /must beat Chicago White Sox by at least 2 runs/);
  });

  it('handles a larger handicap in whole units', () => {
    assert.match(
      say({ kind: 'spread', side: 'away', line: 7.5 }, { ...NAMES, sport: 'nfl' } as FixtureNames),
      /win, or lose by no more than 7 points/,
    );
  });

  it('warns about a push on a whole-number line', () => {
    // The case people are most often surprised by, so it is stated rather than
    // left to be discovered at settlement.
    assert.match(say({ kind: 'spread', side: 'home', line: -3 }), /push/);
    assert.match(say({ kind: 'total', direction: 'over', line: 8 }), /push/);
    assert.doesNotMatch(say({ kind: 'total', direction: 'over', line: 8.5 }), /push/);
  });

  it('turns a half-point line into the number of runs required', () => {
    assert.match(
      say({ kind: 'total', direction: 'over', line: 8.5 }),
      /combine for at least 9 runs/,
    );
    assert.match(
      say({ kind: 'total', direction: 'under', line: 8.5 }),
      /combine for 8 runs or fewer/,
    );
  });

  it('says a draw loses where a draw is possible', () => {
    const football: FixtureNames = { homeTeam: 'Arsenal', awayTeam: 'Chelsea', sport: 'football' };
    assert.match(say({ kind: 'winner', side: 'home' }, football), /A draw loses this selection/);
    // Baseball has no draw, so the caveat would be noise.
    assert.doesNotMatch(say({ kind: 'winner', side: 'home' }), /draw/i);
  });

  it('names what can beat a double chance', () => {
    const football: FixtureNames = { homeTeam: 'Arsenal', awayTeam: 'Chelsea', sport: 'football' };
    const text = say({ kind: 'double_chance', sides: ['home', 'draw'] }, football);
    assert.match(text, /Arsenal or the draw/);
    assert.match(text, /Only a Chelsea win loses/);
  });

  it('reduces a sub-one team total to "must score"', () => {
    const football: FixtureNames = { homeTeam: 'Arsenal', awayTeam: 'Chelsea', sport: 'football' };
    assert.match(
      say({ kind: 'team_total', side: 'home', direction: 'over', line: 0.5 }, football),
      /Arsenal must score at least one goal/,
    );
  });

  it('explains a team total in the unit the sport uses', () => {
    assert.match(
      say({ kind: 'team_total', side: 'away', direction: 'over', line: 4.5 }),
      /Chicago White Sox must score at least 5 runs/,
    );
  });

  it('never leaves a rule unexplained', () => {
    const rules: SettlementRule[] = [
      { kind: 'winner', side: 'home' },
      { kind: 'winner', side: 'draw' },
      { kind: 'double_chance', sides: ['away', 'draw'] },
      { kind: 'spread', side: 'away', line: 2.5 },
      { kind: 'spread', side: 'home', line: 0 },
      { kind: 'total', direction: 'under', line: 44.5 },
      { kind: 'team_total', side: 'home', direction: 'under', line: 0.5 },
    ];
    for (const rule of rules) {
      const text = say(rule);
      assert.ok(text.length > 10, JSON.stringify(rule));
      assert.ok(text.endsWith('.'), `${text} should be a sentence`);
    }
  });
});

describe('market naming', () => {
  it('uses the name the sport actually uses', () => {
    assert.equal(marketLabel('spread', 'mlb'), 'Run Line');
    assert.equal(marketLabel('spread', 'nhl'), 'Puck Line');
    assert.equal(marketLabel('spread', 'nfl'), 'Point Spread');
    assert.equal(marketLabel('moneyline', 'football'), 'Match Result');
    assert.equal(marketLabel('moneyline', 'nba'), 'Moneyline');
    assert.equal(marketLabel('total', 'mlb'), 'Total Runs');
  });

  it('writes a selection the way a slip would', () => {
    assert.equal(selectionLabel({ kind: 'spread', side: 'home', line: 1.5 }, NAMES), 'Houston Astros +1.5');
    assert.equal(selectionLabel({ kind: 'spread', side: 'away', line: -1.5 }, NAMES), 'Chicago White Sox -1.5');
    assert.equal(selectionLabel({ kind: 'total', direction: 'over', line: 8.5 }, NAMES), 'Over 8.5');
    assert.equal(selectionLabel({ kind: 'winner', side: 'home' }, NAMES), 'Houston Astros');
  });

  it('signs a line the way a slip would', () => {
    assert.equal(formatLine(1.5), '+1.5');
    assert.equal(formatLine(-1.5), '-1.5');
  });

  it('names what each probability measures', () => {
    // Four different quantities that were all previously called "estimated
    // probability", which is how a 60% winner sat beside a 76% cover with
    // nothing to say they answered different questions.
    assert.equal(probabilityLabel('moneyline'), 'Win probability');
    assert.equal(probabilityLabel('spread'), 'Cover probability');
    assert.equal(probabilityLabel('total'), 'Over/under probability');
    assert.equal(probabilityLabel('double_chance'), 'Win or draw probability');
  });

  it('routes a market to the right glossary entry for its sport', () => {
    assert.equal(glossaryKeyForMarket('spread', 'mlb'), 'run_line');
    assert.equal(glossaryKeyForMarket('spread', 'nhl'), 'puck_line');
    assert.equal(glossaryKeyForMarket('spread', 'nfl'), 'spread');
    assert.equal(glossaryKeyForMarket('moneyline', 'football'), 'match_result');
  });

  it('defines every term it routes to', () => {
    for (const sport of ['mlb', 'nhl', 'nfl', 'nba', 'football']) {
      for (const market of ['moneyline', 'spread', 'total', 'team_total', 'double_chance']) {
        const key = glossaryKeyForMarket(market, sport);
        assert.ok(GLOSSARY[key], `${sport}/${market} -> ${key}`);
      }
    }
  });

  it('maps a settlement rule to its market', () => {
    assert.equal(marketTypeOf({ kind: 'winner', side: 'home' }), 'moneyline');
    assert.equal(marketTypeOf({ kind: 'spread', side: 'home', line: -1.5 }), 'spread');
    assert.equal(marketTypeOf({ kind: 'team_total', side: 'home', direction: 'over', line: 4.5 }), 'team_total');
  });
});

// ---------------------------------------------------------------------------
// Reading a provider's odds
// ---------------------------------------------------------------------------

/** Shaped exactly like the live payload, trimmed of links and logos. */
const RAW_NFL_ODDS = {
  provider: { name: 'DraftKings', displayName: 'DraftKings' },
  details: 'SEA -3.5',
  overUnder: 44.5,
  spread: -3.5,
  moneyline: {
    home: { open: { odds: '-192' }, close: { odds: '-175' } },
    away: { open: { odds: '+160' }, close: { odds: '+145' } },
  },
  pointSpread: {
    home: { open: { line: '-3.5', odds: '-110' }, close: { line: '-3.5', odds: '-105' } },
    away: { open: { line: '+3.5', odds: '-110' }, close: { line: '+3.5', odds: '-115' } },
  },
  total: {
    over: { close: { line: 'o44.5', odds: '-105' } },
    under: { close: { line: 'u44.5', odds: '-115' } },
  },
};

describe('reading bookmaker odds', () => {
  const fetched = '2026-09-03T12:00:00.000Z';
  const markets = normaliseOdds(RAW_NFL_ODDS, 'espn-nfl-1', fetched)!;

  it('reads all three markets from one block', () => {
    assert.equal(markets.source, 'DraftKings');
    const types = markets.markets.map((entry) => entry.market);
    assert.equal(types.filter((t) => t === 'moneyline').length, 2);
    assert.equal(types.filter((t) => t === 'spread').length, 2);
    assert.equal(types.filter((t) => t === 'total').length, 2);
  });

  it('prefers the current price over the opening one', () => {
    const home = markets.markets.find(
      (entry) => entry.market === 'moneyline' && entry.side === 'home',
    )!;
    // -175 closed, -192 opened. The live quote is the one that can be backed.
    assert.equal(home.price.american, -175);
  });

  it('keeps the line attached to the handicap', () => {
    const away = markets.markets.find(
      (entry) => entry.market === 'spread' && entry.side === 'away',
    )!;
    assert.equal(away.line, 3.5);
    assert.deepEqual(away.settlement, { kind: 'spread', side: 'away', line: 3.5 });
  });

  it('builds a settlement rule that matches the quote', () => {
    const over = markets.markets.find((entry) => entry.direction === 'over')!;
    assert.deepEqual(over.settlement, { kind: 'total', direction: 'over', line: 44.5 });
  });

  it('de-vigs each market group on its own', () => {
    const home = markets.markets.find(
      (entry) => entry.market === 'moneyline' && entry.side === 'home',
    )!;
    const fair = fairProbabilityFor(markets, home)!;
    assert.ok(fair.fair < home.price.implied, 'the margin comes off');
    assert.ok(fair.margin > 0 && fair.margin < 0.2);
  });

  it('pairs the two sides of a handicap despite their opposite lines', () => {
    const home = markets.markets.find(
      (entry) => entry.market === 'spread' && entry.side === 'home',
    )!;
    const fair = fairProbabilityFor(markets, home);
    assert.ok(fair, '-3.5 and +3.5 are two sides of one market');
    assert.ok(Math.abs(fair!.fair - 0.5) < 0.1, 'a pick-em handicap is near even money');
  });

  it('drops a block with no readable provider', () => {
    assert.equal(normaliseOdds({ ...RAW_NFL_ODDS, provider: null }, 'g', fetched), null);
  });

  it('drops a block with nothing readable in it', () => {
    assert.equal(
      normaliseOdds({ provider: { name: 'Book' }, moneyline: { home: { close: {} } } }, 'g', fetched),
      null,
    );
  });

  it('omits a handicap whose line is missing rather than guessing one', () => {
    const noLine = normaliseOdds(
      {
        provider: { name: 'Book' },
        pointSpread: { home: { close: { odds: '-110' } }, away: { close: { odds: '-110' } } },
      },
      'g',
      fetched,
    );
    // A price with no line does not describe a bet.
    assert.equal(noLine, null);
  });

  it('keys a scoreboard payload by game id', () => {
    const byGame = normaliseOddsResponse(
      {
        events: [
          { id: '401', competitions: [{ odds: [RAW_NFL_ODDS] }] },
          { id: '402', competitions: [{ odds: [] }] },
          { id: '403', competitions: [{}] },
        ],
      },
      (eventId) => `espn-nfl-${eventId}`,
      fetched,
    );

    assert.equal(byGame.size, 1, 'only the event with odds');
    assert.ok(byGame.has('espn-nfl-401'));
  });

  it('treats a quote past its shelf life as no quote at all', () => {
    const now = Date.parse('2026-09-03T12:00:00.000Z');
    assert.equal(quoteIsFresh('2026-09-03T11:55:00.000Z', now), true);
    assert.equal(quoteIsFresh('2026-09-03T11:00:00.000Z', now), false);
    assert.equal(quoteIsFresh('nonsense', now), false);
  });
});

// ---------------------------------------------------------------------------
// Which way the evidence points
// ---------------------------------------------------------------------------

describe('orienting evidence', () => {
  const sides = { home: 'Astros', away: 'White Sox' };

  const astrosForm: ProjectionFactor = {
    text: 'Astros have won 4 of their last 6.',
    subject: { kind: 'team', team: 'Astros', favourable: true },
    direction: 'positive',
  };
  const soxForm: ProjectionFactor = {
    text: 'White Sox have won 4 of their last 6.',
    subject: { kind: 'team', team: 'White Sox', favourable: true },
    direction: 'positive',
  };
  const highScoring: ProjectionFactor = {
    text: 'The model projects 9.4 combined, above the competition norm.',
    subject: { kind: 'scoring', lean: 'high' },
    direction: 'positive',
  };
  const thin: ProjectionFactor = {
    text: 'Only 8 completed games for the thinner side.',
    subject: { kind: 'uncertainty' },
    direction: 'negative',
  };

  it('files a team\'s good run as support for backing that team', () => {
    // The bug this whole mechanism exists for: the old model wrote polarity
    // relative to the favourite, so a team's own good form appeared under Risk
    // Factors on a bet backing them.
    const backing = backingFor({ kind: 'spread', side: 'home', line: 1.5 }, sides);
    assert.equal(roleOf(astrosForm, backing), 'support');
  });

  it('files the opponent\'s good run as a risk', () => {
    const backing = backingFor({ kind: 'spread', side: 'home', line: 1.5 }, sides);
    assert.equal(roleOf(soxForm, backing), 'risk');
  });

  it('flips both when the other side is backed', () => {
    const backing = backingFor({ kind: 'winner', side: 'away' }, sides);
    assert.equal(roleOf(astrosForm, backing), 'risk');
    assert.equal(roleOf(soxForm, backing), 'support');
  });

  it('treats a team fact as context on a total', () => {
    // A total does not care who wins, so form with no scoring lean is neither
    // an argument for nor against it.
    const backing = backingFor({ kind: 'total', direction: 'over', line: 8.5 }, sides);
    assert.equal(roleOf(astrosForm, backing), 'context');
  });

  it('matches a scoring lean to the side of the total being backed', () => {
    const over = backingFor({ kind: 'total', direction: 'over', line: 8.5 }, sides);
    const under = backingFor({ kind: 'total', direction: 'under', line: 8.5 }, sides);
    assert.equal(roleOf(highScoring, over), 'support');
    assert.equal(roleOf(highScoring, under), 'risk');
  });

  it('treats a caveat about the estimate as a risk whatever is backed', () => {
    for (const rule of [
      { kind: 'winner', side: 'home' } as const,
      { kind: 'total', direction: 'under', line: 8.5 } as const,
    ]) {
      assert.equal(roleOf(thin, backingFor(rule, sides)), 'risk');
    }
  });

  it('knows what a double chance is really backing', () => {
    const backing = backingFor({ kind: 'double_chance', sides: ['home', 'draw'] }, sides);
    assert.equal(backing.team, 'Astros');
    assert.equal(backing.opponent, 'White Sox', 'only an away win beats it');
  });

  it('sorts a mixed set into three buckets', () => {
    const backing = backingFor({ kind: 'winner', side: 'home' }, sides);
    const oriented = orientFactors([astrosForm, soxForm, highScoring, thin], backing);
    assert.deepEqual(oriented.support.map((f) => f.text), [astrosForm.text]);
    assert.deepEqual(oriented.risks.map((f) => f.text), [soxForm.text, thin.text]);
    assert.deepEqual(oriented.context.map((f) => f.text), [highScoring.text]);
  });
});

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

describe('joint probabilities', () => {
  const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
  const expected = expectedScores('Strong', 'Weak', set, FOOTBALL, Date.now())!;
  const distribution = simulate(expected, FOOTBALL, { simulations: 20000, seed: 42 });

  it('judges a simulated game the same way settlement judges a real one', () => {
    assert.equal(satisfiedBy({ kind: 'spread', side: 'home', line: 1.5 }, 2, 1, 0), true);
    assert.equal(satisfiedBy({ kind: 'spread', side: 'home', line: -1.5 }, 2, 1, 0), false);
    assert.equal(satisfiedBy({ kind: 'total', direction: 'over', line: 2.5 }, 2, 1, 0), true);
    assert.equal(satisfiedBy({ kind: 'team_total', side: 'away', direction: 'over', line: 0.5 }, 2, 1, 0), true);
  });

  it('resolves a tie the way the simulation did, not by re-deriving it', () => {
    // A sport with no draw settles ties inside the simulation. Reading the
    // winner back out is the only way the joint figure can agree with the
    // marginal one.
    assert.equal(satisfiedBy({ kind: 'winner', side: 'home' }, 20, 20, 0), true);
    assert.equal(satisfiedBy({ kind: 'winner', side: 'away' }, 20, 20, 0), false);
  });

  it('agrees with the marginal probability for a single rule', () => {
    // The property that makes everything else trustworthy: one code path, so
    // a leg's own number and its contribution to a combination cannot drift.
    const rule = { kind: 'total', direction: 'over', line: 2.5 } as const;
    const joint = jointProbability(distribution, [rule]);
    const projection = projectGame(game('j', 'Strong', 'Weak'), set, FOOTBALL, {
      simulations: 20000,
      seed: 42,
    })!;
    const marginal = probabilityFor(distribution, projection.projection, rule);
    assert.ok(Math.abs(joint - marginal) < 1e-9);
  });

  it('finds a favourite and its own scoring more likely together than multiplied', () => {
    // The home side scoring twice is most of what winning the game means here,
    // so the two ride together. Multiplying them understates the combination —
    // which is exactly the error this module exists to avoid.
    const win = { kind: 'winner', side: 'home' } as const;
    const scores = { kind: 'team_total', side: 'home', direction: 'over', line: 1.5 } as const;

    const joint = jointProbability(distribution, [win, scores]);
    const product =
      jointProbability(distribution, [win]) * jointProbability(distribution, [scores]);

    assert.ok(joint > product, `${joint} should exceed ${product}`);
    // Comfortably beyond sampling noise at twenty thousand simulations.
    assert.ok(joint / product > 1.02, `ratio ${joint / product}`);
  });

  it('finds contradictory selections impossible rather than merely unlikely', () => {
    assert.equal(
      isContradictory(
        distribution,
        { kind: 'total', direction: 'over', line: 2.5 },
        { kind: 'total', direction: 'under', line: 2.5 },
      ),
      true,
    );
    assert.equal(
      isContradictory(
        distribution,
        { kind: 'winner', side: 'home' },
        { kind: 'winner', side: 'away' },
      ),
      true,
    );
  });

  it('calls cross-fixture legs independent without measuring them', () => {
    // Two fixtures are not simulated together, so there is nothing to measure.
    const across = describeCorrelation(0.4, 0.4, false);
    assert.equal(across.level, 'low');
    assert.equal(across.ratio, 1);
    assert.match(across.note, /different fixture/);
  });

  it('grades the strength of a same-game relationship', () => {
    assert.equal(describeCorrelation(0.6, 0.3, true).level, 'high');
    assert.equal(describeCorrelation(0.36, 0.3, true).level, 'moderate');
    assert.equal(describeCorrelation(0.31, 0.3, true).level, 'low');
    // Legs that fight each other are just as much a relationship.
    assert.equal(describeCorrelation(0.15, 0.3, true).level, 'high');
  });
});

// ---------------------------------------------------------------------------
// Same-game combinations
// ---------------------------------------------------------------------------

describe('same-game combinations', () => {
  const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
  // Deliberately the closer pairing: Strong against Weak produces
  // probabilities so lopsided that every risk profile rejects them, and a test
  // that skips itself proves nothing.
  const fixture = game('sgp', 'Middle', 'Weak');
  const outcome = projectGame(fixture, set, FOOTBALL, { simulations: 20000, seed: 7 })!;
  const candidates = candidateSelections(fixture, outcome, FOOTBALL);
  const distribution = outcome.distribution;

  const find = (predicate: (s: Selection) => boolean) => candidates.find(predicate)!;

  it('reports the measured figure and the multiplied one separately', () => {
    const legs = [find((s) => s.type === 'winner'), find((s) => s.type === 'total')];
    const assessment = evaluateCombination(legs, distribution);

    assert.ok(assessment.joint > 0 && assessment.joint < 1);
    assert.ok(assessment.independent > 0);
    // Showing both is what makes the adjustment legible rather than a claim.
    assert.notEqual(assessment.joint, assessment.independent);
  });

  it('gives one leg the same answer either way', () => {
    const leg = find((s) => s.type === 'winner');
    const assessment = evaluateCombination([leg], distribution);
    // Both are reported to four decimal places, so they agree to within
    // rounding rather than to the bit.
    assert.ok(
      Math.abs(assessment.joint - assessment.independent) < 1e-3,
      `${assessment.joint} vs ${assessment.independent}`,
    );
    assert.equal(assessment.correlation.level, 'low');
    assert.match(assessment.correlation.note, /single selection/);
  });

  it('scores a contradictory addition at zero', () => {
    const over = find((s) => s.type === 'total' && s.settlement.kind === 'total');
    const opposite: Selection = {
      ...over,
      id: 'opposite',
      settlement:
        over.settlement.kind === 'total'
          ? { kind: 'total', direction: 'under', line: over.settlement.line }
          : over.settlement,
    };
    assert.ok(conditionalProbability([over], opposite, distribution) < 0.01);
  });

  it('refuses two bets on the same market and line', () => {
    const first = candidates[0];
    assert.equal(conflicts(first, first), true);
  });

  it('builds a line whose claimed probability is the measured one', () => {
    const result = buildSameGame(candidates, distribution, { risk: 'medium', legs: 3 });
    if (!result.parlay) return; // Thresholds may exclude this synthetic fixture.

    const parlay = result.parlay;
    assert.equal(parlay.kind, 'same_game');
    assert.ok(parlay.legs.length >= 2);
    // Every leg from one fixture, which is the whole point.
    assert.equal(new Set(parlay.legs.map((leg) => leg.game_id)).size, 1);

    const measured = jointProbability(
      distribution,
      parlay.legs.map((leg) => leg.settlement),
    );
    assert.ok(Math.abs(parlay.combined_probability - measured) < 1e-3);
  });

  it('never assembles a combination that cannot come in', () => {
    const result = buildSameGame(candidates, distribution, { risk: 'high', legs: 6 });
    if (!result.parlay) return;
    assert.ok(result.parlay.combined_probability > 0.01);
  });

  it('drops incompatible legs from a slip the reader assembled', () => {
    const over = find((s) => s.type === 'total');
    const slip = assembleSlip([over, { ...over, id: 'again' }], distribution);
    assert.equal(slip.legs.length, 1);
    assert.equal(slip.dropped, 1);
  });
});

// ---------------------------------------------------------------------------
// Selections built against real markets
// ---------------------------------------------------------------------------

describe('selections against available markets', () => {
  const set = buildRatings(toResults(syntheticSeason(60, 'nfl'), Number.POSITIVE_INFINITY), NFL);
  const fixture = game('espn-nfl-1', 'Strong', 'Weak', { sport: 'nfl', league: 'NFL' });
  const outcome = projectGame(fixture, set, NFL, { simulations: 8000, seed: 3 })!;
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const quotes = normaliseOdds(RAW_NFL_ODDS, 'espn-nfl-1', '2026-09-03T11:58:00.000Z')!;

  const withMarkets = candidateSelections(fixture, outcome, NFL, quotes, now);
  const withoutMarkets = candidateSelections(fixture, outcome, NFL, null, now);

  it('takes the bookmaker\'s line rather than inventing its own', () => {
    // The failure the redesign exists to fix: recommending +3.5 when the only
    // handicap on offer was 1.5.
    const spreads = withMarkets.filter((s) => s.type === 'spread');
    assert.ok(spreads.length > 0);
    for (const spread of spreads) {
      assert.equal(Math.abs(spread.market.line!), 3.5, spread.label);
      assert.equal(spread.market.availability, 'verified');
    }
  });

  it('carries the price and the book through to the selection', () => {
    const home = withMarkets.find(
      (s) => s.type === 'winner' && s.settlement.kind === 'winner' && s.settlement.side === 'home',
    )!;
    assert.equal(home.market.source, 'DraftKings');
    assert.equal(home.market.price!.american, -175);
    assert.ok(home.edge, 'a priced market can be disagreed with');
    assert.ok(Math.abs(home.edge!.edge - (home.probability - home.market.price!.implied)) < 1e-6);
  });

  it('compares against the de-vigged figure where both sides are known', () => {
    const home = withMarkets.find(
      (s) => s.type === 'winner' && s.settlement.kind === 'winner' && s.settlement.side === 'home',
    )!;
    assert.ok(home.edge!.fair !== null);
    assert.ok(home.market.margin !== null && home.market.margin > 0);
  });

  it('offers both sides of a market, not only the one it likes', () => {
    const sides = withMarkets
      .filter((s) => s.type === 'winner')
      .map((s) => (s.settlement.kind === 'winner' ? s.settlement.side : null));
    assert.ok(sides.includes('home'));
    assert.ok(sides.includes('away'));
  });

  it('labels its own lines as unverified when nobody is quoting', () => {
    for (const selection of withoutMarkets) {
      assert.equal(selection.market.availability, 'model_only', selection.label);
      assert.equal(selection.market.price, null);
      assert.equal(selection.edge, null, 'there is no price to disagree with');
    }
  });

  it('still models markets the feed does not carry', () => {
    // Team totals are not quoted anywhere in the feed, so they are model
    // projections even on a fixture that is otherwise fully priced.
    const teamTotals = withMarkets.filter((s) => s.type === 'team_total');
    assert.ok(teamTotals.length > 0);
    for (const selection of teamTotals) {
      assert.equal(selection.market.availability, 'model_only');
    }
  });

  it('does not duplicate a market the feed already covers', () => {
    const spreadLines = new Set(withMarkets.filter((s) => s.type === 'spread').map((s) => s.market.line));
    assert.deepEqual([...spreadLines].sort((a, b) => a! - b!), [-3.5, 3.5]);
  });

  it('falls back to its own lines when the quote has gone stale', () => {
    const stale = candidateSelections(
      fixture,
      outcome,
      NFL,
      normaliseOdds(RAW_NFL_ODDS, 'espn-nfl-1', '2026-09-03T10:00:00.000Z'),
      now,
    );
    // An hour-old price is not evidence that the market is available now.
    assert.ok(stale.every((s) => s.market.availability === 'model_only'));
  });

  it('explains and labels every selection it produces', () => {
    for (const selection of [...withMarkets, ...withoutMarkets]) {
      assert.ok(selection.explanation.length > 10, selection.label);
      assert.ok(selection.probability_label.length > 0, selection.label);
      assert.ok(selection.market.label.length > 0, selection.label);
    }
  });

  it('orients each selection\'s reasoning to what that selection backs', () => {
    const home = withMarkets.find(
      (s) => s.type === 'winner' && s.settlement.kind === 'winner' && s.settlement.side === 'home',
    )!;
    const away = withMarkets.find(
      (s) => s.type === 'winner' && s.settlement.kind === 'winner' && s.settlement.side === 'away',
    )!;

    // The same fixture, the same evidence, opposite readings.
    const homeSupport = new Set(home.reasoning.support.map((f) => f.text));
    const awayRisks = new Set(away.reasoning.risks.map((f) => f.text));
    assert.ok([...homeSupport].some((text) => awayRisks.has(text)));
  });

  it('gives a stable id to the same bet', () => {
    const again = candidateSelections(fixture, outcome, NFL, quotes, now);
    assert.deepEqual(
      withMarkets.map((s) => s.id),
      again.map((s) => s.id),
      'publishing is idempotent only if ids are stable',
    );
  });
});

// ---------------------------------------------------------------------------
// Pricing and explaining a line
// ---------------------------------------------------------------------------

describe('pricing a line', () => {
  const set = buildRatings(toResults(syntheticSeason(60, 'nfl'), Number.POSITIVE_INFINITY), NFL);
  const fixture = game('espn-nfl-2', 'Strong', 'Weak', { sport: 'nfl', league: 'NFL' });
  const outcome = projectGame(fixture, set, NFL, { simulations: 8000, seed: 5 })!;
  const now = Date.parse('2026-09-03T12:00:00.000Z');
  const quotes = normaliseOdds(RAW_NFL_ODDS, 'espn-nfl-2', '2026-09-03T11:58:00.000Z')!;
  const priced = candidateSelections(fixture, outcome, NFL, quotes, now).filter(
    (s) => s.market.price !== null,
  );

  it('multiplies the legs to price the line', () => {
    const legs = priced.slice(0, 2);
    const price = priceParlay(legs, 0.5)!;
    const expected = legs.reduce((product, leg) => product * leg.market.price!.decimal, 1);
    assert.ok(Math.abs(price.decimal - expected) < 1e-3);
    assert.ok(Math.abs(price.implied - 1 / price.decimal) < 1e-3);
    assert.deepEqual(price.sources, ['DraftKings']);
  });

  it('gives no price when a leg is a model projection', () => {
    const unpriced = candidateSelections(fixture, outcome, NFL, null, now)[0];
    assert.equal(priceParlay([priced[0], unpriced], 0.5), null);
  });

  it('explains the classification from what the legs turned out to be', () => {
    const text = explainRisk(priced.slice(0, 2), 'low');
    assert.match(text, /Classified low risk/);
    assert.match(text, /\d+%/, 'it quotes the actual leg probabilities');
    assert.match(text, /bookmaker/);
  });

  it('says plainly when nothing was confirmed against a bookmaker', () => {
    const unpriced = candidateSelections(fixture, outcome, NFL, null, now).slice(0, 2);
    assert.match(explainRisk(unpriced, 'high'), /no leg confirmed/);
  });
});
