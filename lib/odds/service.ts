/**
 * Fetching bookmaker prices for the fixtures on screen.
 *
 * **Two sources, and which one answers depends on configuration.** With
 * `ODDS_API_KEY` set, prices come from UK bookmakers via `uk-books.ts` — Sky
 * Bet, William Hill, Paddy Power and the rest of that region. Without it, the
 * fallback is the prices the sports feed carries alongside its fixtures, which
 * an audit found to be DraftKings and nothing else: real prices, quoted in a
 * country most of this application's readers are not in.
 *
 * The fallback is kept rather than deleted because it is better than nothing
 * for a reader who *is* in the United States, and because removing the only
 * source before the replacement is configured would leave the application with
 * no prices at all. But it is second, and what it is gets said out loud rather
 * than presented as simply "the odds".
 *
 * One request per competition covers its whole schedule window, the same shape
 * the fixtures adapter uses, and the result is cached for minutes rather than
 * hours: a price presented as current has to be current.
 *
 * Coverage is genuinely partial, and the application is built around that
 * rather than around a hope that it is not. American football, college
 * football, the WNBA and every football competition are priced well ahead;
 * baseball, basketball and ice hockey are quoted much closer to the first
 * pitch, so the same competition is priced today and unpriced next week. That
 * is why availability is decided per fixture rather than per competition.
 *
 * A fixture with no prices is not a failure — its selections are reported as
 * model projections whose availability is unverified, which is the truth.
 *
 * Failures are swallowed to an empty map for the same reason. Prices are an
 * enhancement to a projection, never a precondition for one, so a provider
 * outage must degrade the labelling rather than withhold the analysis.
 */

import { cached } from '../cache';
import { espnConfig, oddsApiConfig, oddsConfig } from '../config';
import { logger } from '../logger';
import { fetchEspn } from '../providers/espn/client';
import { compactDate, espnGameId } from '../providers/espn/fixtures';
import type { League } from '../leagues/registry';
import type { GameMarkets } from '../markets/types';
import { getLeagueGames } from '../leagues/games.ts';
import { pricesLeague, ukMarketsForLeague } from './uk-books.ts';
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
  if (!oddsConfig.enabled) return NONE;

  /*
   * UK books first, when a key is configured.
   *
   * That provider shares no identifiers with the fixtures feed, so it needs
   * the fixtures themselves to join on. They come from the same cached
   * accessor the hubs use, so this is a cache hit rather than another
   * provider call in all but the coldest case.
   *
   * A key that returns nothing -- exhausted quota, an outage, a competition
   * this provider does not price -- falls through to the feed's own prices
   * rather than leaving the reader with none.
   */
  if (oddsApiConfig.key && pricesLeague(league.id)) {
    try {
      const { games } = await getLeagueGames([league]);
      const upcoming = games.filter((game) => game.status === 'scheduled');
      const { markets } = await ukMarketsForLeague(league, upcoming);
      if (markets.size > 0) return markets;
    } catch (error) {
      logger.warn('uk_odds_lookup_failed', {
        league: league.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  if (!espnConfig.enabled) return NONE;
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
 * How many competitions are asked for prices at once.
 *
 * Fully sequential put seven seconds on a cold candidate build across the
 * seventeen competitions the provider serves — a wait a reader would feel on
 * the first control change after a deploy. Fully parallel would fire all
 * seventeen at one provider simultaneously, which is a good way to be rate
 * limited. Four is the same bound the fixtures adapter settled on.
 */
const LEAGUE_CONCURRENCY = 4;

/**
 * Prices across several competitions, merged.
 *
 * Bounded concurrency rather than a burst. Each request sits behind the same
 * ten-minute cache, so this costs wall-clock time only on a cold start; the
 * bound is there so that cold start does not arrive at the provider as one
 * spike.
 */
export async function marketsForLeagues(
  leagues: readonly League[],
  startDate: string,
  endDate: string,
): Promise<Map<string, GameMarkets>> {
  const merged = new Map<string, GameMarkets>();
  if (!oddsConfig.enabled) return merged;

  /*
   * A competition qualifies if either source could price it. The ESPN filter
   * alone would have skipped anything the UK provider covers but the fixtures
   * feed does not, which is the wrong way round now that the UK source leads.
   */
  const queue = leagues.filter(
    (league) =>
      (league.provider === 'espn' && league.espnPath) ||
      (Boolean(oddsApiConfig.key) && pricesLeague(league.id)),
  );

  let next = 0;
  const workers = Array.from(
    { length: Math.min(LEAGUE_CONCURRENCY, queue.length) },
    async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= queue.length) return;

        // Never throws — a competition with no prices is the normal case and
        // must not take the others down with it.
        const markets = await marketsForLeague(queue[index], startDate, endDate);
        for (const [gameId, entry] of markets) merged.set(gameId, entry);
      }
    },
  );

  await Promise.all(workers);
  return merged;
}
