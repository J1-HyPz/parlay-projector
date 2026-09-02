/**
 * Prediction persistence and settlement.
 *
 * Stored as JSON under DATA_DIR, alongside the existing prediction history and
 * the notification state — the same pattern, and the same reason: DATA_DIR is
 * the mounted TrueNAS dataset, and a container filesystem is disposable.
 * Prediction history is the one thing in this application that must survive a
 * redeploy, because it is the only evidence the model works.
 *
 * No database server is introduced. A file behind a small interface is enough
 * for one household's prediction history, and moving to Postgres later means
 * adding an implementation rather than rewriting the callers.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config';
import { logger } from '../logger';
import { PREDICTIONS_FILENAME, awaitingSettlement, parsePredictions } from './store-parse';
import { describeResult, settle } from './settlement';
import type { FinalScore } from './settlement';
import { MODEL_VERSION } from './types';
import type { PredictionRecordV2, RiskLevel, Selection } from './types';

export { PREDICTIONS_FILENAME, parsePredictions };

export function predictionsPath(): string {
  return path.join(DATA_DIR, PREDICTIONS_FILENAME);
}

/** Empty on any failure: no history is a truthful answer, a crash is not. */
export async function readPredictions(): Promise<PredictionRecordV2[]> {
  try {
    return parsePredictions(JSON.parse(await readFile(predictionsPath(), 'utf-8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn('predictions_unreadable', { reason: code ?? 'parse_error' });
    }
    return [];
  }
}

/**
 * Write the store, reporting failure rather than throwing.
 *
 * Publishing is a *side effect* of generating a line. If DATA_DIR is not
 * writable -- an unmounted volume, or dataset permissions that exclude the
 * container user -- the right outcome is a logged warning and a line the reader
 * still gets, not a 500 that discards a projection the model computed
 * perfectly. The cost is that those predictions are not measured later, which
 * is the lesser loss and is visible in the log.
 */
async function persist(records: readonly PredictionRecordV2[]): Promise<boolean> {
  const file = predictionsPath();
  const temporary = `${file}.tmp`;

  try {
    await mkdir(path.dirname(file), { recursive: true });
    // Temp file then rename: an interrupted write must not truncate the history.
    await writeFile(temporary, JSON.stringify({ predictions: records }), 'utf-8');
    await rename(temporary, file);
    return true;
  } catch (error) {
    logger.warn('predictions_unwritable', {
      reason: (error as NodeJS.ErrnoException)?.code ?? 'unknown',
      records: records.length,
    });
    return false;
  }
}

/** Serialises writes; publishing and settling must not clobber each other. */
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Publish selections so they can be measured later.
 *
 * The probability and the settlement rule are frozen here. Nothing recomputes
 * them afterwards — that is what makes the accuracy figures honest rather than
 * a model grading its own homework with hindsight.
 *
 * Idempotent per selection: regenerating a line does not double-count a
 * selection that was already published.
 */
export function publishPredictions(
  selections: readonly Selection[],
  risk: RiskLevel | null,
): Promise<number> {
  return exclusive(async () => {
    const existing = await readPredictions();
    const known = new Set(existing.map((record) => record.id));

    const created: PredictionRecordV2[] = [];
    const now = new Date().toISOString();

    for (const selection of selections) {
      if (known.has(selection.id)) continue;
      known.add(selection.id);

      created.push({
        id: selection.id,
        game_id: selection.game_id,
        sport: selection.sport,
        league: selection.league,
        selection_type: selection.type,
        selection: selection.label,
        settlement: selection.settlement,
        model_probability: selection.probability,
        model_confidence: selection.confidence,
        data_quality: selection.data_quality,
        model_version: MODEL_VERSION,
        risk,
        created_at: now,
        game_start: selection.start_time,
        status: 'pending',
        result: null,
        settled_at: null,
      });
    }

    if (created.length === 0) return 0;

    const written = await persist([...existing, ...created]);
    if (!written) return 0;

    logger.info('predictions_published', { created: created.length, risk });
    return created.length;
  });
}

/** A completed game, keyed by game id, as supplied by the settlement job. */
export type FinalScores = ReadonlyMap<string, FinalScore>;

/**
 * Settle everything whose game has finished.
 *
 * Compares the stored rule against the final score. Nothing is re-derived: the
 * line the model published is the line it is judged against.
 */
export function settlePredictions(finals: FinalScores): Promise<number> {
  return exclusive(async () => {
    const records = await readPredictions();
    const pending = awaitingSettlement(records, Date.now());
    if (pending.length === 0) return 0;

    const settledAt = new Date().toISOString();
    let changed = 0;

    const updated = records.map((record) => {
      if (record.status !== 'pending') return record;
      const final = finals.get(record.game_id);
      if (!final) return record;

      changed += 1;
      return {
        ...record,
        status: settle(record.settlement, final),
        result: describeResult(final),
        settled_at: settledAt,
      };
    });

    if (changed === 0) return 0;

    const written = await persist(updated);
    if (!written) return 0;

    logger.info('predictions_settled', { settled: changed });
    return changed;
  });
}

/** Game ids still waiting on a result, so the job knows what to look up. */
export async function pendingGameIds(): Promise<string[]> {
  const records = await readPredictions();
  return [...new Set(awaitingSettlement(records, Date.now()).map((r) => r.game_id))];
}
