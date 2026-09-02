/**
 * The prediction lifecycle.
 *
 *   pending ──► live ──► won / lost / push / void
 *                   └──► unsettled ──► (retry) ──► won / lost / void
 *
 * Pure, so every rule that decides whether a prediction counts is testable
 * without a filesystem or a provider. These rules are the whole basis of the
 * accuracy figures, and they are deliberately conservative: where the evidence
 * does not settle something, the answer is `unsettled` or `void`, never a
 * guess in either direction.
 */

import type {
  ActualOutcome,
  ParlayRecord,
  ParlayStatus,
  PredictionRecordV2,
  PredictionStatus,
} from './types.ts';
import { COUNTED_STATUSES, OPEN_STATUSES, TERMINAL_STATUSES } from './types.ts';

// ---------------------------------------------------------------------------
// Status predicates
// ---------------------------------------------------------------------------

/** Contributes to accuracy: the prediction was tested and has an answer. */
export function isCounted(record: PredictionRecordV2): boolean {
  return (COUNTED_STATUSES as readonly string[]).includes(record.status);
}

/** Nothing further will happen to this prediction. */
export function isTerminal(status: PredictionStatus): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/** The settlement queue still has work to do. */
export function isOpen(status: PredictionStatus): boolean {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------
// Retry schedule
// ---------------------------------------------------------------------------

/**
 * Backoff for a game that finished without the statistic settlement needs.
 *
 * Providers routinely mark a game final before detailed statistics land. The
 * gaps widen so a slow feed is not hammered, and stop rather than retrying for
 * ever — see `FINALISATION_HOURS`.
 */
export const RETRY_DELAYS_MS: readonly number[] = [
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
];

/**
 * How long after kick-off a prediction may still change.
 *
 * Two jobs. It bounds retries for a statistic that never arrives, and it is the
 * window in which a provider correction can still revise a settled result. Past
 * it, history stops moving.
 */
export const FINALISATION_HOURS = 24;

/** When the next attempt should run; null once the retries are exhausted. */
export function nextAttemptAt(attempts: number, now: number): string | null {
  if (attempts >= RETRY_DELAYS_MS.length) return null;
  return new Date(now + RETRY_DELAYS_MS[attempts]).toISOString();
}

/** Whether a record is due another settlement attempt. */
export function isDue(record: PredictionRecordV2, now: number): boolean {
  if (!isOpen(record.status)) return false;
  if (!record.next_attempt_at) return true;
  const due = Date.parse(record.next_attempt_at);
  return !Number.isFinite(due) || due <= now;
}

/** Hours since kick-off, or null when the start time is unknown. */
export function hoursSinceStart(record: PredictionRecordV2, now: number): number | null {
  if (!record.game_start) return null;
  const start = Date.parse(record.game_start);
  if (!Number.isFinite(start)) return null;
  return (now - start) / 3_600_000;
}

/**
 * Past the finalisation window with no result.
 *
 * Voided rather than left open for ever, and never guessed at: a statistic that
 * never arrived is not evidence the prediction was wrong.
 */
export function isAbandoned(record: PredictionRecordV2, now: number): boolean {
  if (!isOpen(record.status)) return false;
  const hours = hoursSinceStart(record, now);
  return hours !== null && hours > FINALISATION_HOURS;
}

/** Whether a settled record is still inside the correction window. */
export function isCorrectable(record: PredictionRecordV2, now: number): boolean {
  if (!isTerminal(record.status)) return false;
  const hours = hoursSinceStart(record, now);
  return hours !== null && hours <= FINALISATION_HOURS;
}

// ---------------------------------------------------------------------------
// The settlement queue
// ---------------------------------------------------------------------------

export interface QueueEntry {
  record: PredictionRecordV2;
  /** Why it is in the queue, for the log. */
  reason: 'pending' | 'live' | 'retry' | 'correction';
}

/**
 * Predictions worth looking at right now.
 *
 * Deliberately narrow. Rescanning every prediction ever made would grow without
 * bound; only fixtures that have started, are due a retry, or are inside the
 * correction window are examined.
 */
export function settlementQueue(
  records: readonly PredictionRecordV2[],
  now: number,
): QueueEntry[] {
  const queue: QueueEntry[] = [];

  for (const record of records) {
    if (isOpen(record.status)) {
      const hours = hoursSinceStart(record, now);
      // A fixture that has not kicked off yet has nothing to settle.
      if (hours !== null && hours < 0) continue;
      if (!isDue(record, now)) continue;

      queue.push({
        record,
        reason:
          record.status === 'live' ? 'live' : record.attempts > 0 ? 'retry' : 'pending',
      });
      continue;
    }

    // Settled, but a provider may still correct the score behind it.
    if (isCorrectable(record, now)) queue.push({ record, reason: 'correction' });
  }

  return queue;
}

/** Distinct games the queue needs results for. */
export function queuedGameIds(queue: readonly QueueEntry[]): string[] {
  return [...new Set(queue.map((entry) => entry.record.game_id))];
}

// ---------------------------------------------------------------------------
// Final pre-game prediction
// ---------------------------------------------------------------------------

/**
 * Which published prediction is the official one for a fixture.
 *
 * A fixture can be projected several times as kick-off approaches, and every
 * version is kept for research. Counting them all would weight a
 * heavily-refreshed game more than a quiet one, so exactly one per
 * (game, selection type, model version) is marked as the headline prediction:
 * the last one published *before* the game started.
 *
 * A prediction created after kick-off is never eligible — that is the
 * look-ahead guard, and it is enforced here rather than trusted to callers.
 */
export function markFinalPreGame(
  records: readonly PredictionRecordV2[],
): PredictionRecordV2[] {
  const latest = new Map<string, PredictionRecordV2>();

  for (const record of records) {
    if (!record.game_start) continue;

    const start = Date.parse(record.game_start);
    const created = Date.parse(record.created_at);
    if (!Number.isFinite(start) || !Number.isFinite(created)) continue;
    // Published after the whistle: not a pre-game prediction at all.
    if (created >= start) continue;

    const key = `${record.game_id}|${record.selection_type}|${record.model_version}`;
    const current = latest.get(key);
    if (!current || Date.parse(current.created_at) < created) latest.set(key, record);
  }

  const chosen = new Set([...latest.values()].map((record) => record.id));

  return records.map((record) =>
    record.final_pre_game === chosen.has(record.id)
      ? record
      : { ...record, final_pre_game: chosen.has(record.id) },
  );
}

// ---------------------------------------------------------------------------
// Score accuracy
// ---------------------------------------------------------------------------

/** The real scoreline, in the shape stored alongside the projection. */
export function actualOutcome(home: number, away: number): ActualOutcome {
  return { home_score: home, away_score: away, margin: home - away, total: home + away };
}

export interface ScoreError {
  home: number;
  away: number;
  margin: number;
  total: number;
}

/** Absolute error between what was projected and what happened. */
export function scoreError(record: PredictionRecordV2): ScoreError | null {
  const { projected, actual } = record;
  if (!projected || !actual) return null;

  return {
    home: Math.abs(projected.home_score - actual.home_score),
    away: Math.abs(projected.away_score - actual.away_score),
    margin: Math.abs(projected.margin - actual.margin),
    total: Math.abs(projected.total - actual.total),
  };
}

// ---------------------------------------------------------------------------
// Parlays
// ---------------------------------------------------------------------------

/**
 * Overall state of a line, from its legs.
 *
 * A line is won only when every leg that counts came in. One lost leg loses the
 * line immediately, even while other legs are still running — but those legs
 * keep settling, because they are still evidence about the model.
 *
 * Void legs are ignored rather than failing the line: a fixture that was never
 * played says nothing about the selection.
 */
export function parlayStatus(legs: readonly PredictionRecordV2[]): ParlayStatus {
  if (legs.length === 0) return 'void';

  const counted = legs.filter((leg) => leg.status !== 'void' && leg.status !== 'push');
  // Every leg voided or pushed: nothing was tested.
  if (counted.length === 0) return 'void';

  if (counted.some((leg) => leg.status === 'lost')) return 'lost';
  if (counted.every((leg) => leg.status === 'won')) return 'won';
  if (counted.some((leg) => leg.status === 'live')) return 'live';
  return 'pending';
}

export interface ParlayProgress {
  won: number;
  lost: number;
  live: number;
  pending: number;
  voided: number;
  /** Legs that have an answer, for "2 of 3" style reporting. */
  settled: number;
  total: number;
}

/** Leg counts, for the progress line on a generated parlay. */
export function parlayProgress(legs: readonly PredictionRecordV2[]): ParlayProgress {
  const count = (status: PredictionStatus) =>
    legs.filter((leg) => leg.status === status).length;

  const voided = count('void') + count('push');
  const won = count('won');
  const lost = count('lost');

  return {
    won,
    lost,
    live: count('live'),
    pending: count('pending') + count('unsettled'),
    voided,
    settled: won + lost,
    total: legs.length,
  };
}

/** Fold leg statuses into a parlay record. */
export function applyParlayStatus(
  parlay: ParlayRecord,
  legs: readonly PredictionRecordV2[],
  now: string,
): ParlayRecord {
  const status = parlayStatus(legs);
  if (status === parlay.status) return parlay;

  const settled = status === 'won' || status === 'lost' || status === 'void';
  return { ...parlay, status, settled_at: settled ? (parlay.settled_at ?? now) : null };
}

// ---------------------------------------------------------------------------
// Sample size
// ---------------------------------------------------------------------------

export type SampleStrength = 'small' | 'developing' | 'meaningful';

/** Configurable thresholds; the defaults are starting points, not findings. */
export const SAMPLE_THRESHOLDS = { developing: 20, meaningful: 100 } as const;

/**
 * How much weight a sample deserves.
 *
 * Reported alongside every percentage so a 2-for-2 record is never presented as
 * proven. A rate without its sample size is easy to misread, and this is what
 * stops that happening.
 */
export function sampleStrength(n: number): SampleStrength {
  if (n >= SAMPLE_THRESHOLDS.meaningful) return 'meaningful';
  if (n >= SAMPLE_THRESHOLDS.developing) return 'developing';
  return 'small';
}
