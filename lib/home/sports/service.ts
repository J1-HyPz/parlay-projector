/**
 * Sports service — today's games for the Home page.
 *
 * Responsibilities: pick the sports to query, cache results, and degrade
 * gracefully. A provider failure yields an empty list plus an error code, never
 * an exception that takes the homepage down with it.
 */

import { cached } from '../../cache';
import { sportsConfig, todayInAppTimezone } from '../../config';
import { logger } from '../../logger';
import type { Game, SportId } from '../types';
import { SPORT_DEFINITIONS, sortGames } from './normalise';
import type { SportDefinition } from './normalise';
import { createTheSportsDbProvider } from './thesportsdb';
import type { SportsProvider } from './provider';

// The one place the concrete provider is chosen.
const provider: SportsProvider = createTheSportsDbProvider();

export interface GamesResult {
  date: string;
  games: Game[];
  failed: boolean;
}

function definitionsFor(sport: SportId): SportDefinition[] {
  if (sport === 'all') return [...SPORT_DEFINITIONS];
  return SPORT_DEFINITIONS.filter((definition) => definition.id === sport);
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
  const definitions = definitionsFor(sport);

  const results = await Promise.all(
    definitions.map(async (definition) => {
      try {
        const { value, hit } = await cached(
          `games:${provider.name}:${date}:${definition.id}`,
          sportsConfig.cacheTtlMs,
          () => provider.gamesOnDate(date, definition),
        );
        if (!hit) {
          logger.info('homepage_games_refreshed', {
            provider: provider.name,
            sport: definition.id,
            date,
            count: value.length,
          });
        }
        return { games: value, failed: false };
      } catch (error) {
        logger.error('homepage_games_failed', {
          provider: provider.name,
          sport: definition.id,
          date,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return { games: [] as Game[], failed: true };
      }
    }),
  );

  const games = sortGames(results.flatMap((result) => result.games));
  // Only a total failure is reported as an error; a partial result is still useful.
  const failed = results.length > 0 && results.every((result) => result.failed);

  return { date, games, failed };
}
