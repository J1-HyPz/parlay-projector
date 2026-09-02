/**
 * Fixtures for one competition, across a window either side of today.
 *
 * Built on `fixturesForLeague`, the same adapter Schedule and Home use, so a
 * hub costs one request per league and shares the cache with them where the
 * ranges coincide. No second fixture fetcher is introduced.
 *
 * The Schedule service covers today through today+7 only; a hub also needs
 * recent results, hence the wider window rather than a different source.
 */

import { APP_TIMEZONE, sportsConfig, todayInAppTimezone } from '../config';
import { logger } from '../logger';
import { sortGames } from '../home/sports/normalise';
import { fixturesForLeague } from '../providers/fixtures';
import { addDays } from '../schedule/range';
import { HUB_DAYS_AHEAD, HUB_DAYS_BACK } from '../sports/split';
import type { League } from './registry';
import type { Game } from '../home/types';

export interface LeagueGamesResult {
  games: Game[];
  start: string;
  end: string;
  today: string;
  timezone: string;
  /** True only when every league requested failed. */
  failed: boolean;
}

/**
 * Games for one or more leagues across the hub window.
 *
 * Takes a list because the combined NCAA basketball hub covers two leagues.
 * One failing does not discard the other — a hub showing half its fixtures is
 * far better than one showing none.
 */
export async function getLeagueGames(leagues: readonly League[]): Promise<LeagueGamesResult> {
  const today = todayInAppTimezone();
  const start = addDays(today, -HUB_DAYS_BACK);
  const end = addDays(today, HUB_DAYS_AHEAD);

  const outcomes = await Promise.all(
    leagues.map(async (league) => {
      try {
        const games = await fixturesForLeague(
          league,
          start,
          end,
          // Results and fixtures move far more slowly than a scoreboard; the
          // schedule TTL is the right order of magnitude and shares tuning.
          Math.max(sportsConfig.cacheTtlMs, sportsConfig.scheduleTtlMs),
        );
        return { games, failed: false };
      } catch (error) {
        logger.warn('league_games_failed', {
          league: league.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return { games: [] as Game[], failed: true };
      }
    }),
  );

  const failed = outcomes.length > 0 && outcomes.every((outcome) => outcome.failed);

  return {
    games: sortGames(outcomes.flatMap((outcome) => outcome.games)),
    start,
    end,
    today,
    timezone: APP_TIMEZONE,
    failed,
  };
}
