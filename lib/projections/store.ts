/**
 * Prediction persistence, lifecycle and settlement.
 *
 * Stored as JSON under DATA_DIR — the mounted TrueNAS dataset — alongside the
 * notification state. Prediction history is the one thing in this application
 * that must survive a redeploy, because it is the only evidence the model
 * works.
 *
 * No database server is introduced, deliberately. One household's history is a
 * few thousand records; whole-file reads with cached aggregates are faster than
 * a query planner would be at this size, and the project cannot add native
 * dependencies. If this ever outgrows a file, the interface here is what a
 * SQLite or Postgres implementation would satisfy — callers would not change.
 *
 * The rule that matters most: **nothing already settled is ever silently
 * rewritten.** The probability, the settlement rule and the projected scoreline
 * are frozen when a prediction is published. A result can change only inside
 * the finalisation window, only because the provider corrected the score, and
 * only with an audit entry recording what changed and why.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config';
import { logger } from '../logger';
import { PREDICTIONS_FILENAME, awaitingSettlement, parsePredictions } from './store-parse';
import { parseParlays, PARLAYS_FILENAME } from './parlay-parse';
import { describeResult, evidenceFor, isRaceRule, outcomeOf, settle } from './settlement';
import {
  applyParlayStatus,
  isAbandoned,
  isTerminal,
  markFinalPreGame,
  nextAttemptAt,
  settlementQueue,
  queuedGameIds,
} from './tracking';
import { MODEL_VERSION } from './types';
import type {
  ParlayKind,
  ParlayRecord,
  ParlayScopeRecord,
  PredictionRecordV2,
  PredictionStatus,
  RiskLevel,
  Selection,
} from './types';

export { PREDICTIONS_FILENAME, parsePredictions, awaitingSettlement };

export function predictionsPath(): string {
  return path.join(DATA_DIR, PREDICTIONS_FILENAME);
}

export function parlaysPath(): string {
  return path.join(DATA_DIR, PARLAYS_FILENAME);
}

// ---------------------------------------------------------------------------
// Reading and writing
// ---------------------------------------------------------------------------

async function readJson<T>(file: string, parse: (raw: unknown) => T, empty: T): Promise<T> {
  try {
    return parse(JSON.parse(await readFile(file, 'utf-8')));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn('prediction_store_unreadable', { file: path.basename(file), reason: code ?? 'parse_error' });
    }
    return empty;
  }
}

/** Empty on any failure: no history is a truthful answer, a crash is not. */
export function readPredictions(): Promise<PredictionRecordV2[]> {
  return readJson(predictionsPath(), parsePredictions, []);
}

export function readParlays(): Promise<ParlayRecord[]> {
  return readJson(parlaysPath(), parseParlays, []);
}

/**
 * Write, reporting failure rather than throwing.
 *
 * Publishing is a side effect of generating a line. If DATA_DIR is not writable
 * the right outcome is a logged warning and a line the reader still gets, not a
 * 500 that discards a projection the model computed perfectly.
 */
async function persist(file: string, body: unknown): Promise<boolean> {
  const temporary = `${file}.tmp`;

  try {
    await mkdir(path.dirname(file), { recursive: true });
    // Temp file then rename: an interrupted write must not truncate history.
    await writeFile(temporary, JSON.stringify(body), 'utf-8');
    await rename(temporary, file);
    return true;
  } catch (error) {
    logger.warn('prediction_store_unwritable', {
      file: path.basename(file),
      reason: (error as NodeJS.ErrnoException)?.code ?? 'unknown',
    });
    return false;
  }
}

/**
 * Serialises every mutation behind one promise chain.
 *
 * The settlement job, a page generating a line, and a manual re-run can all
 * write at once. Without this, two settlements reading the same file would each
 * write their own view and the second would discard the first — the failure
 * mode §77 warns about, solved with an actual queue rather than a flag.
 */
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  queue = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/** Deterministic id for a generated line, so republishing cannot duplicate it. */
export function parlayIdFor(legs: readonly Selection[], risk: RiskLevel): string {
  return `${risk}:${legs.map((leg) => leg.id).join('|')}`;
}

