/**
 * Sports service — today's games for the Home page.
 *
 * Responsibilities: pick the sports to query, cache results, and degrade
 * gracefully. A provider failure yields an empty list plus an error code, never
 * an exception that takes the homepage down with it.
 */

import { APP_TIMEZONE, sportsConfig, todayInAppTimezone } from '../../config';
import { logger } from '../../logger';
import { LEAGUES } from '../../leagues/registry';
import type { League } from '../../leagues/registry';
import { fixturesForLeague } from '../../providers/fixtures';
import { gameDate } from '../../schedule/range';
import { sortGames } from './normalise';
import type { Game, SportId } from '../types';

/**
 * Games Today comes from the same league catalogue the Schedule uses, so both
 * pages agree and share cached fixture requests.
 */
const PROVIDER_ID = 'espn';

export interface GamesResult {
  date: string;
  games: Game[];
  failed: boolean;
}

/**
 * Games scheduled for today in the configured timezone.
 *
 * Each sport is fetched and cached independently, so one sport's provider
 * failure does not discard the sports that succeeded — `all` still returns
 * whatever came back.
 */
export async function getGamesToday(sport: SportId = 'all'): Promise<GamesResult> {
  const date = todayInAppTimezone();
  const leagues: League[] =
    sport === 'all' ? [...LEAGUES] : LEAGUES.filter((league) => league.sport === sport);

  const results = await Promise.all(
    leagues.map(async (league) => {
      try {
        // Same range request the Schedule makes, so the cache is shared: one
        // fetch serves both pages.
        const games = await fixturesForLeague(
          league,
          date,
          date,
          sportsConfig.cacheTtlMs,
        );
        return { games, failed: false };
      } catch (error) {
        logger.warn('homepage_games_failed', {
          provider: PROVIDER_ID,
          league: league.id,
          date,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return { games: [] as Game[], failed: true };
      }
    }),
  );

  // A range request can return neighbouring days, so pin to today explicitly.
  const games = sortGames(
    results
      .flatMap((result) => result.games)
      .filter((game) => gameDate(game.start_time, APP_TIMEZONE) === date),
  );

  const failed = results.length > 0 && results.every((result) => result.failed);

  logger.info('homepage_games_refreshed', {
    provider: PROVIDER_ID,
    date,
    leagues: leagues.length,
    count: games.length,
  });

  return { date, games, failed };
}
