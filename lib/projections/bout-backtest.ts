/**
 * Backtesting a fight model.
 *
 * Separate from `backtest.ts` because it scores a different kind of claim.
 * That harness reports margin error and total error alongside Brier, because a
 * team projection asserts a scoreline. This one asserts a single probability
 * and nothing else, so the only honest questions are: is it right more often
 * than not, is it *calibrated*, and does it know when it does not know.
 *
 * The look-ahead rule is the same and is the whole value: for each fight the
 * ratings are rebuilt from only the fights that finished before it started.
 * `toBoutResults(games, kickoff)` enforces that at the source, and this module
 * walks forward in time so the cut-off is always the fight's own start.
 *
 * Pure: fights in, metrics out, no provider and no file.
 */

import { brierScore, logLoss } from './math.ts';
import { BOUT_CONFIG, buildBoutRatings, projectBout, toBoutResults } from './bout-model.ts';
import type { BoutModelConfig } from './bout-model.ts';
import type { Game } from '../home/types';

export interface BoutCase {
  game_id: string;
  /** Probability the model gave the first-listed fighter. */
  probability_home: number;
  actual: 'home' | 'away';
  correct: boolean;
  brier: number;
  log_loss: number;
  data_quality: number;
  division: string;
}

export interface BoutCalibrationBand {
  /** Lower edge of the predicted-probability bucket, e.g. 0.6. */
  from: number;
  to: number;
  count: number;
  /** Mean probability the model gave in this bucket. */
  predicted: number;
  /** Share that actually happened. */
  actual: number;
}

export interface BoutBacktestReport {
  /** Fights that produced a projection. */
  evaluated: number;
  /**
   * Fights skipped for insufficient record.
   *
   * Reported rather than hidden, and expected to be large: §4.8.a step 6 says
   * a card routinely contains fighters this model cannot say anything about,
   * and a harness that quietly dropped them would make the model look like it
   * covered the sport.
   */
  skipped: number;
  accuracy: number | null;
  brier: number | null;
  log_loss: number | null;
  /**
   * Mean predicted probability minus the share that happened.
   *
   * Zero is calibrated. Positive means the model is over-confident in the
   * fighters it favours.
   */
  bias: number | null;
  bands: BoutCalibrationBand[];
  cases: BoutCase[];
}

const BAND_EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];

/**
 * Calibration, scored on the *favourite* rather than on the first-listed
 * fighter.
 *
 * A fight has no home side, so "probability the home team wins" is a
 * meaningless axis to bucket on — the card's running order would smear every
 * band toward 0.5 and a badly calibrated model would look perfect. Folding
 * each fight onto whichever fighter the model favoured is the version that
 * actually tests the claim.
 */
export function calibrationBands(cases: readonly BoutCase[]): BoutCalibrationBand[] {
  const bands: BoutCalibrationBand[] = [];

  for (let i = 0; i < BAND_EDGES.length - 1; i += 1) {
    const from = BAND_EDGES[i];
    const to = BAND_EDGES[i + 1];
    const inBand = cases.filter((c) => {
      const favourite = Math.max(c.probability_home, 1 - c.probability_home);
      return favourite >= from && favourite < to;
    });
    if (inBand.length === 0) continue;

    const predicted =
      inBand.reduce((sum, c) => sum + Math.max(c.probability_home, 1 - c.probability_home), 0) /
      inBand.length;
    const hit = inBand.filter((c) => {
      const favoured = c.probability_home >= 0.5 ? 'home' : 'away';
      return c.actual === favoured;
    }).length;

    bands.push({
      from,
      to: Math.min(to, 1),
      count: inBand.length,
      predicted: Number(predicted.toFixed(4)),
      actual: Number((hit / inBand.length).toFixed(4)),
    });
  }

  return bands;
}

export interface BoutBacktestOptions {
  /** Fights before this many results exist are skipped rather than guessed at. */
  minHistory?: number;
  config?: BoutModelConfig;
}

/** Replay a competition's completed fights in order. */
export function backtestBouts(
  games: readonly Game[],
  options: BoutBacktestOptions = {},
): BoutBacktestReport {
  const config = options.config ?? BOUT_CONFIG;
  const minHistory = options.minHistory ?? 200;

  const played = toBoutResults(games, Number.POSITIVE_INFINITY);

  const chronological = [...games]
    .filter((game) => game.status === 'finished' && game.start_time && game.winner)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));

  const cases: BoutCase[] = [];
  let skipped = 0;

  for (const game of chronological) {
    const kickoff = Date.parse(game.start_time ?? '');
    if (!Number.isFinite(kickoff)) {
      skipped += 1;
      continue;
    }

    // Both ends of the window, exactly as the team harness learned to do: the
    // upper bound is the look-ahead rule, the lower is fidelity to what the
    // live model would have been given.
    const windowStart = kickoff - config.historyDays * 86_400_000;
    const history = played.filter((r) => r.date < kickoff && r.date >= windowStart);
    if (history.length < minHistory) {
      skipped += 1;
      continue;
    }

    const ratings = buildBoutRatings(history, config);
    const projection = projectBout(
      game.home_team?.id ?? '',
      game.away_team?.id ?? '',
      game.division,
      ratings,
      config,
    );
    if (!projection) {
      skipped += 1;
      continue;
    }

    const actual: 'home' | 'away' = game.winner === 'home' ? 'home' : 'away';
    const favoured = projection.home >= 0.5 ? 'home' : 'away';

    cases.push({
      game_id: game.id,
      probability_home: projection.home,
      actual,
      correct: favoured === actual,
      brier: brierScore(projection.home, actual === 'home'),
      log_loss: logLoss(projection.home, actual === 'home'),
      data_quality: projection.dataQuality,
      division: game.division ?? 'unknown',
    });
  }

  if (cases.length === 0) {
    return {
      evaluated: 0,
      skipped,
      accuracy: null,
      brier: null,
      log_loss: null,
      bias: null,
      bands: [],
      cases: [],
    };
  }

  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const favouriteProbability = cases.map((c) => Math.max(c.probability_home, 1 - c.probability_home));
  const favouriteHit = cases.map((c) => (c.correct ? 1 : 0));

  return {
    evaluated: cases.length,
    skipped,
    accuracy: Number((mean(favouriteHit)).toFixed(4)),
    brier: Number(mean(cases.map((c) => c.brier)).toFixed(4)),
    log_loss: Number(mean(cases.map((c) => c.log_loss)).toFixed(4)),
    bias: Number((mean(favouriteProbability) - mean(favouriteHit)).toFixed(4)),
    bands: calibrationBands(cases),
    cases,
  };
}
