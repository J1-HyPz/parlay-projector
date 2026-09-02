/**
 * Backtesting.
 *
 * Replays completed games as if they had not happened yet: for each one, the
 * ratings are rebuilt from *only* the games that finished before its kick-off,
 * a projection is produced, and the real result is then applied.
 *
 * The whole value of this rests on one rule — the model must never see the game
 * it is projecting, or anything that came after it. `toResults(games, asOf)`
 * enforces that at the source, and this module walks forward in time so the
 * cut-off is always the fixture's own kick-off. A test asserts it directly.
 *
 * Pure: takes games in, returns metrics out, touches no provider and no file.
 */

import { brierScore, logLoss } from './math.ts';
import { buildRatings, toResults } from './features.ts';
import { projectGame } from './project.ts';
import type { SportModelConfig } from './config.ts';
import type { Game } from '../home/types';

export interface BacktestCase {
  game_id: string;
  /** Probability the model gave the side that turned out to win. */
  probability_home: number;
  actual: 'home' | 'away' | 'draw';
  predicted: 'home' | 'away' | 'draw';
  correct: boolean;
  brier: number;
  log_loss: number;
  expected_margin: number;
  actual_margin: number;
}

export interface BacktestReport {
  /** Games that produced a projection. Others had too little history. */
  evaluated: number;
  /** Games skipped for insufficient data — not failures, just unprojectable. */
  skipped: number;
  accuracy: number | null;
  brier: number | null;
  log_loss: number | null;
  /** Mean absolute error of the projected margin, in points or goals. */
  margin_error: number | null;
  cases: BacktestCase[];
}

export interface BacktestOptions {
  /** Games before this many results exist are skipped rather than guessed at. */
  minHistory?: number;
  simulations?: number;
  /** Fixed seed keeps a backtest reproducible run to run. */
  seed?: number;
}

/**
 * Replay a league's completed games in order.
 *
 * Every projection is built from a strictly earlier slice of the same list, so
 * no result can influence its own prediction.
 */
export function backtest(
  games: readonly Game[],
  config: SportModelConfig,
  options: BacktestOptions = {},
): BacktestReport {
  const minHistory = options.minHistory ?? config.targetGames * 2;
  const simulations = options.simulations ?? 2_000;

  // Completed games only, oldest first, each with a usable score.
  const played = toResults(games, Number.POSITIVE_INFINITY);
  const byId = new Map<string, Game>();
  for (const game of games) byId.set(game.id, game);

  const chronological = [...games]
    .filter((game) => game.status === 'finished' && game.start_time && game.score)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));

  const cases: BacktestCase[] = [];
  let skipped = 0;

  for (const game of chronological) {
    const kickoff = Date.parse(game.start_time ?? '');
    if (!Number.isFinite(kickoff)) {
      skipped += 1;
      continue;
    }

    // The cut-off. Strictly before kick-off, so this game and every later one
    // are invisible to the ratings.
    const history = played.filter((result) => result.date < kickoff);
    if (history.length < minHistory) {
      skipped += 1;
      continue;
    }

    const ratings = buildRatings(history, config);

    // Projected as if scheduled: the model must not be handed the status or
    // score of a game it is predicting.
    const asIfUpcoming: Game = { ...game, status: 'scheduled', score: undefined };

    const outcome = projectGame(asIfUpcoming, ratings, config, {
      simulations,
      seed: options.seed,
      now: new Date(kickoff),
    });
    if (!outcome) {
      skipped += 1;
      continue;
    }

    const home = game.score?.home ?? 0;
    const away = game.score?.away ?? 0;
    const actual: 'home' | 'away' | 'draw' =
      home > away ? 'home' : away > home ? 'away' : 'draw';

    const { outcome: probabilities } = outcome.projection;
    const predicted: 'home' | 'away' | 'draw' = (() => {
      const entries: [string, number][] = [
        ['home', probabilities.home],
        ['away', probabilities.away],
      ];
      if (probabilities.draw !== undefined) entries.push(['draw', probabilities.draw]);
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0] as 'home' | 'away' | 'draw';
    })();

    cases.push({
      game_id: game.id,
      probability_home: probabilities.home,
      actual,
      predicted,
      correct: predicted === actual,
      // Scored on the home-win probability, which is a well-defined binary
      // event in every sport here, draw or not.
      brier: brierScore(probabilities.home, actual === 'home'),
      log_loss: logLoss(probabilities.home, actual === 'home'),
      expected_margin: outcome.projection.expected_margin,
      actual_margin: home - away,
    });
  }

  if (cases.length === 0) {
    return {
      evaluated: 0,
      skipped,
      accuracy: null,
      brier: null,
      log_loss: null,
      margin_error: null,
      cases: [],
    };
  }

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  return {
    evaluated: cases.length,
    skipped,
    accuracy: Number((cases.filter((c) => c.correct).length / cases.length).toFixed(4)),
    brier: Number(mean(cases.map((c) => c.brier)).toFixed(4)),
    log_loss: Number(mean(cases.map((c) => c.log_loss)).toFixed(4)),
    margin_error: Number(
      mean(cases.map((c) => Math.abs(c.expected_margin - c.actual_margin))).toFixed(3),
    ),
    cases,
  };
}
