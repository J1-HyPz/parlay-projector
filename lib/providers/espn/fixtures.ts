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
import { compactDate, halveRange, normaliseFixtures, splitRange } from './fixture-normalise';
import type { RawFixtureResponse } from './fixture-normalise';

export {
  ESPN_ID_PREFIX,
  compactDate,
  halveRange,
  splitRange,
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
  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath) return [];

  const range = `${compactDate(startDate)}-${compactDate(endDate)}`;

  const { value, hit } = await cached(
    `espn:fixtures:${league.id}:${range}`,
    ttlMs,
    async () => {
      try {
        const payload = await fetchEspn<RawFixtureResponse>(
          `${espnPath}/scoreboard`,
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

// ---------------------------------------------------------------------------
// Long history
// ---------------------------------------------------------------------------

/**
 * Per-request event cap.
 *
 * The provider returns the *earliest* events when a range exceeds this, so a
 * capped response is silently missing everything recent. `fixturesForRange`
 * detects that and splits rather than accepting the truncation.
 */
const EVENT_LIMIT = 1000;

/**
 * Default window per request.
 *
 * Deliberately large. Comfortably inside the provider's ~1-year span limit, and
 * for most competitions one window returns a whole half-season well under the
 * event cap -- a football league plays ~380 games a season, so a 180-day
 * request is nowhere near 1000.
 *
 * High-volume competitions do exceed it, and the split-on-cap retry below
 * handles them automatically. Starting small instead would have made every
 * low-volume league pay for the few that are busy: nine football competitions
 * cost 27 requests this way against 90 at 45-day windows.
 */
const DEFAULT_CHUNK_DAYS = 180;

/**
 * Windows fetched at once.
 *
 * A whole pool warming at once was issuing ninety simultaneous requests, which
 * invites rate limiting and makes the first page load slow enough to look
 * broken. Bounded, results are cached, and after warm-up only the current
 * window is refetched.
 */
const WINDOW_CONCURRENCY = 4;

/** Run tasks with a bounded number in flight. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item !== undefined) results.push(await run(item));
    }
  });

  await Promise.all(workers);
  return results;
}

/** Guard against a pathological split loop; six halvings is well under a day. */
const MAX_SPLIT_DEPTH = 6;

async function fetchWindow(
  league: League,
  window: { start: string; end: string },
  ttlMs: number,
  depth: number,
): Promise<Game[]> {
  const espnPath = league.espnPath;
  if (!espnPath) return [];

  const range = `${compactDate(window.start)}-${compactDate(window.end)}`;

  const { value } = await cached(`espn:history:${league.id}:${range}`, ttlMs, async () => {
    try {
      const payload = await fetchEspn<RawFixtureResponse>(
        `${espnPath}/scoreboard`,
        `dates=${range}&limit=${EVENT_LIMIT}`,
      );
      const games = normaliseFixtures(payload, league);
      return { games, capped: (payload?.events?.length ?? 0) >= EVENT_LIMIT };
    } catch (error) {
      // Out of season for this window. Empty, not a failure.
      if (error instanceof ProviderError && error.status === 404) {
        return { games: [] as Game[], capped: false };
      }

      /*
       * Too much data for one request.
       *
       * A busy competition over a long window exceeds the response size cap
       * before it ever reaches the event cap, and that arrives as a thrown
       * error rather than a truncated payload — so the split below has to be
       * driven by it as well. Without this, a whole season of NBA, MLB, NHL
       * and college football history simply failed.
       */
      if (error instanceof ProviderError && error.tooLarge) {
        return { games: [] as Game[], capped: true };
      }

      throw error;
    }
  });

  if (!value.capped || depth >= MAX_SPLIT_DEPTH) return value.games;

  // The response hit the cap, so it is missing the later part of this window.
  logger.info('espn_history_split', { league: league.id, range, depth });
  const halves = halveRange(window);
  if (halves.length < 2) return value.games;

  const parts = await mapWithConcurrency(halves, WINDOW_CONCURRENCY, (half) =>
    fetchWindow(league, half, ttlMs, depth + 1),
  );
  return parts.flat();
}

/**
 * Every fixture for a league across an arbitrarily long range.
 *
 * Chunked, because the provider fails silently in two ways on a long request:
 * a range beyond about a year returns nothing at all, and any range is capped
 * at the earliest N events. Neither surfaces as an error, so a naive request
 * for a season of history returns a fortnight of it and looks fine.
 *
 * Windows entirely in the past are cached far longer than the one containing
 * today: a settled result never changes, so after the first warm-up only the
 * current window is refetched.
 */
export async function fixturesForRange(
  league: League,
  startDate: string,
  endDate: string,
  options: { currentTtlMs: number; settledTtlMs: number; today: string },
): Promise<Game[]> {
  if (!espnConfig.enabled) return [];

  const windows = splitRange(startDate, endDate, DEFAULT_CHUNK_DAYS);

  /*
   * One window failing must not discard the league.
   *
   * A burst of requests can draw a rate limit, and a single 429 in the middle
   * of a season used to reject the whole range — costing a competition its
   * entire history and every projection with it. Losing four months of results
   * is far better than losing sixteen, and the gap shows up as lower data
   * quality rather than as silence.
   */
  let failed = 0;
  const results = await mapWithConcurrency(windows, WINDOW_CONCURRENCY, async (window) => {
    try {
      return await fetchWindow(
        league,
        window,
        // A window that ended before today can never change again.
        window.end < options.today ? options.settledTtlMs : options.currentTtlMs,
        0,
      );
    } catch (error) {
      failed += 1;
      logger.warn('espn_history_window_failed', {
        league: league.id,
        window: `${window.start}..${window.end}`,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return [] as Game[];
    }
  });

  // Every window failing is a genuine outage for this competition, and the
  // caller should see it as one rather than as an empty season.
  if (failed === windows.length && windows.length > 0) {
    throw new ProviderError(`history unavailable for ${league.id}`, null);
  }

  // De-duplicate: overlapping windows and split retries can return a fixture
  // more than once, and a doubled result would distort every rating.
  const seen = new Map<string, Game>();
  for (const game of results.flat()) seen.set(game.id, game);

  const games = [...seen.values()];
  logger.info('espn_history_loaded', {
    league: league.id,
    windows: windows.length,
    failed,
    games: games.length,
  });
  return games;
}