export interface PublishResult {
  created: number;
  parlay_id: string | null;
  stored: boolean;
  /**
   * The store as it now stands.
   *
   * Returned because the caller needs the tracked status of the legs it just
   * published, and this function has already read and merged the whole file —
   * a second read on the request path would grow with the history.
   */
  records: PredictionRecordV2[];
}

/**
 * Publish a generated line so it can be measured.
 *
 * Everything needed to judge the prediction later is frozen here: the
 * probability, the settlement rule, and the projected scoreline. Nothing
 * recomputes them afterwards — that is what makes the accuracy figures honest
 * rather than a model marking its own homework with hindsight.
 *
 * Idempotent at both levels. A selection already published is not duplicated,
 * and a line whose legs are unchanged keeps its original id, so pressing
 * Regenerate and landing on the same combination does not inflate the sample.
 */
export interface PublishOptions {
  /**
   * The combined probability the line published.
   *
   * Passed in rather than derived here. Multiplying the legs is only correct
   * for a multi-game line; a same-game line claims a measured joint
   * probability, and storing the product instead would judge the optimiser
   * against a number it never gave.
   */
  combinedProbability?: number;
  kind?: ParlayKind;
  /**
   * The filter the line was built under.
   *
   * Stored on the line rather than inferred from its legs: "every football
   * competition" and "the Premier League, which happened to supply every leg"
   * are different claims, and only the request knows which was made.
   */
  scope?: ParlayScopeRecord;
}

