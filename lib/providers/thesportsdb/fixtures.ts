/**
 * TheSportsDB fixtures adapter.
 *
 * Serves the competitions ESPN does not carry — the CFL, the American Football
 * League Europe and the European Football Alliance. ESPN holds CFL *teams* but
 * publishes no fixtures or results for it at all, so without this those
 * competitions could not appear anywhere in the application.
 *
 * Emits the same normalised `Game` objects the ESPN adapter does, through the
 * same normaliser the day feed already uses, so nothing downstream — Schedule,
 * Live, the hubs, the projection engine — knows or cares which provider a
 * fixture came from.
 *
 * The provider works by *season*, not by date range: there is no equivalent of
 * ESPN's `dates=` parameter. A whole season is fetched and filtered locally,
 * which is cheap because a season is one request and settled seasons never
 * change.
 */

import { cached } from '../../cache';
import { sportsConfig } from '../../config';
import { logger } from '../../logger';
import { getJson } from '../../http';
import { normaliseEvent } from '../../home/sports/normalise';
import type { RawEvent, RawEventsResponse } from '../../home/sports/normalise';
import type { League } from '../../leagues/registry';
import type { Game } from '../../home/types';

/**
 * Seasons a date range touches.
 *
 * These competitions all run within a single calendar year — the CFL from June
 * to November, the European leagues over the summer — so the season label is
 * the year. A range spanning a new year needs both.
 */
export function seasonsForRange(startDate: string, endDate: string): string[] {
  const first = Number.parseInt(startDate.slice(0, 4), 10);
  const last = Number.parseInt(endDate.slice(0, 4), 10);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return [];

  // Guard against a malformed range asking for a century of seasons.
  const span = Math.min(last - first, 5);
  return Array.from({ length: span + 1 }, (_, index) => String(first + index));
}

/**
 * The provider puts the API key in the URL path.
 *
 * `redactSecret` is passed to the request helper so the key never reaches a log
 * line, which is the whole reason this goes through the shared helper.
 */
function seasonUrl(leagueId: string, season: string): string {
  const base = sportsConfig.baseUrl.replace(/\/+$/, '');
  return (
    `${base}/${sportsConfig.apiKey}/eventsseason.php` +
    `?id=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`
  );
}

async function fetchSeason(league: League, season: string, ttlMs: number): Promise<Game[]> {
  const leagueId = league.sportsdbLeagueId;
  if (!leagueId) return [];

  const { value } = await cached(
    `sportsdb:season:${league.id}:${season}`,
    ttlMs,
    async () => {
      const payload = await getJson<RawEventsResponse>(seasonUrl(leagueId, season), {
        timeoutMs: sportsConfig.timeoutMs,
        redactSecret: sportsConfig.apiKey,
      });

      const events: RawEvent[] = Array.isArray(payload?.events) ? payload.events : [];

      const games: Game[] = [];
      for (const event of events) {
        // The catalogue label, not the provider's wording, so chips and badges
        // match the rest of the application.
        const game = normaliseEvent(event, league.sport, league.label);
        if (game) games.push(game);
      }
      return games;
    },
  );

  return value;
}

/**
 * Fixtures for one competition between two dates, inclusive.
 *
 * Matches the ESPN adapter's signature so the router can treat them alike.
 * Returns an empty list rather than throwing when the provider has nothing for
 * a season — an out-of-season competition is not a failure.
 */
export async function fixturesForSportsdbLeague(
  league: League,
  startDate: string,
  endDate: string,
  ttlMs: number,
): Promise<Game[]> {
  const seasons = seasonsForRange(startDate, endDate);
  if (seasons.length === 0) return [];

  const results = await Promise.all(
    seasons.map(async (season) => {
      try {
        return await fetchSeason(league, season, ttlMs);
      } catch (error) {
        // One season failing must not discard the others.
        logger.warn('sportsdb_season_failed', {
          league: league.id,
          season,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        return [] as Game[];
      }
    }),
  );

  // Clamp to the requested window, and de-duplicate across seasons.
  const seen = new Map<string, Game>();
  for (const game of results.flat()) {
    const date = game.start_time?.slice(0, 10);
    if (!date || date < startDate || date > endDate) continue;
    seen.set(game.id, game);
  }

  const games = [...seen.values()];
  logger.info('sportsdb_fixtures_loaded', {
    league: league.id,
    seasons: seasons.length,
    games: games.length,
  });
  return games;
}
