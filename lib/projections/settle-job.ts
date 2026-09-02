/**
 * Settling published predictions against real results.
 *
 * Runs on the same in-process timer the Discord notifier uses, and reads final
 * scores from the fixture adapter every other page already shares — so
 * settlement costs nothing beyond a cache lookup in the common case.
 *
 * Look-ahead safety: this only ever *reads* a final score and compares it
 * against the settlement rule frozen when the prediction was published. It
 * never regenerates a projection, never touches a stored probability, and
 * never revisits a record that has already settled.
 */

import { logger } from '../logger';
import { LEAGUES } from '../leagues/registry';
import { fixturesForLeague } from '../providers/espn/fixtures';
import { addDays } from '../schedule/range';
import { todayInAppTimezone } from '../config';
import { modelConfigFor } from './config';
import { pendingGameIds, settlePredictions } from './store';
import type { FinalScore } from './settlement';

/** How far back to look for results. Comfortably covers a missed run or two. */
const LOOKBACK_DAYS = 10;

/** Settled results never change, so this can be cached hard. */
const RESULTS_TTL_MS = 6 * 60 * 60_000;

/**
 * Settle whatever can be settled.
 *
 * Never throws: it runs on a timer with no caller to handle a rejection.
 * Returns the number of predictions settled.
 */
export async function runSettlement(): Promise<number> {
  try {
    const pending = await pendingGameIds();
    if (pending.length === 0) return 0;

    const wanted = new Set(pending);
    const today = todayInAppTimezone();
    const start = addDays(today, -LOOKBACK_DAYS);

    const finals = new Map<string, FinalScore>();

    // Only leagues the engine actually projects can hold pending predictions.
    const leagues = LEAGUES.filter((league) => modelConfigFor(league.sport) !== null);

    await Promise.all(
      leagues.map(async (league) => {
        try {
          const games = await fixturesForLeague(league, start, today, RESULTS_TTL_MS);

          for (const game of games) {
            if (!wanted.has(game.id)) continue;

            if (game.status === 'cancelled' || game.status === 'postponed') {
              // Never played, so the projection was never tested: void.
              finals.set(game.id, { home: 0, away: 0, status: game.status });
              continue;
            }

            if (game.status !== 'finished') continue;
            const home = game.score?.home;
            const away = game.score?.away;
            // A finished game with no score cannot settle anything; it stays
            // pending rather than being guessed at.
            if (typeof home !== 'number' || typeof away !== 'number') continue;

            finals.set(game.id, { home, away, status: 'finished' });
          }
        } catch (error) {
          logger.warn('settlement_league_failed', {
            league: league.id,
            reason: error instanceof Error ? error.message : 'unknown',
          });
        }
      }),
    );

    if (finals.size === 0) return 0;
    return await settlePredictions(finals);
  } catch (error) {
    logger.error('settlement_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return 0;
  }
}

let timer: NodeJS.Timeout | null = null;

/** How often settlement runs on its own. Results appear within the hour. */
const SETTLEMENT_INTERVAL_MS = 30 * 60_000;

/**
 * Own timer, used only when the notifier is not running.
 *
 * Idempotent, and unref'd so it never holds the process open on shutdown.
 */
export function startSettlement(): boolean {
  if (timer) return false;
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
