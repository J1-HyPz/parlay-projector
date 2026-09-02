import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  boundProbability,
  brierScore,
  createRandom,
  decayWeights,
  eloExpectation,
  impliedOdds,
  logLoss,
  normalCdf,
  normalise,
  poissonAtLeast,
  poissonCdf,
  poissonPmf,
  seedFrom,
  weightedMean,
} from '../lib/projections/math.ts';
import { buildRatings, dataQuality, estimateConfidence, toResults } from '../lib/projections/features.ts';
import { expectedScores, outcomeProbabilities, simulate } from '../lib/projections/model.ts';
import { candidateSelections, projectGame, selectionScore } from '../lib/projections/project.ts';
import {
  availableDays,
  bestPerGame,
  combinedProbability,
  eligible,
  optimise,
  selectionsOnDate,
} from '../lib/projections/optimiser.ts';
import { calculateMetrics, calibration, settle } from '../lib/projections/settlement.ts';
import { backtest } from '../lib/projections/backtest.ts';
import { awaitingSettlement, parsePredictions } from '../lib/projections/store-parse.ts';
import { MIN_LEGS, RISK_PROFILES, modelConfigFor } from '../lib/projections/config.ts';
import { MIN_DATA_QUALITY } from '../lib/projections/types.ts';
import { halveRange, splitRange } from '../lib/providers/espn/fixture-normalise.ts';
import type { Game } from '../lib/home/types.ts';
import type {
  PredictionRecordV2,
  Selection,
  SettlementRule,
} from '../lib/projections/types.ts';

// ---------------------------------------------------------------------------
// Mathematics
// ---------------------------------------------------------------------------

describe('probability primitives', () => {
  it('keeps probabilities strictly inside (0, 1)', () => {
    // A stored 0 or 1 would make log loss infinite, and no sports outcome is
    // certain anyway.
    assert.ok(boundProbability(0) > 0);
    assert.ok(boundProbability(1) < 1);
    assert.equal(boundProbability(Number.NaN), 0.5);
  });

  it('normalises a set to sum to one', () => {
    const [a, b, c] = normalise([2, 1, 1]);
    assert.ok(Math.abs(a + b + c - 1) < 1e-9);
    assert.ok(Math.abs(a - 0.5) < 1e-9);
  });

  it('matches known normal CDF values', () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-6);
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-3);
    assert.ok(Math.abs(normalCdf(-1.96) - 0.025) < 1e-3);
  });

  it('matches known Poisson values', () => {
    // P(X=0 | lambda=2) = e^-2
    assert.ok(Math.abs(poissonPmf(0, 2) - Math.exp(-2)) < 1e-9);
    assert.ok(Math.abs(poissonPmf(2, 2) - 2 * Math.exp(-2)) < 1e-9);
    assert.ok(Math.abs(poissonCdf(50, 2) - 1) < 1e-6);
    assert.ok(Math.abs(poissonAtLeast(1, 2) - (1 - Math.exp(-2))) < 1e-9);
  });

  it('gives an even Elo expectation for equal ratings', () => {
    assert.equal(eloExpectation(0), 0.5);
    assert.ok(eloExpectation(400) > 0.9);
    assert.ok(eloExpectation(-400) < 0.1);
  });

  it('weights recent observations more heavily', () => {
    const weights = decayWeights(4, 2);
    assert.equal(weights[0], 1);
    assert.ok(weights[1] > weights[2] && weights[2] > weights[3]);
    // Older games still count for something.
    assert.ok(weights[3] > 0);
  });

  it('averages with weights', () => {
    assert.equal(weightedMean([10, 0], [1, 1]), 5);
    assert.equal(weightedMean([10, 0], [3, 1]), 7.5);
    assert.equal(weightedMean([], []), null);
  });

  it('scores probability quality', () => {
    // Brier: a confident correct call scores near zero, a confident miss near one.
    assert.ok(brierScore(0.9, true) < 0.02);
    assert.ok(brierScore(0.9, false) > 0.8);
    assert.equal(brierScore(0.5, true), 0.25);
    // Log loss punishes confident misses far harder than Brier.
    assert.ok(logLoss(0.99, false) > logLoss(0.6, false));
  });

  it('expresses a probability as decimal odds', () => {
    assert.equal(impliedOdds(0.5), 2);
    assert.equal(impliedOdds(0.25), 4);
  });
});

