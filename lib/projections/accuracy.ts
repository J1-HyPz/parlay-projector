/**
 * The accuracy service.
 *
 * One place computes every accuracy figure in the application, so the homepage
 * widget and the detailed breakdowns can never disagree. Reads only settled
 * local history — no provider is called here. Sports APIs belong in the
 * settlement job, not on the path of a page load.
 *
 * Aggregates are cached and invalidated when a settlement changes something,
 * so the homepage does not re-read and re-scan the whole history every refresh.
 */

import { logger } from '../logger';
import {
  accuracyOf,
  byConfidence,
  byDataQuality,
  calibrationTable,
  groupBy,
  riskOrdering,
  scoreAccuracy,
  scoreAccuracyBySport,
  trend,
} from './metrics';
import type {
  AccuracyBlock,
  CalibrationBand,
  GroupedAccuracy,
  GroupedScoreAccuracy,
  RiskCheck,
  ScoreAccuracy,
  TrendPoint,
} from './metrics';
import { sportLabel } from '../schedule/filters';
import type { SportId } from '../home/types';
import { markFinalPreGame, sampleStrength } from './tracking';
import type { SampleStrength } from './tracking';
import { readParlays, readPredictions } from './store';
import { recentResults } from './results';
import type { ParlayResult } from './results';
import type { ParlayRecord, PredictionRecordV2, SelectionType } from './types';

export type AccuracyWindow = 'today' | '7d' | '30d' | 'all-time';

export function parseWindow(raw: string | null): AccuracyWindow {
  switch ((raw ?? '').toLowerCase()) {
    case 'today':
      return 'today';
    case '7d':
      return '7d';
    case '30d':
      return '30d';
    default:
      return 'all-time';
  }
}

const WINDOW_MS: Record<Exclude<AccuracyWindow, 'all-time'>, number> = {
  today: 24 * 60 * 60_000,
  '7d': 7 * 24 * 60 * 60_000,
  '30d': 30 * 24 * 60 * 60_000,
};

/**
 * Records inside the window.
 *
 * Settled ones are filtered on when they settled, because that is when a
 * prediction became evidence. Open ones are always kept: a game still to be
 * played belongs in the pending count of every window.
 */
function inWindow(
  records: readonly PredictionRecordV2[],
  window: AccuracyWindow,
  now: number,
): PredictionRecordV2[] {
  if (window === 'all-time') return [...records];
  const span = WINDOW_MS[window];

  return records.filter((record) => {
    if (!record.settled_at) return record.status !== 'void';
    const settled = Date.parse(record.settled_at);
    return Number.isFinite(settled) && now - settled <= span;
  });
}

/**
 * Predictions that count toward the headline figure.
 *
 * Only the official pre-game prediction for each fixture, and only ones that
 * were published as part of a generated line — that is, actually shown to a
 * reader. Counting every candidate the model produced internally would let
 * thousands of unsurfaced projections drown out the ones that mattered.
 *
 * Documented in docs/prediction-accuracy.md; this is the single definition.
 */
export function headlinePredictions(
  records: readonly PredictionRecordV2[],
): PredictionRecordV2[] {
  return records.filter((record) => record.final_pre_game && record.parlay_id !== null);
}

export interface ParlaySuccess {
  key: string;
  won: number;
  lost: number;
  settled: number;
  rate: number | null;
  /** Mean combined probability the optimiser claimed for these lines. */
  claimed: number | null;
  sample: SampleStrength;
}

/**
 * How often complete lines came in, by risk level.
 *
 * Reported separately from prediction accuracy and never mixed with it: a
 * three-leg line losing one leg is a lost line but two correct predictions.
 *
 * `claimed` beside `rate` is what makes the optimiser checkable — lines it
 * estimated at 40% should come in around 40% of the time.
 */
