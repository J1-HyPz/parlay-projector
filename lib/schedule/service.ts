/**
 * Schedule service — games for today through today + 7.
 *
 * Reuses the Home page sports provider and game normalisation rather than
 * introducing a second integration. Crucially it reuses the *same cache keys*
 * as `getGamesToday`, so today's fixtures are fetched once and shared by both
 * pages in either direction.
 *
 * The provider has no date-range endpoint, so the window costs one request per
 * (date, sport). Those run with bounded concurrency, tolerate partial failure,
 * and fall back to stale data when a refresh is rate limited.
 */

import { cached } from '../cache';
import { APP_TIMEZONE, sportsConfig } from '../config';
import { logger } from '../logger';
import { SPORT_DEFINITIONS, sortGames } from '../home/sports/normalise';
import type { SportDefinition } from '../home/sports/normalise';
import { createTheSportsDbProvider } from '../home/sports/thesportsdb';
import type { SportsProvider } from '../home/sports/provider';
import type { Game, SportId } from '../home/types';
import { scheduleRange } from './range';
import type { ScheduleRange } from './range';

// The same provider the Home page uses. Not a second integration.
const provider: SportsProvider = createTheSportsDbProvider();

/**
 * Schedule data changes slowly, and every request costs provider budget, so
 * this sits at the top of the sensible range.
 */
const SCHEDULE_TTL_MS = 15 * 60_000;

/**
 * Concurrency cap for provider calls.
 *
 * The window is up to 48 requests. Firing them all at once reliably trips the
 * provider's rate limit, so they go out in bounded waves.
 */
const CONCURRENCY = 4;

export interface ScheduleResult {
  range: ScheduleRange;
  games: Game[];
  /** True only when every provider request failed. */
  failed: boolean;
  /** Number of (date, sport) fetches that failed but did not sink the result. */
  partialFailures: number;
}

function definitionsFor(sport: SportId): SportDefinition[] {
  if (sport === 'all') return [...SPORT_DEFINITIONS];
  return SPORT_DEFINITIONS.filter((definition) => definition.id === sport);
}

/** Run tasks with a bounded number in flight at once. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await run(item);
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

  // One unit of work per (date, sport).
  const tasks = range.dates.flatMap((date) =>
    definitions.map((definition) => ({ date, definition })),
  );

  const outcomes = await mapWithConcurrency(tasks, CONCURRENCY, async ({ date, definition }) => {
    try {
      // Same key shape as getGamesToday, so the two features share entries.
      const { value } = await cached(
        `games:${provider.name}:${date}:${definition.id}`,
        sportsConfig.cacheTtlMs > SCHEDULE_TTL_MS ? sportsConfig.cacheTtlMs : SCHEDULE_TTL_MS,
        () => provider.gamesOnDate(date, definition),
      );
      return { games: value, failed: false };
    } catch (error) {
      logger.warn('schedule_fetch_failed', {
        provider: provider.name,
        date,
        sport: definition.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return { games: [] as Game[], failed: true };
    }
  });

  const games = sortGames(outcomes.flatMap((outcome) => outcome.games));
  const partialFailures = outcomes.filter((outcome) => outcome.failed).length;
  const failed = outcomes.length > 0 && partialFailures === outcomes.length;

  logger.info('schedule_refreshed', {
    provider: provider.name,
    start: range.start,
    end: range.end,
    requests: tasks.length,
    games: games.length,
    partial_failures: partialFailures,
  });

  return { range, games, failed, partialFailures };
}
