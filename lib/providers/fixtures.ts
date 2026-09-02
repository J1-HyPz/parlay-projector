/**
 * Fixture routing.
 *
 * One entry point for "give me this competition's games", dispatching on the
 * catalogue's `provider` field. Schedule, Home, Live, the hubs, the projection
 * engine and the settlement tracker all call through here and none of them
 * knows which provider answered — which is the point, and why adding a
 * competition on a new provider did not touch any of them.
 *
 * Both adapters emit the same normalised `Game`, cache their own responses, and
 * treat an out-of-season competition as empty rather than as a failure.
 */

import { fixturesForLeague as espnFixtures, fixturesForRange as espnRange } from './espn/fixtures';
import { fixturesForSportsdbLeague } from './thesportsdb/fixtures';
import type { League } from '../leagues/registry';
import type { Game } from '../home/types';

/**
 * Fixtures for a competition between two dates, inclusive.
 *
 * Ranges beyond a few weeks should use `fixturesForRange`, which chunks around
 * the ESPN provider's undocumented limits.
 */
export function fixturesForLeague(
  league: League,
  startDate: string,
  endDate: string,
  ttlMs: number,
): Promise<Game[]> {
  if (league.provider === 'thesportsdb') {
    return fixturesForSportsdbLeague(league, startDate, endDate, ttlMs);
  }
  return espnFixtures(league, startDate, endDate, ttlMs);
}

/**
 * Fixtures across an arbitrarily long range, for building ratings.
 *
 * The ESPN path chunks, because that provider fails silently on long requests.
 * TheSportsDB works by season and has no such limit, so it needs no chunking —
 * the season fetch already covers any range asked of it.
 */
export function fixturesForRange(
  league: League,
  startDate: string,
  endDate: string,
  options: { currentTtlMs: number; settledTtlMs: number; today: string },
): Promise<Game[]> {
  if (league.provider === 'thesportsdb') {
    // A season containing today can still gain results; an older one cannot.
    const ttl = endDate >= options.today ? options.currentTtlMs : options.settledTtlMs;
    return fixturesForSportsdbLeague(league, startDate, endDate, ttl);
  }
  return espnRange(league, startDate, endDate, options);
}