export function publishPredictions(
  selections: readonly Selection[],
  risk: RiskLevel | null,
  options: PublishOptions = {},
): Promise<PublishResult> {
  return exclusive(async () => {
    if (selections.length === 0) {
      return { created: 0, parlay_id: null, stored: false, records: [] };
    }

    const existing = await readPredictions();
    const known = new Map(existing.map((record) => [record.id, record]));

    const parlayId = risk ? parlayIdFor(selections, risk) : null;
    const now = new Date().toISOString();

    const created: PredictionRecordV2[] = [];

    for (const selection of selections) {
      if (known.has(selection.id)) continue;

      const projection = selection.projection;
      const race = selection.race;

      created.push({
        id: selection.id,
        game_id: selection.game_id,
        sport: selection.sport,
        league: selection.league,
        league_id: selection.league_id ?? null,
        selection_type: selection.type,
        selection: selection.label,
        settlement: selection.settlement,
        // A race has no two sides. The competitor is named on the settlement
        // rule, which is what the result is judged against anyway.
        home_team: projection?.home_team ?? null,
        away_team: projection?.away_team ?? null,
        model_probability: selection.probability,
        model_confidence: selection.confidence,
        data_quality: selection.data_quality,
        // Race predictions carry their own model version: the two models are
        // not comparable and must never be averaged together silently.
        model_version: race ? race.model_version : MODEL_VERSION,
        risk,
        created_at: now,
        game_start: selection.start_time,
        status: 'pending',
        result: null,
        settled_at: null,
        // Decided by the tracker from the timestamps once the game starts,
        // never asserted at publication.
        final_pre_game: false,
        parlay_id: parlayId,
        /*
         * The scoreline the model published, frozen with the prediction.
         *
         * Null for a race, which projects a finishing order rather than a
         * score. Its equivalent — where the driver was actually classified —
         * is recorded on `actual` at settlement.
         */
        projected: projection
          ? {
              home_score: projection.expected_home_score,
              away_score: projection.expected_away_score,
              margin: projection.expected_margin,
              total: projection.expected_total,
            }
          : null,
        actual: null,
        attempts: 0,
        next_attempt_at: null,
        audit: [],
      });
    }

    const records = [...existing, ...created];

    let stored = true;
    if (created.length > 0) {
      stored = await persist(predictionsPath(), { predictions: records });
      if (stored) {
        logger.info('predictions_published', { created: created.length, risk, parlay: parlayId });
      }
    }

    // The line itself, so the optimiser can be measured as well as the model.
    if (parlayId && risk) {
      const parlays = await readParlays();
      if (!parlays.some((parlay) => parlay.id === parlayId)) {
        const starts = selections
          .map((selection) => selection.start_time)
          .filter((start): start is string => start !== null)
          .sort();

        const record: ParlayRecord = {
          id: parlayId,
          risk,
          leg_ids: selections.map((selection) => selection.id),
          kind: options.kind ?? 'multi_game',
          ...(options.scope ? { scope: options.scope } : {}),
          combined_probability: Number(
            (
              options.combinedProbability ??
              selections.reduce((product, leg) => product * leg.probability, 1)
            ).toFixed(4),
          ),
          average_confidence: Number(
            (selections.reduce((sum, l) => sum + l.confidence, 0) / selections.length).toFixed(3),
          ),
          average_data_quality: Number(
            (selections.reduce((sum, l) => sum + l.data_quality, 0) / selections.length).toFixed(3),
          ),
          model_version: MODEL_VERSION,
          created_at: now,
          first_start: starts[0] ?? null,
          status: 'pending',
          settled_at: null,
        };

        await persist(parlaysPath(), { parlays: [...parlays, record] });
        logger.info('parlay_published', { parlay: parlayId, risk, legs: record.leg_ids.length });
      }
    }

    return { created: created.length, parlay_id: parlayId, stored, records };
  });
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/** State of one game, as the settlement job observed it. */
export interface GameState {
  status: 'scheduled' | 'live' | 'finished' | 'cancelled' | 'postponed';
  home: number | null;
  away: number | null;
  /**
   * The classified finishing order, for an event contested by a field.
   *
   * A race has no score, so this is what its predictions are settled against.
   * A retirement appears here with the position it was classified in, which is
   * what makes a retired driver lose a top-ten selection rather than voiding
   * it.
   */
  order?: readonly { entrant: string; position: number }[];
}

export type GameStates = ReadonlyMap<string, GameState>;

export interface SettlementSummary {
  /** Predictions that reached a terminal status this run. */
  settled: number;
  /** Predictions moved from pending to live. */
  live: number;
  /** Finished games whose result has not arrived; scheduled for retry. */
  unsettled: number;
  /** Past the finalisation window with no result. */
  abandoned: number;
  /** Already-settled results a provider correction changed. */
  corrected: number;
  parlays: number;
}

const EMPTY: SettlementSummary = {
  settled: 0,
  live: 0,
  unsettled: 0,
  abandoned: 0,
  corrected: 0,
  parlays: 0,
};

/**
 * Move every open prediction as far as the evidence allows.
 *
 * Idempotent: running it twice with the same game states produces the same
 * result and writes nothing the second time. Background jobs retry, and a
 * duplicate settlement would corrupt every metric downstream.
 */
export function settlePredictions(states: GameStates): Promise<SettlementSummary> {
  return exclusive(async () => {
    const records = await readPredictions();
    if (records.length === 0) return EMPTY;

    const now = Date.now();
    const timestamp = new Date(now).toISOString();
    const summary = { ...EMPTY };

    // Decide the official pre-game prediction for anything that has started.
    // Done from the stored timestamps alone, so a result can never influence it.
    const withFinals = markFinalPreGame(records);

    const updated = withFinals.map((record) => {
      const state = states.get(record.game_id);

      // --- already settled: only a provider correction may touch it ---------
      if (isTerminal(record.status)) {
        if (!state) return record;

        const evidence = evidenceFor(record.settlement, state);
        // No usable evidence is not a correction. Leaving the record alone is
        // the only safe answer: re-settling against a result that has not
        // arrived would overwrite a sound outcome with a void.
        if (!evidence) return record;

        const revised = settle(record.settlement, evidence);
        if (revised === record.status) return record;

        summary.corrected += 1;
        logger.warn('prediction_result_corrected', {
          prediction: record.id,
          from: record.status,
          to: revised,
        });

        const outcome = outcomeOf(record.settlement, evidence);

        return {
          ...record,
          status: revised,
          result: outcome.text,
          actual: outcome.actual,
          audit: [
            ...record.audit,
            {
              previous_result: record.status,
              new_result: revised,
              reason: isRaceRule(record.settlement)
                ? 'provider corrected the finishing order'
                : 'provider corrected the final score',
              changed_at: timestamp,
            },
          ],
        };
      }

      // --- no result yet ----------------------------------------------------
      if (!state) {
        if (isAbandoned(record, now)) {
          summary.abandoned += 1;
          return {
            ...record,
            status: 'void' as PredictionStatus,
            result: 'No result available',
            settled_at: timestamp,
          };
        }
        return record;
      }

      // --- under way --------------------------------------------------------
      if (state.status === 'live') {
        if (record.status === 'live') return record;
        summary.live += 1;
        return { ...record, status: 'live' as PredictionStatus };
      }

      // --- never played -----------------------------------------------------
      if (state.status === 'cancelled' || state.status === 'postponed') {
        summary.settled += 1;
        return {
          ...record,
          status: 'void' as PredictionStatus,
          result: describeResult({ home: 0, away: 0, status: state.status }),
          settled_at: timestamp,
        };
      }

      if (state.status !== 'finished') return record;

      /*
       * A race is settled against its finishing order, not a scoreline.
       *
       * Kept on the same path as everything else so the retry backoff, the
       * abandonment rule and the audit trail all behave identically — only the
       * thing being compared differs.
       */
      const evidence = evidenceFor(record.settlement, state);

      // --- finished, but the result has not arrived -------------------------
      if (!evidence) {
        if (isAbandoned(record, now)) {
          summary.abandoned += 1;
          return {
            ...record,
            status: 'void' as PredictionStatus,
            result: 'Final score never published',
            settled_at: timestamp,
          };
        }

        const attempts = record.attempts + 1;
        summary.unsettled += 1;
        return {
          ...record,
          status: 'unsettled' as PredictionStatus,
          attempts,
          next_attempt_at: nextAttemptAt(attempts, now),
        };
      }

      // --- finished with a result -------------------------------------------
      const outcome = settle(record.settlement, evidence);
      const described = outcomeOf(record.settlement, evidence);

      summary.settled += 1;
      logger.info('prediction_settled', {
        prediction: record.id,
        game: record.game_id,
        selection: record.selection,
        result: outcome,
        probability: record.model_probability,
      });

      return {
        ...record,
        status: outcome,
        result: described.text,
        actual: described.actual,
        settled_at: timestamp,
        next_attempt_at: null,
      };
    });

    // Nothing moved: write nothing. This is what makes a repeat run a no-op.
    const changed = updated.some((record, index) => record !== withFinals[index]);
    const finalsChanged = withFinals.some((record, index) => record !== records[index]);
    if (!changed && !finalsChanged) return EMPTY;

    await persist(predictionsPath(), { predictions: updated });

    summary.parlays = await refreshParlays(updated, timestamp);
    return summary;
  });
}

/** Fold leg outcomes into their generated lines. */
async function refreshParlays(
  records: readonly PredictionRecordV2[],
  timestamp: string,
): Promise<number> {
  const parlays = await readParlays();
  if (parlays.length === 0) return 0;

  const byId = new Map(records.map((record) => [record.id, record]));

  let changed = 0;
  const updated = parlays.map((parlay) => {
    const legs = parlay.leg_ids
      .map((id) => byId.get(id))
      .filter((leg): leg is PredictionRecordV2 => leg !== undefined);

    const next = applyParlayStatus(parlay, legs, timestamp);
    if (next !== parlay) {
      changed += 1;
      logger.info('parlay_status_changed', {
        parlay: parlay.id,
        from: parlay.status,
        to: next.status,
      });
    }
    return next;
  });

  if (changed > 0) await persist(parlaysPath(), { parlays: updated });
  return changed;
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

/**
 * Games the settlement job needs states for.
 *
 * Only fixtures that have started, are due a retry, or are inside the
 * correction window. Rescanning every prediction ever made would grow without
 * bound and achieve nothing.
 */
export async function settlementTargets(): Promise<string[]> {
  const records = await readPredictions();
  return queuedGameIds(settlementQueue(records, Date.now()));
}
