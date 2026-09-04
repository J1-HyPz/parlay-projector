/**
 * The background tracker.
 *
 *   open predictions ──► games they need ──► current state ──► settle
 *
 * Reads game state from the fixture adapter every other page already shares, so
 * tracking a prediction costs a cache lookup rather than its own provider
 * traffic. The Live page, Game Details and this job all read the same
 * normalised state.
 *
 * Look-ahead safety: this only ever *reads* a score and compares it against the
 * settlement rule frozen when the prediction was published. It never
 * regenerates a projection and never edits a stored probability.
 *
 * Recovery is automatic. Nothing about the queue lives in memory — it is
 * derived from the stored records on every run — so a container restart, a
 * redeploy or a TrueNAS reboot resumes exactly where it left off.
 */

import { logger } from '../logger';
import { LEAGUES } from '../leagues/registry';
import { fixturesForLeague } from '../providers/fixtures';
import { addDays } from '../schedule/range';
import { todayInAppTimezone } from '../config';
import { modelConfigFor } from './config';
import { invalidateAccuracy } from './accuracy';
import { readPredictions, settlePredictions, settlementTargets } from './store';
import type { GameState } from './store';
import { settlementQueue } from './tracking';

/**
 * How far back to look for results.
 *
 * Comfortably covers the finalisation window plus a missed run or two, without
 * asking for a season of fixtures on every pass.
 */
const LOOKBACK_DAYS = 3;

/**
 * Short, so a live score is current.
 *
 * Shared with the Live page's cache: both read the same normalised state, so
 * tracking a prediction costs a cache lookup rather than its own traffic.
 */
const LIVE_TTL_MS = 60_000;

export interface TrackerRun {
  /** Predictions the queue selected for examination. */
  examined: number;
  settled: number;
  live: number;
  unsettled: number;
  abandoned: number;
  corrected: number;
  parlays: number;
  /** True when the provider could not be reached; nothing was settled. */
  failed: boolean;
}

const IDLE: TrackerRun = {
  examined: 0,
  settled: 0,
  live: 0,
  unsettled: 0,
  abandoned: 0,
  corrected: 0,
  parlays: 0,
  failed: false,
};

/** Last run, for the health endpoint. */
let lastRun: { at: string; result: TrackerRun } | null = null;

export function lastSettlementRun(): { at: string; result: TrackerRun } | null {
  return lastRun;
}

/**
 * One tracking pass.
 *
 * Never throws: it runs on a timer with no caller to handle a rejection, and a
 * provider outage must not take the server down or corrupt history. When the
 * provider is unavailable nothing is settled — predictions stay exactly as they
 * are and the next run tries again.
 */
