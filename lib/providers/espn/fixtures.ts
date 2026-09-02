/**
 * ESPN fixtures adapter.
 *
 * Why this exists: TheSportsDB's day feed returns **no NFL games at all** —
 * only NCAA Division 1 and CFL appear under "American Football" — so an NFL
 * filter correctly matched nothing and the league looked empty. ESPN has them.
 *
 * It is also cheaper. ESPN accepts `dates=YYYYMMDD-YYYYMMDD`, so one request
 * covers a league's whole eight-day window. Fifteen leagues cost fifteen
 * requests, against the forty-eight the per-sport-per-day approach needed.
 *
 * Normalisation and the game-id helpers live in `fixture-normalise.ts`, which
 * has no runtime imports so it can be unit-tested directly.
 */

import { cached } from '../../cache';
import { espnConfig } from '../../config';
import { logger } from '../../logger';
import type { Game } from '../../home/types';
import type { League } from '../../leagues/registry';
import { ProviderError } from '../../http';
import { fetchEspn } from './client';
import { compactDate, normaliseFixtures } from './fixture-normalise';
import type { RawFixtureResponse } from './fixture-normalise';

export {
  ESPN_ID_PREFIX,
  compactDate,
  espnGameId,
  isEspnGameId,
  normaliseFixture,
  normaliseFixtures,
  parseEspnGameId,
  statusFromEspn,
} from './fixture-normalise';
export type {
  ParsedEspnGameId,
  RawFixtureEvent,
  RawFixtureResponse,
} from './fixture-normalise';

/**
 * Every fixture for a league between two dates, inclusive.
 *
 * One request per league for the whole range, cached, so a schedule refresh
 * costs one call per competition rather than one per competition per day.
 */
export async function fixturesForLeague(
  league: League,
  startDate: string,
  endDate: string,
  ttlMs: number,
): Promise<Game[]> {
  if (!espnConfig.enabled) return [];

  const range = `${compactDate(startDate)}-${compactDate(endDate)}`;

  const { value, hit } = await cached(
    `espn:fixtures:${league.id}:${range}`,
    ttlMs,
    async () => {
      try {
        const payload = await fetchEspn<RawFixtureResponse>(
          `${league.espnPath}/scoreboard`,
          `dates=${range}&limit=200`,
        );
        return normaliseFixtures(payload, league);
      } catch (error) {
        // An out-of-season competition 404s on a date range — NCAA basketball
        // does this all summer. That is "no fixtures", not a provider failure,
        // so it must not count towards the schedule's error state.
        if (error instanceof ProviderError && error.status === 404) {
          logger.info('espn_fixtures_out_of_season', { league: league.id, range });
          return [] as Game[];
        }
        throw error;
      }
    },
  );

  if (!hit) {
    logger.info('espn_fixtures_refreshed', {
      league: league.id,
      range,
      games: value.length,
    });
  }
  return value;
}
