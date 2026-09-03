/**
 * Fetching bookmaker prices for the fixtures on screen.
 *
 * One request per competition covers its whole schedule window, the same shape
 * the fixtures adapter uses, and the result is cached for minutes rather than
 * hours: a price presented as current has to be current.
 *
 * Coverage is genuinely partial, and the application is built around that
 * rather than around a hope that it is not. At the time of writing the feed
 * carried prices for American football, college football, the WNBA and every
 * football competition, but none for baseball, ice hockey or college
 * basketball. A competition with no prices is not a failure — its selections
 * are simply reported as model projections whose availability is unverified,
 * which is the truth.
 *
 * Failures are swallowed to an empty map for the same reason. Prices are an
 * enhancement to a projection, never a precondition for one, so a provider
 * outage must degrade the labelling rather than withhold the analysis.
 */

import { cached } from '../cache';
import { espnConfig, oddsConfig } from '../config';
import { logger } from '../logger';
import { fetchEspn } from '../providers/espn/client';
import { compactDate, espnGameId } from '../providers/espn/fixtures';
import type { League } from '../leagues/registry';
import type { GameMarkets } from '../markets/types';
import { normaliseOddsResponse } from './normalise.ts';
import type { RawOddsResponse } from './normalise.ts';

/** Nothing to fetch: no odds, and no request made. */
const NONE: ReadonlyMap<string, GameMarkets> = new Map();

/**
 * Prices for one competition across a date range.
 *
 * Only competitions served by the primary provider are attempted; the
 * secondary provider carries fixtures and results but no prices, and asking it
 * would be a request guaranteed to return nothing.
 */
export async function marketsForLeague(
  league: League,
  startDate: string,
  endDate: string,
): Promise<ReadonlyMap<string, GameMarkets>> {
  if (!oddsConfig.enabled || !espnConfig.enabled) return NONE;
  if (league.provider !== 'espn' || !league.espnPath) return NONE;

  const range = `${compactDate(startDate)}-${compactDate(endDate)}`;

  try {
    const { value } = await cached(
      `odds:${league.id}:${range}`,
      oddsConfig.cacheTtlMs,
      async () => {
        const payload = await fetchEspn<RawOddsResponse>(
          `${league.espnPath}/scoreboard`,
          `dates=${range}&limit=200`,
        );
        const markets = normaliseOddsResponse(
          payload,
          (eventId) => espnGameId(league.id, eventId),
          new Date().toISOString(),
        );

        logger.info('odds_refreshed', {
          league: league.id,
          range,
          priced: markets.size,
        });

        // A Map does not survive being handed round as a cached value any
        // better than an array, but it is what callers want; the cache stores
        // the object itself, so this is fine.
        return markets;
      },
    );
    return value;
  } catch (error) {
    // Deliberately quiet at warn level: an out-of-season competition 404s
    // here exactly as it does for fixtures, and that is not a fault.
    logger.warn('odds_unavailable', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return NONE;
  }
}

/**
 * Prices across several competitions, merged.
 *
 * Sequential rather than parallel, matching how the projection service loads
 * its pools: these requests sit behind the same cache and cost wall-clock time
 * only on a cold start, and a burst of twenty simultaneous requests to one
 * provider is a good way to be rate-limited.
 */
export async function marketsForLeagues(
  leagues: readonly League[],
  startDate: string,
  endDate: string,
): Promise<Map<string, GameMarkets>> {
  const merged = new Map<string, GameMarkets>();
  if (!oddsConfig.enabled) return merged;

  for (const league of leagues) {
    const markets = await marketsForLeague(league, startDate, endDate);
    for (const [gameId, entry] of markets) merged.set(gameId, entry);
  }

  return merged;
}

/** Prices for a single fixture, for the game page and the builder. */
export async function marketsForGame(
  league: League,
  gameId: string,
  startDate: string,
  endDate: string,
): Promise<GameMarkets | null> {
  const markets = await marketsForLeague(league, startDate, endDate);
  return markets.get(gameId) ?? null;
}
