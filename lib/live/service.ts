/**
 * Live service — games currently in progress.
 *
 * Reuses the shared provider adapter pattern, the shared game model and the
 * shared status normalisation. The only thing it does not share is the cache
 * entry: fixtures are cached for minutes, and a scoreboard cached for minutes
 * would be wrong, so live results get their own short-lived key.
 *
 * Venue and round are filled in from today's fixtures, which Home and Schedule
 * have usually already cached — context for free rather than extra requests.
 */

import { cached } from '../cache';
import { APP_TIMEZONE, liveConfig } from '../config';
import { logger } from '../logger';
import { SPORT_DEFINITIONS } from '../home/sports/normalise';
import { getGamesToday } from '../home/sports/service';
import type { Game } from '../home/types';
import { enrichFromFixture, selectUpcomingToday, sortLiveGames } from './normalise';
import { createTheSportsDbLiveProvider } from './thesportsdb';
import type { LiveProvider } from './provider';
import type { LiveGame } from './types';

// The one place the concrete provider is chosen.
const provider: LiveProvider = createTheSportsDbLiveProvider();

/** Six sports, so a refresh is six concurrent requests. */
const CONCURRENCY = 6;

export interface LiveResult {
  games: LiveGame[];
  /** Games still to start today. Derived from fixtures already fetched. */
  upcoming: Game[];
  updatedAt: string;
  /** True only when every sport's request failed. */
  failed: boolean;
}

/**
 * Today's fixtures.
 *
 * Serves two purposes from one already-cached fetch: adding venue and round to
 * a live card, and deriving the upcoming list. Failure here is invisible — the
 * scoreboard still renders, just without the extra context.
 */
async function todaysFixtures(): Promise<{ index: Map<string, Game>; games: Game[] }> {
  try {
    const { games } = await getGamesToday('all');
    return { index: new Map(games.map((game) => [game.id, game])), games };
  } catch {
    return { index: new Map(), games: [] };
  }
}

async function fetchLive(): Promise<{ games: LiveGame[]; failed: boolean }> {
  const results = await Promise.all(
    SPORT_DEFINITIONS.slice(0, CONCURRENCY).map(async (definition) => {
      try {
        const games = await provider.liveForSport(definition.id, definition.providerSport);
        return { games, failed: false };
      } catch (error) {
        logger.warn('live_sport_refresh_failed', {
          provider: provider.name,
          sport: definition.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return { games: [] as LiveGame[], failed: true };
      }
    }),
  );

  // One sport failing must not empty the whole scoreboard.
  const failed = results.length > 0 && results.every((result) => result.failed);
  return { games: results.flatMap((result) => result.games), failed };
}

/**
 * All games currently in progress.
 *
 * Cached briefly so simultaneous clients share one provider refresh; the cache
 * also deduplicates in-flight requests, so a burst of page loads produces a
 * single upstream call.
 */
export async function getLive(): Promise<LiveResult> {
  try {
    const { value, hit } = await cached(
      `live:${provider.name}`,
      liveConfig.cacheTtlMs,
      async () => {
        const [{ games, failed }, fixtures] = await Promise.all([fetchLive(), todaysFixtures()]);

        const enriched = sortLiveGames(
          games.map((game) => enrichFromFixture(game, fixtures.index.get(game.id))),
        );

        // A fixture that has already gone live must not also sit in upcoming.
        const live = new Set(enriched.map((game) => game.id));
        const upcoming = selectUpcomingToday(fixtures.games, APP_TIMEZONE).filter(
          (game) => !live.has(game.id),
        );

        return { games: enriched, upcoming, failed, updatedAt: new Date().toISOString() };
      },
    );

    if (!hit) {
      logger.info('live_refreshed', {
        provider: provider.name,
        games: value.games.length,
        upcoming: value.upcoming.length,
        failed: value.failed,
      });
    }

    return value;
  } catch (error) {
    logger.error('live_refresh_failed', {
      provider: provider.name,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { games: [], upcoming: [], updatedAt: new Date().toISOString(), failed: true };
  }
}

export const liveTimezone = APP_TIMEZONE;