export function parlaySuccess(parlays: readonly ParlayRecord[]): ParlaySuccess[] {
  const groups = new Map<string, ParlayRecord[]>();
  for (const parlay of parlays) {
    const list = groups.get(parlay.risk);
    if (list) list.push(parlay);
    else groups.set(parlay.risk, [parlay]);
  }

  const summarise = (key: string, list: readonly ParlayRecord[]): ParlaySuccess => {
    const settledLines = list.filter((p) => p.status === 'won' || p.status === 'lost');
    const won = settledLines.filter((p) => p.status === 'won').length;

    return {
      key,
      won,
      lost: settledLines.length - won,
      settled: settledLines.length,
      // A far smaller sample than individual legs, so the bar is lower — but
      // the count travels with it either way.
      rate: settledLines.length >= 10 ? Number((won / settledLines.length).toFixed(4)) : null,
      claimed:
        settledLines.length > 0
          ? Number(
              (
                settledLines.reduce((sum, p) => sum + p.combined_probability, 0) /
                settledLines.length
              ).toFixed(4),
            )
          : null,
      sample: sampleStrength(settledLines.length),
    };
  };

  const all: ParlaySuccess[] = [summarise('all', parlays)];
  for (const risk of ['low', 'medium', 'high']) {
    all.push(summarise(risk, groups.get(risk) ?? []));
  }
  return all;
}

export interface AccuracyReport {
  window: AccuracyWindow;
  /** Headline: official pre-game predictions that were surfaced to a reader. */
  overall: AccuracyBlock;
  /** Every stored prediction, including candidates never shown. For research. */
  all_predictions: AccuracyBlock;
  by_sport: GroupedAccuracy[];
  by_market: GroupedAccuracy[];
  /**
   * Sport crossed with market type, e.g. "MLB run line".
   *
   * The breakdown that can eventually change what gets generated: a model may
   * read totals well in one sport and handicaps badly in another, and the
   * per-sport and per-market figures each average that away. Small groups are
   * kept with their sample size attached rather than dropped, so thin coverage
   * is visible instead of flattering the rest.
   */
  by_sport_market: GroupedAccuracy[];
  by_risk: GroupedAccuracy[];
  by_model: GroupedAccuracy[];
  by_confidence: GroupedAccuracy[];
  by_data_quality: GroupedAccuracy[];
  calibration: CalibrationBand[];
  /**
   * Score error across every sport at once.
   *
   * A coverage count rather than a quantity: it averages points with runs and
   * goals, so the figure is in no unit. `score_by_sport` is the one to read.
   */
  score: ScoreAccuracy;
  /** Score error per sport, where the numbers carry a unit and mean something. */
  score_by_sport: GroupedScoreAccuracy[];
  trend: TrendPoint[];
  parlays: ParlaySuccess[];
  /** Flags a risk system that is not behaving as advertised. */
  risk_ordering: RiskCheck;
  counts: {
    stored: number;
    open: number;
    parlays: number;
  };
  updated_at: string;
}

/*
 * Keyed by the union, so a new market cannot be added without a label.
 *
 * This was `Record<string, string>` with a `?? key` fallback, and the two
 * motorsport markets were missing — every F1 prediction would have been grouped
 * under its raw key. The fallback stays for a label read from an older stored
 * record, but a market the application knows about must be named here.
 */
const MARKET_LABELS: Record<SelectionType, string> = {
  winner: 'Winner',
  double_chance: 'Double chance',
  spread: 'Spread',
  total: 'Total',
  team_total: 'Team total',
  player_performance: 'Player performance',
  // Motorsport. Absent until now, so every F1 prediction would have been
  // grouped under the raw key the moment one settled.
  finish_position: 'Finishing position',
  head_to_head: 'Head to head',
};

/** Label for a market, falling back to the raw key for an unknown one. */
function marketName(key: string): string {
  return MARKET_LABELS[key as SelectionType] ?? key;
}

/**
 * Display name for a sport, shared with the rest of the application.
 *
 * These read as headings in the breakdowns, and `key.toUpperCase()` produced
 * "FOOTBALL" beside "MLB" — one an initialism, the other just shouting.
 */
function sportName(key: string): string {
  return sportLabel(key as SportId);
}

const RISK_LABELS: Record<string, string> = {
  low: 'Low risk',
  medium: 'Medium risk',
  high: 'High risk',
};