describe('deterministic randomness', () => {
  it('reproduces a sequence from the same seed', () => {
    const a = createRandom(42);
    const b = createRandom(42);
    for (let i = 0; i < 20; i += 1) assert.equal(a(), b());
  });

  it('differs between seeds', () => {
    assert.notEqual(createRandom(1)(), createRandom(2)());
  });

  it('derives a stable seed from a game id', () => {
    assert.equal(seedFrom('espn-nfl-401779'), seedFrom('espn-nfl-401779'));
    assert.notEqual(seedFrom('espn-nfl-401779'), seedFrom('espn-nfl-401780'));
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NFL = modelConfigFor('nfl')!;
const FOOTBALL = modelConfigFor('football')!;

function game(
  id: string,
  home: string,
  away: string,
  overrides: Partial<Game> = {},
): Game {
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

/**
 * A synthetic league where one side is genuinely stronger.
 *
 * `strong` wins most games by a clear margin, so the model has something real
 * to find rather than noise.
 */
function syntheticSeason(count: number, sport: 'football' | 'nfl' = 'football'): Game[] {
  const games: Game[] = [];
  const teams = ['Strong', 'Middle', 'Weak'];
  const scoreFor = (team: string) =>
    sport === 'football'
      ? { Strong: 3, Middle: 1, Weak: 0 }[team] ?? 1
      : { Strong: 31, Middle: 20, Weak: 13 }[team] ?? 20;

  for (let i = 0; i < count; i += 1) {
    const home = teams[i % 3];
    const away = teams[(i + 1) % 3];
    const day = String(i + 1).padStart(2, '0');
    games.push(
      game(`g${i}`, home, away, {
        sport: sport === 'football' ? 'football' : 'nfl',
        status: 'finished',
        // Spread across months so dates stay valid and ordered.
        start_time: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}T14:00:00.000Z`,
        score: { home: scoreFor(home), away: scoreFor(away) },
      }),
    );
    void day;
  }
  return games;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

describe('feature building', () => {
  it('uses only games that finished before the cut-off', () => {
    const games = syntheticSeason(30);
    const cutoff = Date.parse('2026-01-15T00:00:00.000Z');
    const results = toResults(games, cutoff);

    assert.ok(results.length > 0);
    for (const result of results) {
      assert.ok(result.date < cutoff, 'a result after the cut-off leaked in');
    }
  });

  it('ignores unfinished games and games with no score', () => {
    const games = [
      game('a', 'Strong', 'Weak', { status: 'scheduled' }),
      game('b', 'Strong', 'Weak', { status: 'finished' }),
      game('c', 'Strong', 'Weak', { status: 'finished', score: { home: null, away: 2 } }),
    ];
    assert.deepEqual(toResults(games, Number.POSITIVE_INFINITY), []);
  });

  it('rates the stronger side higher', () => {
    const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
    const strong = set.ratings.get('Strong');
    const weak = set.ratings.get('Weak');

    assert.ok(strong && weak);
    assert.ok(strong.elo > weak.elo, 'Elo should separate the sides');
    assert.ok(strong.adjustedAttack > weak.adjustedAttack);
    assert.ok(strong.adjustedDefence < weak.adjustedDefence);
  });

  it('regresses a thin sample toward the league average', () => {
    const thin = buildRatings(toResults(syntheticSeason(6), Number.POSITIVE_INFINITY), FOOTBALL);
    const full = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);

    const thinGap =
      (thin.ratings.get('Strong')?.adjustedAttack ?? 0) -
      (thin.ratings.get('Weak')?.adjustedAttack ?? 0);
    const fullGap =
      (full.ratings.get('Strong')?.adjustedAttack ?? 0) -
      (full.ratings.get('Weak')?.adjustedAttack ?? 0);

    assert.ok(thinGap < fullGap, 'six games should not produce a full-strength rating');
  });

  it('reports no data quality below the minimum sample', () => {
    const set = buildRatings(toResults(syntheticSeason(4), Number.POSITIVE_INFINITY), FOOTBALL);
    const quality = dataQuality(set.ratings.get('Strong'), set.ratings.get('Weak'), FOOTBALL, {
      hasStandings: false,
      hasHeadToHead: false,
    });
    assert.equal(quality, 0);
  });

  it('is driven by the weaker of the two samples', () => {
    const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
    const strong = set.ratings.get('Strong')!;
    const thin = { ...strong, games: 7 };

    const even = dataQuality(strong, strong, FOOTBALL, { hasStandings: true, hasHeadToHead: true });
    const lopsided = dataQuality(strong, thin, FOOTBALL, {
      hasStandings: true,
      hasHeadToHead: true,
    });
    assert.ok(lopsided < even, 'one thin side should drag the quality down');
  });

  it('keeps confidence separate from probability', () => {
    const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
    const confidence = estimateConfidence(
      set.ratings.get('Strong'),
      set.ratings.get('Weak'),
      0.9,
      FOOTBALL,
    );
    assert.ok(confidence > 0 && confidence <= 0.95);
  });
});

// ---------------------------------------------------------------------------
// Model output
// ---------------------------------------------------------------------------

describe('projections', () => {
  const season = syntheticSeason(60);
  const set = buildRatings(toResults(season, Number.POSITIVE_INFINITY), FOOTBALL);
  const fixture = game('upcoming', 'Strong', 'Weak');

  const outcome = projectGame(fixture, set, FOOTBALL, { simulations: 4000, seed: 7 })!;

  it('produces a projection from a real sample', () => {
    assert.ok(outcome, 'a full synthetic season should support a projection');
  });

  it('sums a three-way outcome to one', () => {
    const { home, draw, away } = outcome.projection.outcome;
    assert.ok(draw !== undefined, 'football must model the draw');
    assert.ok(Math.abs(home + draw + away - 1) < 1e-6);
  });

  it('sums a two-way outcome to one', () => {
    const nflSeason = syntheticSeason(60, 'nfl');
    const nflSet = buildRatings(toResults(nflSeason, Number.POSITIVE_INFINITY), NFL);
    const nflOutcome = projectGame(
      game('nfl-upcoming', 'Strong', 'Weak', { sport: 'nfl', league: 'NFL' }),
      nflSet,
      NFL,
      { simulations: 4000, seed: 7 },
    )!;

    const { home, away, draw } = nflOutcome.projection.outcome;
    assert.equal(draw, undefined, 'the NFL has no draw to model');
    assert.ok(Math.abs(home + away - 1) < 1e-6);
  });

  it('favours the stronger side', () => {
    assert.ok(outcome.projection.outcome.home > outcome.projection.outcome.away);
    assert.ok(outcome.projection.expected_margin > 0);
  });

  it('produces no NaN and no negative scores', () => {
    const p = outcome.projection;
    for (const value of [
      p.expected_home_score,
      p.expected_away_score,
      p.expected_total,
      p.expected_margin,
      p.confidence,
      p.data_quality,
    ]) {
      assert.ok(Number.isFinite(value), 'every projected value must be finite');
    }
    assert.ok(p.expected_home_score >= 0);
    assert.ok(p.expected_away_score >= 0);
    assert.ok(p.expected_total >= 0);
  });

  it('keeps the margin consistent with the scores', () => {
    const p = outcome.projection;
    assert.ok(Math.abs(p.expected_margin - (p.expected_home_score - p.expected_away_score)) < 0.05);
  });

  it('is reproducible from the same seed', () => {
    const again = projectGame(fixture, set, FOOTBALL, { simulations: 4000, seed: 7 })!;
    assert.equal(again.projection.outcome.home, outcome.projection.outcome.home);
    assert.equal(again.projection.expected_margin, outcome.projection.expected_margin);
  });

  it('refuses to project without enough data', () => {
    const thin = buildRatings(toResults(syntheticSeason(4), Number.POSITIVE_INFINITY), FOOTBALL);
    assert.equal(projectGame(fixture, thin, FOOTBALL, { simulations: 500, seed: 1 }), null);
  });

  it('refuses to project a team it has never seen', () => {
    const unknown = game('x', 'Nobody FC', 'Weak');
    assert.equal(projectGame(unknown, set, FOOTBALL, { simulations: 500, seed: 1 }), null);
  });

  it('refuses to project a fixture with no kick-off time', () => {
    const undated = game('y', 'Strong', 'Weak', { start_time: null });
    assert.equal(projectGame(undated, set, FOOTBALL, { simulations: 500, seed: 1 }), null);
  });

  it('reports data quality above the minimum when it projects at all', () => {
    assert.ok(outcome.projection.data_quality >= MIN_DATA_QUALITY);
  });

  it('explains itself in both directions', () => {
    assert.ok(outcome.projection.factors.length > 0);
    assert.ok(outcome.projection.factors.some((factor) => factor.direction === 'positive'));
  });

  it('applies home advantage', () => {
    const home = expectedScores('Strong', 'Weak', set, FOOTBALL, Date.now())!;
    const away = expectedScores('Weak', 'Strong', set, FOOTBALL, Date.now())!;
    // The same pairing, sides reversed: the stronger team should be projected
    // higher at home than away.
    assert.ok(home.home > away.away);
  });
});

describe('simulation', () => {
  const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
  const expected = expectedScores('Strong', 'Weak', set, FOOTBALL, Date.now())!;

  it('splits every simulation between the outcomes', () => {
    const distribution = simulate(expected, FOOTBALL, { simulations: 5000, seed: 3 });
    const total = distribution.homeWin + distribution.awayWin + distribution.draw;
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it('never leaves a tie in a sport without draws', () => {
    const distribution = simulate(expected, NFL, { simulations: 3000, seed: 3 });
    assert.equal(distribution.draw, 0, 'overtime resolves a tie');
    assert.ok(Math.abs(distribution.homeWin + distribution.awayWin - 1) < 1e-9);
  });

  it('centres on the expected scores', () => {
    const distribution = simulate(expected, FOOTBALL, { simulations: 20000, seed: 11 });
    assert.ok(Math.abs(distribution.meanHome - expected.home) < 0.1);
    assert.ok(Math.abs(distribution.meanAway - expected.away) < 0.1);
  });

  it('normalises reported outcomes', () => {
    const distribution = simulate(expected, FOOTBALL, { simulations: 2000, seed: 5 });
    const probabilities = outcomeProbabilities(distribution, true);
    const total = probabilities.home + (probabilities.draw ?? 0) + probabilities.away;
    assert.ok(Math.abs(total - 1) < 1e-6);
  });
});

// ---------------------------------------------------------------------------
// Selections
// ---------------------------------------------------------------------------

describe('candidate selections', () => {
  const set = buildRatings(toResults(syntheticSeason(60), Number.POSITIVE_INFINITY), FOOTBALL);
  const fixture = game('sel', 'Strong', 'Weak');
  const outcome = projectGame(fixture, set, FOOTBALL, { simulations: 6000, seed: 9 })!;
  const candidates = candidateSelections(fixture, outcome, FOOTBALL);

  it('produces sport-appropriate selections', () => {
    const types = new Set(candidates.map((c) => c.type));
    assert.ok(types.has('winner'));
    assert.ok(types.has('double_chance'), 'football has a draw, so double chance applies');
    assert.ok(types.has('total'));
    assert.ok(types.has('team_total'));
    assert.equal(types.has('spread'), false, 'a goal handicap is not modelled for football');
  });

  it('offers a spread where the sport supports one', () => {
    const nflSet = buildRatings(toResults(syntheticSeason(60, 'nfl'), Number.POSITIVE_INFINITY), NFL);
    const nflGame = game('nfl-sel', 'Strong', 'Weak', { sport: 'nfl', league: 'NFL' });
    const nflOutcome = projectGame(nflGame, nflSet, NFL, { simulations: 6000, seed: 9 })!;
    const types = new Set(candidateSelections(nflGame, nflOutcome, NFL).map((c) => c.type));
    assert.ok(types.has('spread'));
  });

  it('never generates player props', () => {
    // No player statistics, injuries or lineups exist in this application, so
    // the preconditions for a player projection cannot be met.
    assert.equal(candidates.some((c) => c.type === 'player_performance'), false);
  });

  it('gives every selection a valid probability', () => {
    for (const candidate of candidates) {
      assert.ok(candidate.probability > 0 && candidate.probability < 1, candidate.label);
      assert.ok(Number.isFinite(candidate.score));
    }
  });

  it('rates a double chance at least as likely as the win alone', () => {
    const win = candidates.find((c) => c.type === 'winner')!;
    const dc = candidates.find((c) => c.type === 'double_chance')!;
    assert.ok(dc.probability >= win.probability);
  });

  it('shares one correlation group per game', () => {
    assert.equal(new Set(candidates.map((c) => c.correlation_group)).size, 1);
  });

  it('ranks by quality, not probability alone', () => {
    // An 85% call from poor data must score below a 72% one from good data.
    assert.ok(selectionScore(0.72, 0.9, 0.9) > selectionScore(0.85, 0.5, 0.5));
  });

  it('uses half-point lines so nothing pushes', () => {
    for (const candidate of candidates) {
      if (candidate.settlement.kind === 'total' || candidate.settlement.kind === 'team_total') {
        assert.equal(candidate.settlement.line % 1, 0.5, candidate.label);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Risk and the optimiser
// ---------------------------------------------------------------------------

function selection(id: string, gameId: string, overrides: Partial<Selection> = {}): Selection {
  const base = {
    probability: 0.75,
    confidence: 0.8,
    data_quality: 0.8,
    type: 'winner' as const,
    sport: 'nfl' as const,
  };
  const merged = { ...base, ...overrides };
  return {
    id,
    game_id: gameId,
    sport: merged.sport,
    league: 'NFL',
    start_time: '2026-09-10T14:00:00.000Z',
    fixture: `${gameId} fixture`,
    type: merged.type,
    label: `${id} label`,
    probability: merged.probability,
    confidence: merged.confidence,
    data_quality: merged.data_quality,
    score: selectionScore(merged.probability, merged.confidence, merged.data_quality),
    correlation_group: gameId,
    settlement: { kind: 'winner', side: 'home' },
    factors: [],
    projection: {
      game_id: gameId,
      sport: merged.sport,
      league: 'NFL',
      start_time: '2026-09-10T14:00:00.000Z',
      home_team: 'Home',
      away_team: 'Away',
      outcome: { home: merged.probability, away: 1 - merged.probability },
      expected_home_score: 27,
      expected_away_score: 23,
      expected_margin: 4,
      expected_total: 50,
      model_spread: 4,
      confidence: merged.confidence,
      data_quality: merged.data_quality,
      model_version: 'projection-v1',
      factors: [],
      generated_at: '2026-09-01T00:00:00.000Z',
    },
    ...overrides,
  } as Selection;
}

describe('risk thresholds', () => {
  it('orders the profiles from safest to most specific', () => {
    assert.ok(RISK_PROFILES.low.minProbability > RISK_PROFILES.medium.minProbability);
    assert.ok(RISK_PROFILES.medium.minProbability > RISK_PROFILES.high.minProbability);
    assert.ok(RISK_PROFILES.low.minDataQuality >= RISK_PROFILES.high.minDataQuality);
  });

  it('takes more selections as risk rises', () => {
    assert.ok(RISK_PROFILES.low.defaultLegs < RISK_PROFILES.high.defaultLegs);
  });

  it('rejects a candidate outside the band', () => {
    const low = RISK_PROFILES.low;
    assert.equal(eligible([selection('a', 'g1', { probability: 0.55 })], low).length, 0);
    assert.equal(eligible([selection('b', 'g1', { probability: 0.99 })], low).length, 0);
    assert.equal(eligible([selection('c', 'g1', { probability: 0.8 })], low).length, 1);
  });

  it('rejects a candidate whose data is too thin for the profile', () => {
    const low = RISK_PROFILES.low;
    assert.equal(eligible([selection('d', 'g1', { data_quality: 0.4 })], low).length, 0);
    assert.equal(eligible([selection('e', 'g1', { confidence: 0.3 })], low).length, 0);
  });
});

describe('the optimiser', () => {
  const pool = [
    selection('a', 'g1', { probability: 0.82, sport: 'nfl' }),
    selection('b', 'g1', { probability: 0.79, sport: 'nfl' }),
    selection('c', 'g2', { probability: 0.78, sport: 'nba' }),
    selection('d', 'g3', { probability: 0.76, sport: 'mlb' }),
    selection('e', 'g4', { probability: 0.74, sport: 'nhl' }),
  ];

  it('never takes two selections from the same game', () => {
    const { parlay } = optimise(pool, { risk: 'low', legs: 4 });
    assert.ok(parlay);
    const games = parlay.legs.map((leg) => leg.game_id);
    assert.equal(new Set(games).size, games.length, 'correlated legs from one game');
  });

  it('keeps only the strongest candidate per game', () => {
    const best = bestPerGame(pool);
    assert.equal(best.filter((s) => s.game_id === 'g1').length, 1);
    assert.equal(best.find((s) => s.game_id === 'g1')?.id, 'a');
  });

  it('multiplies the leg probabilities', () => {
    const legs = [
      selection('x', 'g1', { probability: 0.8 }),
      selection('y', 'g2', { probability: 0.75 }),
      selection('z', 'g3', { probability: 0.72 }),
    ];
    assert.ok(Math.abs(combinedProbability(legs) - 0.432) < 1e-9);
  });

  it('honours the requested number of legs', () => {
    const { parlay } = optimise(pool, { risk: 'low', legs: 3 });
    assert.equal(parlay?.legs.length, 3);
  });

  it('returns fewer legs rather than padding', () => {
    const two = [
      selection('a', 'g1', { probability: 0.8 }),
      selection('b', 'g2', { probability: 0.78 }),
    ];
    const { parlay } = optimise(two, { risk: 'low', legs: 5 });
    assert.equal(parlay?.legs.length, 2, 'a weak candidate must not be added to fill space');
  });

  it('returns nothing when too few candidates qualify', () => {
    const one = [selection('a', 'g1', { probability: 0.8 })];
    const result = optimise(one, { risk: 'low', legs: 3 });
    assert.equal(result.parlay, null);
    assert.ok(result.gamesAvailable < MIN_LEGS);
  });

  it('changes the combination on regenerate without changing probabilities', () => {
    const first = optimise(pool, { risk: 'low', legs: 2, variant: 0 }).parlay!;
    const second = optimise(pool, { risk: 'low', legs: 2, variant: 1 }).parlay!;

    const firstIds = first.legs.map((l) => l.id).join(',');
    const secondIds = second.legs.map((l) => l.id).join(',');
    assert.notEqual(firstIds, secondIds, 'regenerate should explore an alternative');

    // Every probability is model output and must be untouched by regeneration.
    for (const leg of [...first.legs, ...second.legs]) {
      const original = pool.find((candidate) => candidate.id === leg.id)!;
      assert.equal(leg.probability, original.probability);
    }
  });

  it('spreads across sports when quality is comparable', () => {
    const { parlay } = optimise(pool, { risk: 'low', legs: 4 });
    const sports = new Set(parlay?.legs.map((leg) => leg.sport));
    assert.ok(sports.size >= 3, 'four legs from four sports were available');
  });

  it('averages confidence and data quality across the legs', () => {
    const { parlay } = optimise(pool, { risk: 'low', legs: 3 });
    assert.ok(parlay);
    assert.ok(parlay.average_confidence > 0 && parlay.average_confidence <= 1);
    assert.ok(parlay.average_data_quality > 0 && parlay.average_data_quality <= 1);
  });
});


// ---------------------------------------------------------------------------
// Day selection
// ---------------------------------------------------------------------------

describe('narrowing candidates to one day', () => {
  const UTC = 'UTC';
  const dates = ['2026-09-10', '2026-09-11', '2026-09-12'];

  const pool = [
    selection('a', 'g1', { probability: 0.82, start_time: '2026-09-10T14:00:00.000Z' }),
    selection('b', 'g2', { probability: 0.79, start_time: '2026-09-10T19:00:00.000Z' }),
    selection('c', 'g3', { probability: 0.78, start_time: '2026-09-11T14:00:00.000Z' }),
    selection('d', 'g4', { probability: 0.55, start_time: '2026-09-11T16:00:00.000Z' }),
  ];

  it('keeps only fixtures kicking off on that day', () => {
    assert.deepEqual(
      selectionsOnDate(pool, '2026-09-10', UTC).map((s) => s.id),
      ['a', 'b'],
    );
    assert.deepEqual(
      selectionsOnDate(pool, '2026-09-12', UTC).map((s) => s.id),
      [],
    );
  });

  it('uses the application timezone, as Schedule does', () => {
    // 23:00 UTC is the next day in British summer time, and both pages must
    // agree on which day a fixture belongs to.
    const late = [selection('late', 'g9', { start_time: '2026-09-10T23:00:00.000Z' })];
    assert.equal(selectionsOnDate(late, '2026-09-10', 'Europe/London').length, 0);
    assert.equal(selectionsOnDate(late, '2026-09-11', 'Europe/London').length, 1);
  });

  it('ignores a fixture with no kick-off time', () => {
    const undated = [selection('x', 'g9', { start_time: null })];
    assert.deepEqual(selectionsOnDate(undated, '2026-09-10', UTC), []);
  });

  it('counts fixtures per day, not selections', () => {
    // Two candidates from one game is still one possible leg.
    const sameGame = [
      selection('a1', 'g1', { probability: 0.82, start_time: '2026-09-10T14:00:00.000Z' }),
      selection('a2', 'g1', { probability: 0.8, start_time: '2026-09-10T14:00:00.000Z' }),
    ];
    const [first] = availableDays(sameGame, ['2026-09-10'], 'low', UTC);
    assert.equal(first.games, 1);
    assert.equal(first.eligible, 1);
  });

  it('reports which days can actually produce a line', () => {
    const days = availableDays(pool, dates, 'low', UTC);

    const tenth = days.find((d) => d.date === '2026-09-10')!;
    assert.equal(tenth.eligible, 2);
    assert.equal(tenth.buildable, true, 'two qualifying fixtures is a line');

    // The 11th has two fixtures but only one clears the low-risk band.
    const eleventh = days.find((d) => d.date === '2026-09-11')!;
    assert.equal(eleventh.games, 2);
    assert.equal(eleventh.eligible, 1);
    assert.equal(eleventh.buildable, false, 'one leg is not a parlay');

    const twelfth = days.find((d) => d.date === '2026-09-12')!;
    assert.equal(twelfth.games, 0);
    assert.equal(twelfth.buildable, false);
  });

  it('answers for every requested day, including empty ones', () => {
    assert.equal(availableDays(pool, dates, 'low', UTC).length, dates.length);
    assert.equal(availableDays([], dates, 'low', UTC).length, dates.length);
  });

  it('changes with the risk level', () => {
    // The 0.55 candidate is below the low band and inside the high one, so the
    // 11th becomes buildable at higher risk.
    const low = availableDays(pool, dates, 'low', UTC).find((d) => d.date === '2026-09-11')!;
    const high = availableDays(pool, dates, 'high', UTC).find((d) => d.date === '2026-09-11')!;
    assert.equal(low.eligible, 1);
    assert.ok(high.eligible >= low.eligible);
  });

  it('builds a line from one day when that day supports it', () => {
    const onDay = selectionsOnDate(pool, '2026-09-10', UTC);
    const { parlay } = optimise(onDay, { risk: 'low', legs: 3 });
    assert.equal(parlay?.legs.length, 2, 'never padded beyond what the day offers');
    for (const leg of parlay!.legs) {
      assert.ok(leg.start_time?.startsWith('2026-09-10'));
    }
  });
});

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

describe('settlement', () => {
  const finished = (home: number, away: number) =>
    ({ home, away, status: 'finished' }) as const;

  it('settles a winner', () => {
    assert.equal(settle({ kind: 'winner', side: 'home' }, finished(27, 24)), 'won');
    assert.equal(settle({ kind: 'winner', side: 'home' }, finished(24, 27)), 'lost');
    assert.equal(settle({ kind: 'winner', side: 'draw' }, finished(1, 1)), 'won');
    assert.equal(settle({ kind: 'winner', side: 'home' }, finished(1, 1)), 'lost');
  });

  it('settles a double chance', () => {
    const rule: SettlementRule = { kind: 'double_chance', sides: ['home', 'draw'] };
    assert.equal(settle(rule, finished(2, 1)), 'won');
    assert.equal(settle(rule, finished(1, 1)), 'won');
    assert.equal(settle(rule, finished(0, 1)), 'lost');
  });

  it('settles a spread', () => {
    // Away +6.5 with a 4-point defeat covers.
    assert.equal(settle({ kind: 'spread', side: 'away', line: 6.5 }, finished(27, 23)), 'won');
    assert.equal(settle({ kind: 'spread', side: 'away', line: 2.5 }, finished(27, 23)), 'lost');
    assert.equal(settle({ kind: 'spread', side: 'home', line: -3.5 }, finished(27, 23)), 'won');
    assert.equal(settle({ kind: 'spread', side: 'home', line: -4.5 }, finished(27, 23)), 'lost');
  });

  it('settles a total', () => {
    assert.equal(settle({ kind: 'total', direction: 'over', line: 44.5 }, finished(27, 23)), 'won');
    assert.equal(settle({ kind: 'total', direction: 'under', line: 44.5 }, finished(27, 23)), 'lost');
  });

  it('settles a team total', () => {
    const rule: SettlementRule = {
      kind: 'team_total',
      side: 'home',
      direction: 'over',
      line: 0.5,
    };
    assert.equal(settle(rule, finished(2, 1)), 'won');
    assert.equal(settle(rule, finished(0, 1)), 'lost');
  });

  it('voids a game that was never played', () => {
    // The projection was never tested; counting it either way would distort
    // the accuracy figures.
    assert.equal(
      settle({ kind: 'winner', side: 'home' }, { home: 0, away: 0, status: 'cancelled' }),
      'void',
    );
    assert.equal(
      settle({ kind: 'total', direction: 'over', line: 2.5 }, { home: 0, away: 0, status: 'postponed' }),
      'void',
    );
  });

  it('voids an exact push', () => {
    assert.equal(settle({ kind: 'total', direction: 'over', line: 50 }, finished(27, 23)), 'void');
  });
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

function record(overrides: Partial<PredictionRecordV2> = {}): PredictionRecordV2 {
  return {
    id: Math.random().toString(36).slice(2),
    game_id: 'g1',
    sport: 'nfl',
    league: 'NFL',
    selection_type: 'winner',
    selection: 'Home to win',
    settlement: { kind: 'winner', side: 'home' },
    model_probability: 0.75,
    model_confidence: 0.8,
    data_quality: 0.8,
    model_version: 'projection-v1',
    risk: 'low',
    created_at: '2026-09-01T00:00:00.000Z',
    game_start: '2026-09-02T00:00:00.000Z',
    status: 'won',
    result: '27-24',
    settled_at: '2026-09-02T22:00:00.000Z',
    ...overrides,
  };
}

describe('model metrics', () => {
  it('withholds accuracy below a usable sample', () => {
    // Five settled predictions cannot support a percentage.
    const metrics = calculateMetrics(Array.from({ length: 5 }, () => record()));
    assert.equal(metrics.accuracy, null);
    assert.equal(metrics.settled, 5);
    // Scoring rules are still reported: they are informative at smaller n.
    assert.ok(metrics.brier !== null);
  });

  it('reports accuracy once there is enough', () => {
    const records = [
      ...Array.from({ length: 15 }, () => record({ status: 'won' })),
      ...Array.from({ length: 10 }, () => record({ status: 'lost' })),
    ];
    const metrics = calculateMetrics(records);
    assert.equal(metrics.settled, 25);
    assert.equal(metrics.accuracy, 0.6);
  });

  it('excludes pending and void from the settled count', () => {
    const metrics = calculateMetrics([
      record({ status: 'won' }),
      record({ status: 'pending' }),
      record({ status: 'void' }),
    ]);
    assert.equal(metrics.settled, 1);
    assert.equal(metrics.void, 1);
  });

  it('scores a perfectly confident model well and a wrong one badly', () => {
    const good = calculateMetrics(
      Array.from({ length: 20 }, () => record({ model_probability: 0.95, status: 'won' })),
    );
    const bad = calculateMetrics(
      Array.from({ length: 20 }, () => record({ model_probability: 0.95, status: 'lost' })),
    );
    assert.ok(good.brier! < 0.01);
    assert.ok(bad.brier! > 0.8);
    assert.ok(bad.log_loss! > good.log_loss!);
  });

  it('reports nothing when nothing has settled', () => {
    const metrics = calculateMetrics([record({ status: 'pending' })]);
    assert.equal(metrics.accuracy, null);
    assert.equal(metrics.brier, null);
  });
});

describe('calibration', () => {
  it('buckets predictions by probability band', () => {
    const records = [
      ...Array.from({ length: 12 }, (_, i) =>
        record({ model_probability: 0.75, status: i < 9 ? 'won' : 'lost' }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        record({ model_probability: 0.85, status: i < 10 ? 'won' : 'lost' }),
      ),
    ];

    const buckets = calibration(records);
    const band70 = buckets.find((bucket) => bucket.label === '70-79%')!;
    const band80 = buckets.find((bucket) => bucket.label === '80-89%')!;

    assert.equal(band70.predictions, 12);
    assert.equal(band70.actual, 0.75);
    assert.equal(band70.expected, 0.75);
    assert.ok(band80.actual !== null && band80.actual > band70.actual!);
  });

  it('withholds a rate from a thin bucket', () => {
    const buckets = calibration([record({ model_probability: 0.75 })]);
    assert.equal(buckets.find((bucket) => bucket.label === '70-79%')?.actual, null);
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe('the prediction store', () => {
  it('accepts a well-formed record', () => {
    assert.equal(parsePredictions({ predictions: [record()] }).length, 1);
    assert.equal(parsePredictions([record()]).length, 1);
  });

  it('drops a record whose settlement rule is missing or broken', () => {
    // Rebuilding a rule from the label would settle against a line the model
    // never published.
    assert.deepEqual(parsePredictions([record({ settlement: undefined as never })]), []);
    assert.deepEqual(
      parsePredictions([record({ settlement: { kind: 'spread', side: 'home' } as never })]),
      [],
    );
  });

  it('rejects an out-of-range probability', () => {
    assert.deepEqual(parsePredictions([record({ model_probability: 1.4 })]), []);
    assert.deepEqual(parsePredictions([record({ model_probability: -0.1 })]), []);
  });

  it('de-duplicates by id, so nothing is counted twice', () => {
    const one = record({ id: 'same' });
    assert.equal(parsePredictions([one, { ...one }]).length, 1);
  });

  it('returns empty for junk', () => {
    assert.deepEqual(parsePredictions(null), []);
    assert.deepEqual(parsePredictions('nonsense'), []);
  });

  it('only settles predictions whose game has started', () => {
    const now = Date.parse('2026-09-10T12:00:00.000Z');
    const pending = awaitingSettlement(
      [
        record({ status: 'pending', game_start: '2026-09-10T09:00:00.000Z', id: 'started' }),
        record({ status: 'pending', game_start: '2026-09-10T19:00:00.000Z', id: 'tonight' }),
        record({ status: 'won', game_start: '2026-09-09T09:00:00.000Z', id: 'done' }),
      ],
      now,
    );
    assert.deepEqual(pending.map((p) => p.id), ['started']);
  });
});

// ---------------------------------------------------------------------------
// Backtesting
// ---------------------------------------------------------------------------

describe('backtesting', () => {
  it('evaluates historical games and reports probability quality', () => {
    const report = backtest(syntheticSeason(90), FOOTBALL, {
      minHistory: 30,
      simulations: 800,
      seed: 5,
    });

    assert.ok(report.evaluated > 0, 'a 90-game season should yield evaluable fixtures');
    assert.ok(report.brier !== null && report.brier >= 0 && report.brier <= 1);
    assert.ok(report.log_loss !== null && report.log_loss > 0);
    assert.ok(report.margin_error !== null && report.margin_error >= 0);
  });

  it('beats an uninformed model on a league with a real signal', () => {
    // The synthetic league has a genuinely stronger side, so a working model
    // must score better than always saying 50% (Brier 0.25).
    const report = backtest(syntheticSeason(90), FOOTBALL, {
      minHistory: 30,
      simulations: 800,
      seed: 5,
    });
    assert.ok(report.brier! < 0.25, `Brier ${report.brier} should beat a coin flip`);
  });

  it('never lets a game influence its own prediction', () => {
    /*
     * The look-ahead check.
     *
     * Every case is re-derived from the results strictly before its kick-off.
     * If the backtest were leaking the game's own result, projecting from that
     * earlier slice would produce a different number.
     */
    const season = syntheticSeason(90);
    const report = backtest(season, FOOTBALL, { minHistory: 30, simulations: 800, seed: 5 });
    assert.ok(report.cases.length > 0);

    const played = toResults(season, Number.POSITIVE_INFINITY);

    for (const item of report.cases.slice(0, 5)) {
      const game = season.find((candidate) => candidate.id === item.game_id)!;
      const kickoff = Date.parse(game.start_time!);

      const history = played.filter((result) => result.date < kickoff);
      assert.ok(
        history.every((result) => result.date < kickoff),
        'history must end before kick-off',
      );

      const ratings = buildRatings(history, FOOTBALL);
      const rerun = projectGame(
        { ...game, status: 'scheduled', score: undefined },
        ratings,
        FOOTBALL,
        { simulations: 800, seed: 5, now: new Date(kickoff) },
      );

      assert.ok(rerun);
      assert.equal(
        rerun.projection.outcome.home,
        item.probability_home,
        'a backtest case must be reproducible from pre-game information alone',
      );
    }
  });

  it('skips games with too little history rather than guessing', () => {
    const report = backtest(syntheticSeason(40), FOOTBALL, {
      minHistory: 30,
      simulations: 500,
      seed: 5,
    });
    assert.ok(report.skipped > 0);
  });

  it('reports nothing when no game is evaluable', () => {
    const report = backtest(syntheticSeason(5), FOOTBALL, { minHistory: 100, simulations: 100 });
    assert.equal(report.evaluated, 0);
    assert.equal(report.accuracy, null);
    assert.equal(report.brier, null);
  });
});

// ---------------------------------------------------------------------------
// History windows
// ---------------------------------------------------------------------------

describe('splitting a history range', () => {
  it('covers the whole range with no gaps and no overlaps', () => {
    const windows = splitRange('2026-01-01', '2026-04-10', 45);

    assert.equal(windows[0].start, '2026-01-01');
    assert.equal(windows[windows.length - 1].end, '2026-04-10');

    for (let i = 1; i < windows.length; i += 1) {
      const previousEnd = Date.parse(`${windows[i - 1].end}T00:00:00Z`);
      const nextStart = Date.parse(`${windows[i].start}T00:00:00Z`);
      assert.equal(nextStart - previousEnd, 86_400_000, 'windows must be contiguous');
    }
  });

  it('keeps every window inside the requested span', () => {
    // The provider returns nothing at all for a range beyond about a year, so
    // an oversized window fails silently rather than erroring.
    for (const window of splitRange('2025-01-01', '2026-09-10', 45)) {
      const days =
        (Date.parse(`${window.end}T00:00:00Z`) - Date.parse(`${window.start}T00:00:00Z`)) /
          86_400_000 +
        1;
      assert.ok(days <= 45, `window of ${days} days exceeds the chunk size`);
    }
  });

  it('handles a range shorter than one window', () => {
    assert.deepEqual(splitRange('2026-01-01', '2026-01-05', 45), [
      { start: '2026-01-01', end: '2026-01-05' },
    ]);
  });

  it('handles a single day', () => {
    assert.deepEqual(splitRange('2026-01-01', '2026-01-01', 45), [
      { start: '2026-01-01', end: '2026-01-01' },
    ]);
  });

  it('rejects a backwards or malformed range', () => {
    assert.deepEqual(splitRange('2026-04-10', '2026-01-01', 45), []);
    assert.deepEqual(splitRange('not-a-date', '2026-01-01', 45), []);
  });

  it('splits a capped window in half without losing a day', () => {
    const [first, second] = halveRange({ start: '2026-01-01', end: '2026-01-10' });
    assert.equal(first.start, '2026-01-01');
    assert.equal(second.end, '2026-01-10');
    assert.equal(
      Date.parse(`${second.start}T00:00:00Z`) - Date.parse(`${first.end}T00:00:00Z`),
      86_400_000,
    );
  });

  it('cannot split a single day further', () => {
    const single = { start: '2026-01-01', end: '2026-01-01' };
    assert.deepEqual(halveRange(single), [single]);
  });
});

describe('history windows per sport', () => {
  it('reaches back far enough for each calendar', () => {
    // An NFL team plays 17 games across five months; a 200-day window in
    // September would hold barely one of them.
    assert.ok(modelConfigFor('nfl')!.historyDays >= 365);
    assert.ok(modelConfigFor('football')!.historyDays >= 365);
    // The others play often enough that a season fits in less.
    assert.ok(modelConfigFor('nba')!.historyDays >= 300);
    assert.ok(modelConfigFor('mlb')!.historyDays >= 250);
  });

  it('rates every football competition together', () => {
    // Without this a Champions League tie has only a handful of European games
    // behind it and never clears the minimum.
    for (const sport of ['football'] as const) {
      assert.equal(modelConfigFor(sport)!.ratingPool, 'football');
    }
  });

  it('keeps the American leagues separate', () => {
    for (const sport of ['nfl', 'nba', 'mlb', 'nhl'] as const) {
      assert.equal(modelConfigFor(sport)!.ratingPool, null);
    }
  });
});

// ---------------------------------------------------------------------------
// Sport coverage
// ---------------------------------------------------------------------------

describe('sport models', () => {
  it('configures each supported sport differently', () => {
    const nfl = modelConfigFor('nfl')!;
    const nba = modelConfigFor('nba')!;
    const football = modelConfigFor('football')!;

    // No single model applied blindly: scoring shape, home advantage and
    // baseline totals all differ.
    assert.notEqual(nfl.baselineTotal, nba.baselineTotal);
    assert.notEqual(nfl.homeAdvantage, football.homeAdvantage);
    assert.equal(football.scoring, 'poisson');
    assert.equal(nba.scoring, 'normal');
    assert.equal(football.hasDraw, true);
    assert.equal(nfl.hasDraw, false);
  });

  it('has no model for a sport with no data', () => {
    // The shared SportId type still contains tennis, but no tennis competition
    // exists in the league catalogue, so there is nothing to model.
    assert.equal(modelConfigFor('tennis'), null);
  });

  it('models every sport that has a competition', () => {
    for (const sport of ['nfl', 'nba', 'mlb', 'nhl', 'football'] as const) {
      assert.ok(modelConfigFor(sport), `${sport} has competitions but no model`);
    }
  });
});
