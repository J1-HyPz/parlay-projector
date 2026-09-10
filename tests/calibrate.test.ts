import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXPECTED_REGULAR_SEASON,
  bySeason,
  competitiveGames,
  measureDispersion,
  measureScoring,
} from '../lib/history/calibrate.ts';
import type { Game } from '../lib/home/types';

function game(date: string, overrides: Partial<Game> = {}): Game {
  return {
    id: date + Math.random().toString(36).slice(2, 6),
    sport: 'nfl',
    league: 'NFL',
    league_badge: null,
    season: date.slice(0, 4),
    round: null,
    start_time: `${date}T18:00:00.000Z`,
    status: 'finished',
    provider_status: 'Final',
    home_team: { id: '1', name: 'Home', logo: null },
    away_team: { id: '2', name: 'Away', logo: null },
    venue: { name: null, city: null, country: null },
    broadcast: null,
    score: { home: 24, away: 17 },
    ...overrides,
  } as Game;
}

describe('excluding pre-season', () => {
  it('drops August exhibition football and keeps February play-offs', () => {
    /*
     * The bug this test exists for. The first version kept anything falling
     * earlier in the calendar than the season opening, reasoning that such a
     * fixture must be the tail of a season begun the previous year — true of a
     * February play-off, and equally true of an August pre-season game. The
     * NFL filter consequently removed nothing at all: 335 in, 335 out, a
     * quarter of them exhibitions.
     */
    const games = [
      game('2024-08-10'), // pre-season
      game('2024-08-25'), // pre-season
      game('2024-09-08'), // week one
      game('2024-12-01'),
      game('2025-01-12'), // wild card
      game('2025-02-09'), // Super Bowl
    ];

    const kept = competitiveGames(games, 'nfl').map((g) => g.start_time?.slice(0, 10));
    assert.deepEqual(kept, ['2024-09-08', '2024-12-01', '2025-01-12', '2025-02-09']);
  });

  it('keeps a summer competition that shares a winter sport id', () => {
    // The CFL is `sport: 'nfl'` and plays June to November. The sport's own
    // window would discard its entire season.
    const games = [game('2025-07-04'), game('2025-09-12'), game('2025-11-16')];

    assert.equal(competitiveGames(games, 'nfl', 'cfl').length, 3);
    assert.equal(competitiveGames(games, 'nfl').length, 2, 'the sport default clips July');
  });

  it('drops spring training but keeps the World Series', () => {
    const games = [
      game('2025-02-25', { sport: 'mlb' }),
      game('2025-03-10', { sport: 'mlb' }),
      game('2025-04-02', { sport: 'mlb' }),
      game('2025-10-29', { sport: 'mlb' }),
    ];
    const kept = competitiveGames(games, 'mlb').map((g) => g.start_time?.slice(0, 10));
    assert.deepEqual(kept, ['2025-04-02', '2025-10-29']);
  });

  it('keeps a football season whole, August to May', () => {
    const games = [
      game('2024-07-20', { sport: 'football' }), // friendly
      game('2024-08-17', { sport: 'football' }),
      game('2025-05-25', { sport: 'football' }),
    ];
    const kept = competitiveGames(games, 'football').map((g) => g.start_time?.slice(0, 10));
    assert.deepEqual(kept, ['2024-08-17', '2025-05-25']);
  });

  it('requires a finished fixture with a real scoreline', () => {
    const games = [
      game('2024-09-08'),
      game('2024-09-09', { status: 'postponed' }),
      game('2024-09-10', { score: undefined }),
      game('2024-09-11', { score: { home: 3, away: null } as never }),
    ];
    assert.equal(competitiveGames(games, 'nfl').length, 1);
  });
});

