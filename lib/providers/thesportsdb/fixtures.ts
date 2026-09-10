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
 *
 * One league is the exception to "one request": see `ROUND_FETCH_LEAGUES`.
 */

import { cached } from '../../cache.ts';
import { sportsConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { getJson, ProviderError } from '../../http.ts';
import { normaliseEvent } from '../../home/sports/normalise.ts';
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

function roundUrl(leagueId: string, season: string, round: number): string {
  const base = sportsConfig.baseUrl.replace(/\/+$/, '');
  return (
    `${base}/${sportsConfig.apiKey}/eventsround.php` +
    `?id=${encodeURIComponent(leagueId)}&r=${round}&s=${encodeURIComponent(season)}`
  );
}

function toGames(events: RawEvent[] | null | undefined, league: League): Game[] {
  const games: Game[] = [];
  for (const event of events ?? []) {
    // The catalogue label, not the provider's wording, so chips and badges
    // match the rest of the application.
    const game = normaliseEvent(event, league.sport, league.label);
    if (game) games.push(game);
  }
  return games;
}

async function fetchSeason(league: League, season: string, leagueId: string): Promise<Game[]> {
  const payload = await getJson<RawEventsResponse>(seasonUrl(leagueId, season), {
    timeoutMs: sportsConfig.timeoutMs,
    redactSecret: sportsConfig.apiKey,
  });
  return toGames(payload?.events, league);
}

/**
 * Competitions whose bulk `eventsseason.php` call cannot be trusted.
 *
 * The CFL's is checked and confirmed broken, not merely thin: every season
 * from 2021 to 2026 returned exactly five events, every one tagged as a
 * preseason fixture (`intRound: "500"`) from a single week in May, months
 * before the real June-to-November season. The league id is right — a real
 * CFL club looks itself up under it — and the season label is right too, an
 * individual event returned by a *different* endpoint carries the identical
 * season string this call had already been sent and had failed to return.
 * The season-level query is simply not finding what is otherwise there.
 *
 * `eventsround.php`, queried a round at a time, returns the real season —
 * confirmed for 2022 through 2025 with real teams, real scores, correct
 * in-season dates. 2021 alone still returns nothing by this method either;
 * that season is on record as pandemic-shortened and delayed, which may use
 * a round numbering this sweep does not reach, and was not chased further —
 * four seasons already clears what this application asks history for.
 *
 * Scoped to the CFL specifically because AFLE and EFA's season-level calls
 * are not broken; they are simply new competitions with one real season on
 * record, which is a fact about the competitions, not the endpoint. Applying
 * this workaround to them would cost extra requests to relearn the same
 * single season the cheap call already reports correctly.
 */
const ROUND_FETCH_LEAGUES: ReadonlySet<string> = new Set(['cfl']);

/** Whether a competition's fixtures must be assembled round by round. Pure, and the one decision in this file worth testing without a network. */
export function usesRoundFetch(leagueId: string): boolean {
  return ROUND_FETCH_LEAGUES.has(leagueId);
}

/**
 * Highest round worth asking for.
 *
 * The CFL's regular season ran through round 21 in the seasons checked
 * (an 18-game schedule spread across more rounds than games, once bye weeks
 * are accounted for), with rounds beyond that empty. Postseason games were
 * not found under any round number tried and may use a separate scheme this
 * sweep does not know about — stated as a real, accepted gap rather than
 * assumed covered.
 */
const MAX_ROUND = 25;

/** Stop after this many consecutive empty rounds; real data is contiguous from round 1. */
const EMPTY_ROUND_STREAK_LIMIT = 3;

/**
 * Attempts per round before giving up on it.
 *
 * The shared test key rate-limits on concurrency, and a sequential sweep of
 * twenty-odd rounds is enough to trip it. Backing off and retrying recovers
 * from that; treating the 429 as an empty round does not, and *looks* like a
 * competition with no fixtures.
 */
const ROUND_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A season assembled from its rounds, for the one competition whose bulk
 * season call cannot be trusted.
 *
 * Costs roughly twenty small requests instead of one. Sequential rather than
 * parallel, with a pause between them: TheSportsDB's shared test key is
 * documented elsewhere in this codebase as reliably rate-limiting above four
 * *concurrent* requests, and a tight burst of sequential ones is the same
 * risk from a different direction. A rate-limited round is backed off and
 * retried; a round that still cannot be read aborts the season rather than
 * counting as empty, because a swallowed 429 is indistinguishable from a
 * competition that played no games.
 */
async function fetchSeasonByRound(
  league: League,
  season: string,
  leagueId: string,
): Promise<Game[]> {
  const games: Game[] = [];
  let emptyStreak = 0;

  for (let round = 1; round <= MAX_ROUND; round += 1) {
    let events: RawEvent[] | null = null;
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= ROUND_ATTEMPTS; attempt += 1) {
      try {
        const payload = await getJson<RawEventsResponse>(roundUrl(leagueId, season, round), {
          timeoutMs: sportsConfig.timeoutMs,
          redactSecret: sportsConfig.apiKey,
        });
        events = Array.isArray(payload?.events) ? payload.events : [];
        break;
      } catch (error) {
        lastError = error;
        // Only a rate limit is worth waiting out; a 404 will still be a 404.
        const limited = error instanceof ProviderError && error.rateLimited;
        if (!limited || attempt === ROUND_ATTEMPTS) break;
        await sleep(RATE_LIMIT_BACKOFF_MS * attempt);
      }
    }

    /*
     * A round that could not be read is not an empty round.
     *
     * This used to be swallowed, and the consequence was a season that came
     * back with nothing at all and looked exactly like a competition with no
     * fixtures — which the history archive then wrote to disk as fact. An
     * unreadable round makes the whole season untrustworthy, so it is raised
     * and the caller decides: the live path already tolerates a season
     * failing, and the archive declines to record one it could not read.
     */
    if (events === null) {
      logger.warn('sportsdb_round_failed', {
        league: league.id,
        season,
        round,
        reason: lastError instanceof Error ? lastError.message : 'unknown',
      });
      throw new ProviderError(
        `round ${round} of ${season} could not be read: ${
          lastError instanceof Error ? lastError.message : 'unknown'
        }`,
      );
    }

    if (events.length === 0) {
      emptyStreak += 1;
      if (emptyStreak >= EMPTY_ROUND_STREAK_LIMIT) break;
    } else {
      emptyStreak = 0;
      games.push(...toGames(events, league));
    }

    if (round < MAX_ROUND) await sleep(200);
  }

  return games;
}

/**
 * One competition's fixtures for one season, cached under a key that reflects
 * which strategy actually produced them — so a fix or a regression in either
 * path invalidates only itself, not the other.
 */
async function fetchLeagueSeason(league: League, season: string, ttlMs: number): Promise<Game[]> {
  const leagueId = league.sportsdbLeagueId;
  if (!leagueId) return [];

  const byRound = usesRoundFetch(league.id);
  const { value } = await cached(
    `sportsdb:${byRound ? 'season-by-round' : 'season'}:${league.id}:${season}`,
    ttlMs,
    () =>
      byRound
        ? fetchSeasonByRound(league, season, leagueId)
        : fetchSeason(league, season, leagueId),
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
        return await fetchLeagueSeason(league, season, ttlMs);
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
