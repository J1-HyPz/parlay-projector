/**
 * Schedule service — games for today through today + 7.
 *
 * Driven by the league catalogue rather than a sport-wide query, and served by
 * ESPN, which accepts a date range: one request per league covers the whole
 * window. Fifteen leagues cost fifteen requests, against the forty-eight the
 * previous per-sport-per-day approach needed.
 *
 * Requests run with bounded concurrency, tolerate partial failure, and fall
 * back to stale data when a refresh fails.
 */

import { APP_TIMEZONE, sportsConfig } from '../config';
import { logger } from '../logger';
import { sortGames } from '../home/sports/normalise';
import { LEAGUES } from '../leagues/registry';
import type { League } from '../leagues/registry';
import { fixturesForLeague } from '../providers/espn/fixtures';
import type { Game, SportId } from '../home/types';
import { scheduleRange } from './range';
import type { ScheduleRange } from './range';

/**
 * Fixtures come from the league catalogue rather than a sport-wide query.
 *
 * Two reasons. The primary provider returns no NFL games at all, so an NFL
 * filter matched nothing; and a sport-wide soccer query returns every league on
 * earth, burying the competitions anyone wants. Asking per league fixes both,
 * and costs fewer requests because the provider accepts a date range.
 */
const PROVIDER_ID = 'espn';

/**
 * Cache lifetime and concurrency both come from the tuning profile, which is
 * derived from the API key: the throttling exists to survive the public test
 * key's limits, and a premium key does not need it. See lib/tuning.ts.
 */

export interface ScheduleResult {
  range: ScheduleRange;
  games: Game[];
  /** True only when every provider request failed. */
  failed: boolean;
  /** Number of (date, sport) fetches that failed but did not sink the result. */
  partialFailures: number;
}

function leaguesFor(sport: SportId): League[] {
  if (sport === 'all') return [...LEAGUES];
  return LEAGUES.filter((league) => league.sport === sport);
}

/**
 * Run tasks with a bounded number in flight at once.
 *
 * Results are appended as they complete rather than written into a pre-sized
 * array: the caller sorts games by kick-off afterwards, so completion order
 * carries no meaning.
 */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) results.push(await run(item));
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Games across the schedule window.
 *
 * `sport` narrows which sports are fetched; the frontend normally requests
 * everything once and filters client-side.
 */
export async function getSchedule(sport: SportId = 'all'): Promise<ScheduleResult> {
  const range = scheduleRange(APP_TIMEZONE);
  const definitions = definitionsFor(sport);

  // One request per league covers the whole window.
  const tasks = leaguesFor(sport);

  const outcomes = await mapWithConcurrency(
    tasks,
    sportsConfig.scheduleConcurrency,
    async (league) => {
      try {
        const games = await fixturesForLeague(
          league,
          range.start,
          range.end,
          Math.max(sportsConfig.cacheTtlMs, sportsConfig.scheduleTtlMs),
        );
        return { games, failed: false };
      } catch (error) {
        logger.warn('schedule_fetch_failed', {
          provider: PROVIDER_ID,
          league: league.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return { games: [] as Game[], failed: true };
      }
    },
  );

  const games = sortGames(outcomes.flatMap((outcome) => outcome.games));
  const partialFailures = outcomes.filter((outcome) => outcome.failed).length;
  const failed = outcomes.length > 0 && partialFailures === outcomes.length;

  logger.info('schedule_refreshed', {
    provider: PROVIDER_ID,
    tuning: sportsConfig.tuningProfile,
    concurrency: sportsConfig.scheduleConcurrency,
    start: range.start,
    end: range.end,
    leagues: tasks.length,
    games: games.length,
    partial_failures: partialFailures,
  });

  return { range, games, failed, partialFailures };
}