describe('measuring what a competition scores', () => {
  it('reports the mean total, the mean margin and the spread', () => {
    const games = [
      game('2024-09-08', { score: { home: 20, away: 10 } }),
      game('2024-09-15', { score: { home: 30, away: 20 } }),
      game('2024-09-22', { score: { home: 10, away: 20 } }),
    ];
    const measured = measureScoring(games);
    assert.ok(measured);
    assert.equal(measured.games, 3);
    // Totals 30, 50, 30 -> mean 36.67.
    assert.ok(Math.abs(measured.baseline_total - 110 / 3) < 1e-9);
    // Margins +10, +10, -10 -> mean 3.33.
    assert.ok(Math.abs(measured.mean_home_margin - 10 / 3) < 1e-9);
    assert.ok(measured.margin_sd > 0);
  });

  it('counts the home win rate over decided fixtures only', () => {
    const games = [
      game('2024-09-08', { score: { home: 2, away: 1 } }),
      game('2024-09-15', { score: { home: 1, away: 2 } }),
      game('2024-09-22', { score: { home: 1, away: 1 } }),
    ];
    // One of two decided, so 50% — the draw is not a loss.
    assert.equal(measureScoring(games)?.home_win_rate, 0.5);
  });

  it('reports nothing rather than a zero when there is nothing to measure', () => {
    assert.equal(measureScoring([]), null);
  });
});

describe('grouping by season', () => {
  it('splits games into the seasons they belong to', () => {
    const seasons = bySeason([
      game('2023-10-01', { season: '2023' }),
      game('2024-10-01', { season: '2024' }),
      game('2024-11-01', { season: '2024' }),
    ]);
    assert.equal(seasons.get('2024')?.length, 2);
    assert.equal(seasons.get('2023')?.length, 1);
  });
});

describe('the expected-season table', () => {
  it('states sizes that match how each competition is actually structured', () => {
    // This table is the check on the date filter, so it is worth asserting it
    // says what the competitions really play rather than trusting the numbers.
    assert.equal(EXPECTED_REGULAR_SEASON.nfl, 32 * 17 / 2);
    assert.equal(EXPECTED_REGULAR_SEASON.nba, 30 * 82 / 2);
    assert.equal(EXPECTED_REGULAR_SEASON.nhl, 32 * 82 / 2);
    assert.equal(EXPECTED_REGULAR_SEASON.mlb, 30 * 162 / 2);
    assert.equal(EXPECTED_REGULAR_SEASON.epl, 20 * 19);
    assert.equal(EXPECTED_REGULAR_SEASON.bundesliga, 18 * 17);
    assert.equal(EXPECTED_REGULAR_SEASON.cfl, 9 * 18 / 2);
  });
});

describe('whether scoring is actually Poisson', () => {
  /** n fixtures scoring exactly `value` each side: zero variance. */
  const flat = (n: number, value: number) =>
    Array.from({ length: n }, (_, i) =>
      game(`2025-05-${String((i % 28) + 1).padStart(2, '0')}`, {
        sport: 'mlb',
        score: { home: value, away: value },
      }),
    );

  it('reports the variance-to-mean ratio a Poisson process fixes at one', () => {
    // Every score identical, so the variance is zero and the ratio is zero —
    // far below Poisson, which is the opposite failure to baseball's.
    const measured = measureDispersion(flat(20, 4));
    assert.ok(measured);
    assert.equal(measured.mean_score, 4);
    assert.equal(measured.variance_ratio, 0);
  });

  it('detects scoring too bursty for the distribution to produce', () => {
    /*
     * The MLB finding in miniature. Half the fixtures are shut-outs and half
     * are blow-outs, so the mean is ordinary and the variance is not — which
     * is exactly the shape no value of any constant can widen a Poisson
     * simulation to match.
     */
    const bursty = [...flat(20, 0), ...flat(20, 10)];
    const measured = measureDispersion(bursty);
    assert.ok(measured);
    assert.ok(measured.variance_ratio > 1.5, `ratio ${measured.variance_ratio}`);
    // Both sides score alike here, so every margin is zero while Poisson would
    // still spread them — the two figures are reported side by side precisely
    // so a gap like that is visible rather than inferred.
    assert.equal(measured.margin_sd, 0);
    assert.ok(measured.poisson_margin_sd > 0);
  });

  it('states the margin spread Poisson can produce, for comparison', () => {
    // sqrt(2 * mean score) — the SD of the difference of two Poisson draws.
    const measured = measureDispersion(flat(10, 4.5));
    assert.ok(measured);
    assert.ok(Math.abs(measured.poisson_margin_sd - Math.sqrt(9)) < 1e-9);
  });

  it('reports nothing rather than a ratio from one fixture', () => {
    assert.equal(measureDispersion([]), null);
  });
});