function build(
  stored: readonly PredictionRecordV2[],
  parlays: readonly ParlayRecord[],
  window: AccuracyWindow,
  now: number,
): AccuracyReport {
  /*
   * Mark the official pre-game prediction before filtering.
   *
   * The flag is frozen into the file when a game starts, but a prediction that
   * has not kicked off yet does not have it — and would then be invisible here,
   * making the pending count read zero while the tracker held eighteen. The
   * marking is provisional until kick-off (a later projection can still
   * supersede it) and uses stored timestamps only, so it cannot see a result.
   */
  const records = markFinalPreGame(stored);

  const scoped = inWindow(records, window, now);
  const headline = headlinePredictions(scoped);

  const scopedParlays: ParlayRecord[] =
    window === 'all-time'
      ? [...parlays]
      : parlays.filter((parlay) => {
          if (!parlay.settled_at) return false;
          const settled = Date.parse(parlay.settled_at);
          return (
            Number.isFinite(settled) &&
            now - settled <= WINDOW_MS[window as Exclude<AccuracyWindow, 'all-time'>]
          );
        });

  const byRisk = groupBy(
    headline,
    (record) => record.risk,
    (key) => RISK_LABELS[key] ?? key,
  );

  return {
    window,
    overall: accuracyOf(headline),
    all_predictions: accuracyOf(scoped),
    by_sport: groupBy(headline, (record) => record.sport, sportName),
    by_market: groupBy(
      headline,
      (record) => record.selection_type,
      marketName,
    ),
    by_sport_market: groupBy(
      headline,
      (record) => `${record.sport}:${record.selection_type}`,
      (key) => {
        const [sport, market] = key.split(':');
        return `${sportName(sport)} ${marketName(market).toLowerCase()}`;
      },
    ),
    by_risk: byRisk,
    by_model: groupBy(headline, (record) => record.model_version),
    by_confidence: byConfidence(headline),
    by_data_quality: byDataQuality(headline),
    calibration: calibrationTable(headline),
    score: scoreAccuracy(headline),
    score_by_sport: scoreAccuracyBySport(headline, sportName),
    trend: trend(headline, now),
    parlays: parlaySuccess(scopedParlays),
    risk_ordering: riskOrdering(byRisk),
    counts: {
      stored: stored.length,
      open: records.filter(
        (record) =>
          record.status === 'pending' ||
          record.status === 'live' ||
          record.status === 'unsettled',
      ).length,
      parlays: parlays.length,
    },
    updated_at: new Date(now).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Caching
// ---------------------------------------------------------------------------

interface CacheEntry {
  report: AccuracyReport;
  computedAt: number;
}

const cache = new Map<AccuracyWindow, CacheEntry>();
/** Recomputed at most this often; invalidated immediately on a settlement. */
const CACHE_TTL_MS = 60_000;

/**
 * Drop the cached aggregates.
 *
 * Called by the settlement job when anything actually changed, so a settled
 * prediction appears in the figures on the next request rather than up to a
 * minute later.
 */
export function invalidateAccuracy(): void {
  cache.clear();
}

/** The full report for a window. Reads local history only. */
export async function getAccuracyReport(
  window: AccuracyWindow = 'all-time',
): Promise<AccuracyReport> {
  const now = Date.now();
  const cached = cache.get(window);
  if (cached && now - cached.computedAt < CACHE_TTL_MS) return cached.report;

  const [records, parlays] = await Promise.all([readPredictions(), readParlays()]);
  const report = build(records, parlays, window, now);

  cache.set(window, { report, computedAt: now });
  logger.info('accuracy_recalculated', {
    window,
    settled: report.overall.settled,
    accuracy: report.overall.accuracy,
  });

  return report;
}

/**
 * Recently settled predictions, newest first.
 *
 * For a results feed. Returns what happened alongside what was predicted, so a
 * reader can see the model being checked rather than only its scoreboard.
 */
/**
 * Recently settled lines, ready for display.
 *
 * Reads the two stores the settlement job already maintains and joins them.
 * No provider is called and nothing is recomputed — a homepage load must not
 * become a round of network requests, and the verdicts were decided against
 * rules frozen at publication.
 */
export async function recentParlayResults(limit = 10): Promise<ParlayResult[]> {
  const [parlays, predictions] = await Promise.all([readParlays(), readPredictions()]);
  return recentResults(parlays, predictions, limit);
}

export async function recentSettled(limit = 20): Promise<PredictionRecordV2[]> {
  const records = await readPredictions();

  return records
    .filter((record) => record.settled_at !== null && record.final_pre_game)
    .sort((a, b) => (b.settled_at ?? '').localeCompare(a.settled_at ?? ''))
    .slice(0, Math.max(1, Math.min(limit, 100)));
}
