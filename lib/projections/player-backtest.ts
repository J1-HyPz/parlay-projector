/**
 * Backtesting a player market.
 *
 * Separate from `backtest.ts` and `bout-backtest.ts` because it scores a third
 * kind of claim. The team harness reports margin and total error, because a
 * team projection asserts a scoreline. The bout harness reports one probability,
 * because a fight asserts a winner. This one asserts *a threshold*: how often
 * this person passes this number — so the honest questions are whether the
 * probability is calibrated at that threshold, and whether it beats simply
 * using the player's own average.
 *
 * **Everything is scored against a line, and the lines are fixed in advance.**
 * No historical bookmaker lines exist here, so a ladder is used instead —
 * chosen once, before any result was looked at, to cover the range a book
 * actually quotes. Picking lines after seeing the data, or picking them from the
 * model's own median, would be fitting the test to the answer.
 *
 * **The baseline is the thing to beat, not a formality.** A model that cannot
 * outperform "this pitcher averages six strikeouts, call it six" has not earned
 * the recency weighting, the Jeffreys floor or any of the rest of it. Both are
 * computed on identical starts at identical lines in one pass, so the comparison
 * cannot drift.
 *
 * Pure: appearances in, metrics out. Look-ahead safety is structural — each
 * appearance is rated from the same list filtered to strictly earlier dates, so
 * there is no path by which a result reaches its own prediction.
 */

import { brierScore, logLoss } from './math.ts';
import { buildPlayerRatings, probabilityOver } from './player-model.ts';
import type { PlayerStatConfig } from './player-model.ts';
import type { PlayerGame } from '../players/history.ts';

/**
 * The lines every appearance is scored at.
 *
 * Fixed before any result was read. Strikeout markets are quoted between about
 * four and eight, so these cover it; a line far outside a pitcher's range is
 * dropped per appearance rather than scored as a near-certainty, which would
 * flatter both models equally and tell us nothing.
 */
export const DEFAULT_LINES: readonly number[] = [4.5, 5.5, 6.5, 7.5];

/** How far a line may sit from the model's own mean and still be scored. */
const LINE_WINDOW = 3;

export interface ScoredLine {
  gameId: string;
  athleteId: string;
  line: number;
  /** What the player actually recorded. */
  actual: number;
  went_over: boolean;
  /** The model's probability of going over. */
  model: number;
  /** The naive baseline's probability of going over. */
  baseline: number;
  /** Appearances the estimate rested on. */
  games: number;
}

export interface CalibrationBand {
  from: number;
  to: number;
  count: number;
  /** Mean probability claimed in this bucket. */
  predicted: number;
  /** Share that actually happened. */
  actual: number;
}

export interface Scored {
  brier: number | null;
  log_loss: number | null;
  /** Mean claimed probability minus the share that happened. */
  bias: number | null;
  /** How often the side the estimate favoured came in. */
  accuracy: number | null;
  bands: CalibrationBand[];
}

export interface PlayerBacktestReport {
  /** Appearances that produced an estimate. */
  evaluated: number;
  /** Appearances skipped for too short a record — reported, never hidden. */
  skipped: number;
  /** Scored (appearance, line) pairs. Larger than `evaluated`; see the note. */
  pairs: number;
  model: Scored;
  baseline: Scored;
  /**
   * Observed variance over mean for this statistic, within player.
   *
   * The question no constant can answer, asked here because a Poisson process
   * fixes the ratio at one and baseball's own scoring measured 2.27. Above one
   * by any margin means the count is overdispersed and the distribution, not the
   * rate, is what needs changing.
   */
  dispersion: number | null;
  lines: readonly number[];
  cases: ScoredLine[];
}

const BAND_EDGES = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0001];

const mean = (values: readonly number[]) =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Calibration folded onto whichever side the estimate favoured.
 *
 * The same correction `bout-backtest.ts` makes, for the same reason: bucketing
 * on "probability of going over" would put every under-leaning estimate below
 * 0.5 and smear the bands toward the middle, so a badly calibrated model would
 * look fine. Folding onto the favoured side tests the claim actually being made.
 */
function bands(probabilities: readonly number[], happened: readonly boolean[]): CalibrationBand[] {
  const out: CalibrationBand[] = [];

  for (let i = 0; i < BAND_EDGES.length - 1; i += 1) {
    const from = BAND_EDGES[i];
    const to = BAND_EDGES[i + 1];

    const picked: { claimed: number; hit: boolean }[] = [];
    probabilities.forEach((probability, index) => {
      const favoured = Math.max(probability, 1 - probability);
      if (favoured < from || favoured >= to) return;
      const wentTheFavouredWay = probability >= 0.5 ? happened[index] : !happened[index];
      picked.push({ claimed: favoured, hit: wentTheFavouredWay });
    });

    if (picked.length === 0) continue;
    out.push({
      from,
      to: Math.min(to, 1),
      count: picked.length,
      predicted: Number((mean(picked.map((p) => p.claimed)) ?? 0).toFixed(4)),
      actual: Number((picked.filter((p) => p.hit).length / picked.length).toFixed(4)),
    });
  }

  return out;
}