export async function runSettlement(): Promise<TrackerRun> {
  try {
    const wanted = new Set(await settlementTargets());
    if (wanted.size === 0) {
      lastRun = { at: new Date().toISOString(), result: IDLE };
      return IDLE;
    }

    const today = todayInAppTimezone();
    const start = addDays(today, -LOOKBACK_DAYS);
    const end = addDays(today, 1);

    const states = new Map<string, GameState>();
    let reachable = 0;

    /*
     * Competitions the engine projects. Motorsport qualifies through its own
     * model rather than the scoring one, so it is included explicitly — an
     * open race prediction that nothing ever looks up would sit unsettled
     * until the abandonment rule quietly voided it.
     */
    const leagues = LEAGUES.filter(
      (league) => modelConfigFor(league.sport) !== null || league.format === 'race',
    );

    await Promise.all(
      leagues.map(async (league) => {
        try {
          // Short TTL: this is the same cached fetch the Live page makes, so a
          // live score is current without a second round of requests.
          const games = await fixturesForLeague(league, start, end, LIVE_TTL_MS);
          reachable += 1;

          for (const game of games) {
            if (!wanted.has(game.id)) continue;

            if (game.status === 'cancelled' || game.status === 'postponed') {
              states.set(game.id, { status: game.status, home: null, away: null });
              continue;
            }

            if (game.status === 'live') {
              states.set(game.id, {
                status: 'live',
                home: game.score?.home ?? null,
                away: game.score?.away ?? null,
              });
              continue;
            }

            if (game.status === 'finished') {
              states.set(game.id, {
                status: 'finished',
                home: game.score?.home ?? null,
                away: game.score?.away ?? null,
                // A race is judged on where each competitor was classified.
                ...(game.entrants
                  ? {
                      order: game.entrants
                        .filter(
                          (entrant): entrant is typeof entrant & { position: number } =>
                            entrant.position !== null,
                        )
                        .map((entrant) => ({
                          entrant: entrant.name,
                          position: entrant.position,
                        })),
                    }
                  : {}),
              });
            }
          }
        } catch (error) {
          logger.warn('settlement_league_failed', {
            league: league.id,
            reason: error instanceof Error ? error.message : 'unknown',
          });
        }
      }),
    );

    // Every league failing is an outage, not an empty day. Settling on that
    // would void predictions whose games were played perfectly normally.
    if (reachable === 0) {
      logger.warn('settlement_provider_unavailable', { wanted: wanted.size });
      const failed = { ...IDLE, examined: wanted.size, failed: true };
      lastRun = { at: new Date().toISOString(), result: failed };
      return failed;
    }

    const summary = await settlePredictions(states);

    const result: TrackerRun = {
      examined: wanted.size,
      settled: summary.settled,
      live: summary.live,
      unsettled: summary.unsettled,
      abandoned: summary.abandoned,
      corrected: summary.corrected,
      parlays: summary.parlays,
      failed: false,
    };

    const changed =
      summary.settled + summary.live + summary.unsettled + summary.abandoned + summary.corrected;
    if (changed > 0) {
      // The homepage figure should move as soon as something settles.
      invalidateAccuracy();
      logger.info('settlement_run', { ...result });
    }

    lastRun = { at: new Date().toISOString(), result };
    return result;
  } catch (error) {
    logger.error('settlement_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    const failed = { ...IDLE, failed: true };
    lastRun = { at: new Date().toISOString(), result: failed };
    return failed;
  }
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

export interface TrackerHealth {
  last_run_at: string | null;
  last_run: TrackerRun | null;
  /** Predictions still open, by status. */
  open: { pending: number; live: number; unsettled: number };
  /** Open predictions the queue would examine right now. */
  queued: number;
  /** Open predictions whose game started long ago — a sign something is stuck. */
  stale: number;
}

/** Internal health, for confirming the tracker is doing its job. */
export async function trackerHealth(): Promise<TrackerHealth> {
  const records = await readPredictions();
  const now = Date.now();

  const count = (status: string) => records.filter((r) => r.status === status).length;

  const stale = records.filter((record) => {
    if (record.status !== 'pending' && record.status !== 'live') return false;
    if (!record.game_start) return false;
    const start = Date.parse(record.game_start);
    return Number.isFinite(start) && now - start > 12 * 3_600_000;
  }).length;

  return {
    last_run_at: lastRun?.at ?? null,
    last_run: lastRun?.result ?? null,
    open: {
      pending: count('pending'),
      live: count('live'),
      unsettled: count('unsettled'),
    },
    queued: settlementQueue(records, now).length,
    stale,
  };
}

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null;

/**
 * How often the tracker runs.
 *
 * A minute is fast enough for a live scoreboard and for a result to appear in
 * the accuracy figures promptly, and slow enough that the shared fixture cache
 * absorbs almost all of it. This is not a millisecond-latency problem.
 */
export const SETTLEMENT_INTERVAL_MS = 60_000;

/**
 * Start the tracker. Idempotent, and unref'd so it never holds the process
 * open on shutdown.
 *
 * Runs once immediately: after a restart there may be games that finished while
 * the container was down, and those should settle now rather than in a minute.
 */
export function startSettlement(): boolean {
  if (timer) return false;

  void runSettlement();

  timer = setInterval(() => {
    void runSettlement();
  }, SETTLEMENT_INTERVAL_MS);
  timer.unref?.();

  logger.info('settlement_started', { intervalMs: SETTLEMENT_INTERVAL_MS });
  return true;
}

export function stopSettlement(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