function score(probabilities: readonly number[], happened: readonly boolean[]): Scored {
  if (probabilities.length === 0) {
    return { brier: null, log_loss: null, bias: null, accuracy: null, bands: [] };
  }

  const favoured = probabilities.map((p) => Math.max(p, 1 - p));
  const hits = probabilities.map((p, i) => (p >= 0.5 ? happened[i] : !happened[i]));

  return {
    brier: Number(
      (mean(probabilities.map((p, i) => brierScore(p, happened[i]))) ?? 0).toFixed(4),
    ),
    log_loss: Number((mean(probabilities.map((p, i) => logLoss(p, happened[i]))) ?? 0).toFixed(4)),
    bias: Number(
      ((mean(favoured) ?? 0) - (mean(hits.map((h) => (h ? 1 : 0))) ?? 0)).toFixed(4),
    ),
    accuracy: Number((mean(hits.map((h) => (h ? 1 : 0))) ?? 0).toFixed(4)),
    bands: bands(probabilities, happened),
  };
}

/**
 * Variance over mean for one statistic, measured within player.
 *
 * Within player rather than pooled, and the distinction is the whole point.
 * Pooling would mix two different things — how much one pitcher varies start to
 * start, and how much pitchers differ from each other — and the model already
 * reproduces the second through its own per-player rates. Baseball's scoring
 * dispersion had exactly this trap, and taking the raw pooled figure there
 * would have double-counted it.
 */
export function measureStatDispersion(
  appearances: readonly PlayerGame[],
  config: PlayerStatConfig,
): number | null {
  const byPlayer = new Map<string, number[]>();
  for (const appearance of appearances) {
    const value = config.from(appearance.stats);
    if (value === null) continue;
    const list = byPlayer.get(appearance.athleteId);
    if (list) list.push(value);
    else byPlayer.set(appearance.athleteId, [value]);
  }

  let weightedVariance = 0;
  let weightedMeanValue = 0;
  let weight = 0;

  for (const values of byPlayer.values()) {
    // A player needs enough starts for a within-player variance to mean
    // anything; five is where one outlier stops dominating it.
    if (values.length < 5) continue;
    const average = values.reduce((a, b) => a + b, 0) / values.length;
    if (average <= 0) continue;

    const variance =
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);

    weightedVariance += variance * values.length;
    weightedMeanValue += average * values.length;
    weight += values.length;
  }

  if (weight === 0 || weightedMeanValue <= 0) return null;
  return Number((weightedVariance / weightedMeanValue).toFixed(4));
}

export interface PlayerBacktestOptions {
  lines?: readonly number[];
  /** Overrides the statistic's own minimum, for a sweep. */
  minGames?: number;
  /** Overrides the statistic's dispersion, for fitting one. */
  dispersion?: number;
}

/**
 * Replay a statistic's appearances in order.
 *
 * Every estimate is built from the same list filtered to strictly earlier
 * dates, so a result cannot influence its own prediction. Both the model and
 * the baseline are computed from that identical slice — the only difference
 * between them is how they turn it into a mean.
 */
export function backtestPlayerStat(
  appearances: readonly PlayerGame[],
  config: PlayerStatConfig,
  options: PlayerBacktestOptions = {},
): PlayerBacktestReport {
  const lines = options.lines ?? DEFAULT_LINES;
  const minGames = options.minGames ?? config.minGames;
  const effective: PlayerStatConfig = {
    ...config,
    minGames,
    ...(options.dispersion === undefined ? {} : { dispersion: options.dispersion }),
  };

  const byPlayer = new Map<string, PlayerGame[]>();
  for (const appearance of appearances) {
    const list = byPlayer.get(appearance.athleteId);
    if (list) list.push(appearance);
    else byPlayer.set(appearance.athleteId, [appearance]);
  }

  const cases: ScoredLine[] = [];
  let evaluated = 0;
  let skipped = 0;

  for (const [athleteId, own] of byPlayer) {
    const chronological = [...own].sort((a, b) => a.date - b.date);

    for (const appearance of chronological) {
      const actual = config.from(appearance.stats);
      if (actual === null) continue;

      // Strictly earlier. The whole value of this rests on this one line.
      const prior = chronological.filter((other) => other.date < appearance.date);
      if (prior.length < minGames) {
        skipped += 1;
        continue;
      }

      const ratings = buildPlayerRatings(prior, [effective]);
      const rating = ratings.players.get(athleteId)?.stats.get(config.key);
      if (!rating) {
        skipped += 1;
        continue;
      }

      /*
       * The baseline: the player's plain average, same distribution.
       *
       * No recency weighting and no spread floor — those are the model's
       * claims, and this is what they have to beat. Built through the same
       * `probabilityOver`, so the two differ in their mean and in nothing else.
       */
      const values = prior
        .map((other) => config.from(other.stats))
        .filter((value): value is number => value !== null);
      const flat = values.reduce((a, b) => a + b, 0) / values.length;
      const flatRating = { ...rating, mean: flat };

      evaluated += 1;

      for (const line of lines) {
        // A line far outside this player's range is a near-certainty for both
        // models and would only dilute the comparison.
        if (Math.abs(line - rating.mean) > LINE_WINDOW) continue;

        cases.push({
          gameId: appearance.gameId,
          athleteId,
          line,
          actual,
          went_over: actual > line,
          model: probabilityOver(rating, effective, line),
          baseline: probabilityOver(flatRating, effective, line),
          games: rating.games,
        });
      }
    }
  }

  const happened = cases.map((entry) => entry.went_over);

  return {
    evaluated,
    skipped,
    pairs: cases.length,
    model: score(
      cases.map((entry) => entry.model),
      happened,
    ),
    baseline: score(
      cases.map((entry) => entry.baseline),
      happened,
    ),
    dispersion: measureStatDispersion(appearances, config),
    lines,
    cases,
  };
}
