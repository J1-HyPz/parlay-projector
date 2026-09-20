/**
 * ESPN fixtures adapter.
 *
 * Why this exists: TheSportsDB's day feed returns **no NFL games at all** —
 * only NCAA Division 1 and CFL appear under "American Football" — so an NFL
 * filter correctly matched nothing and the league looked empty. ESPN has them.
 *
 * Fixtures are fetched **one date at a time**, and that is not the cheap way.
 * It is the way that returns the fixtures.
 *
 * This used to send `dates=YYYYMMDD-YYYYMMDD`, one request per league per
 * window, which the provider answered for years and now answers with zero
 * events for every team competition — verified 2026-09-20 across the NFL, NCAA
 * football, the NBA, MLB and two soccer competitions, while the same dates
 * asked for singly return their games. Nothing failed: a range simply comes
 * back empty, so the schedule, the hubs and every projection went quiet
 * without a single error to show for it.
 *
 * The bulk forms that still work were measured and rejected. `dates=YYYYMM`
 * is complete for the NFL (48 of 48) and MLB (369 of 369) and returns 25 of
 * college football's 139; `dates=YYYY` is capped at the earliest events, so
 * MLB's season query misses September entirely. A form that is complete for
 * some competitions and quietly lossy for others is worse than an expensive
 * one, because nothing downstream can tell which it got.
 *
 * So: one request per league per date, deduplicated, with every past date
 * cached for a week because it can never change again. A cold season of
 * history costs far more requests than it did; a warm one costs almost none.
 *
 * Normalisation and the game-id helpers live in `fixture-normalise.ts`, which
 * has no runtime imports so it can be unit-tested directly.
 */

import { cached } from '../../cache.ts';
import { espnConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import type { Game } from '../../home/types';
import type { League } from '../../leagues/registry';
import { ProviderError } from '../../http.ts';
import { fetchEspn } from './client.ts';
import { compactDate, normaliseFixtures } from './fixture-normalise.ts';
import type { RawFixtureResponse } from './fixture-normalise';
import { normaliseRaceFixtures } from './racing.ts';
import type { RawRaceResponse } from './racing';
import { normaliseBoutFixtures } from './bouts.ts';
import type { RawBoutResponse } from './bouts';
import { normaliseTennisFixtures } from './tennis.ts';
import type { RawTennisResponse } from './tennis';

/**
 * Read a scoreboard payload according to how the competition is contested.
 *
 * A race weekend is one event carrying several sessions, each with a field
 * rather than two sides. A fight card is one event carrying several fights,
 * each with two sides and no score. Every shape comes from the same endpoint,
 * so the choice is made here — once — rather than at each of the places that
 * fetch one.
 */
function normalisePayload(
  payload: RawFixtureResponse & RawRaceResponse & RawBoutResponse & RawTennisResponse,
  league: League,
): Game[] {
  if (league.format === 'race') return normaliseRaceFixtures(payload, league);
  if (league.format === 'bout') return normaliseBoutFixtures(payload, league);
  if (league.format === 'match') {
    /*
     * A tournament payload holds every draw it ran, so the competition is the
     * tour *and* the draw. Without one there is nothing to read, and returning
     * the whole tournament would mix doubles pairs into a singles competition.
     */
    return league.espnDraw ? normaliseTennisFixtures(payload, league, league.espnDraw) : [];
  }
  return normaliseFixtures(payload, league);
}

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
} from './fixture-normalise.ts';
export type {
  ParsedEspnGameId,
  RawFixtureEvent,
  RawFixtureResponse,
} from './fixture-normalise.ts';

/**
 * Every fixture for a league between two dates, inclusive.
 *
 * One request per league for the whole range, cached, so a schedule refresh
 * costs one call per competition rather than one per competition per day.
 */
/** Every date from `start` to `end` inclusive, as `YYYYMMDD`. */
export function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const last = Date.parse(`${end}T00:00:00Z`);
  let cursor = Date.parse(`${start}T00:00:00Z`);
  if (!Number.isFinite(cursor) || !Number.isFinite(last)) return dates;

  // A long history window is hundreds of dates; a runaway loop would be worse
  // than a short answer, so the span is bounded rather than trusted.
  while (cursor <= last && dates.length < MAX_DATES) {
    dates.push(compactDate(new Date(cursor).toISOString().slice(0, 10)));
    cursor += 86_400_000;
  }
  return dates;
}

/** Roughly three years, which is longer than anything here asks for. */
const MAX_DATES = 1100;

/**
 * One league on one date.
 *
 * Cached per league and date, which is a better key than the range it
 * replaced: a date in the past can never gain or lose a fixture, so its entry
 * stays valid for as long as it is held.
 */
async function fixturesOnDate(
  league: League,
  date: string,
  ttlMs: number,
): Promise<Game[]> {
  const espnPath = league.espnPath;
  if (!espnPath) return [];

  const { value } = await cached(`espn:fixtures:${league.id}:${date}`, ttlMs, async () => {
    try {
      const payload = await fetchEspn<
        RawFixtureResponse & RawRaceResponse & RawBoutResponse & RawTennisResponse
      >(`${espnPath}/scoreboard`, `dates=${date}&limit=${EVENT_LIMIT}`);
      return normalisePayload(payload, league);
    } catch (error) {
      // An out-of-season competition 404s — NCAA basketball does this all
      // summer. That is "no fixtures", not a provider failure, so it must not
      // count towards the schedule's error state.
      if (error instanceof ProviderError && error.status === 404) return [] as Game[];
      throw error;
    }
  });

  return value;
}

/**
 * Fetch a set of dates and merge them.
 *
 * Shared by the schedule window and the history walk, so both ask the provider
 * the same way and neither can drift into a form the other has disproved.
 *
 * One date failing does not discard the rest: a burst can draw a rate limit,
 * and losing a day of a season is far better than losing the season. The
 * caller is told how many failed so a total outage still reads as one.
 */
async function fixturesForDates(
  league: League,
  dates: readonly string[],
  ttlFor: (date: string) => number,
): Promise<{ games: Game[]; failed: number }> {
  let failed = 0;

  const results = await mapWithConcurrency(dates, DATE_CONCURRENCY, async (date) => {
    try {
      return await fixturesOnDate(league, date, ttlFor(date));
    } catch (error) {
      failed += 1;
      logger.warn('espn_fixtures_date_failed', {
        league: league.id,
        date,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      return [] as Game[];
    }
  });

  /*
   * De-duplicate on the fixture id.
   *
   * A fixture near midnight is returned by the provider on both of the dates
   * it straddles in different timezones, and counting one twice would distort
   * every rating built from it.
   */
  const seen = new Map<string, Game>();
  for (const game of results.flat()) seen.set(game.id, game);

  return { games: [...seen.values()], failed };
}

export async function fixturesForLeague(
  league: League,
  startDate: string,
  endDate: string,
  ttlMs: number,
): Promise<Game[]> {
  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath) return [];

  const dates = datesBetween(startDate, endDate);

  /*
   * The merged window, memoised over the per-date entries beneath it.
   *
   * Asking per date made a *warm* read cost a cache lookup per day plus a
   * merge across every game in the window, where it used to cost one lookup.
   * That is fine once and expensive on every rebuild — and the candidate set
   * rebuilds on a five-minute bucket, so it is paid often. The dates below
   * still hold the provider's answers; this holds the answer to the question
   * that was actually asked.
   */
  const { value, hit } = await cached(
    `espn:window:${league.id}:${compactDate(startDate)}:${compactDate(endDate)}`,
    ttlMs,
    async () => {
      const { games, failed } = await fixturesForDates(league, dates, () => ttlMs);

      // Every date failing is an outage rather than an empty week, and the
      // schedule's error state depends on being able to tell them apart.
      if (failed === dates.length && dates.length > 0) {
        throw new ProviderError(`fixtures unavailable for ${league.id}`, null);
      }
      return { games, failed };
    },
  );

  if (!hit) {
    logger.info('espn_fixtures_refreshed', {
      league: league.id,
      dates: dates.length,
      failed: value.failed,
      games: value.games.length,
    });
  }
  return value.games;
}

// ---------------------------------------------------------------------------
// Long history
// ---------------------------------------------------------------------------

/**
 * Per-request event cap.
 *
 * One date never approaches this — the busiest day here is a college football
 * Saturday — so it is a guard rather than a mechanism. The splitting this used
 * to drive is gone with the ranges that needed it.
 */
const EVENT_LIMIT = 1000;

/**
 * Dates fetched at once.
 *
 * A season of history is now hundreds of requests rather than two, so this
 * matters more than it did. Four keeps a cold warm-up off the provider's rate
 * limit while staying fast enough that a page does not look broken; every
 * settled date is then cached for a week and never asked for again.
 */
const DATE_CONCURRENCY = 4;

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

/**
 * Every fixture for a league across an arbitrarily long range.
 *
 * Asked one date at a time, for the reason in the module header: the provider
 * answers a date range with zero events. Dates before today are cached for far
 * longer than today's, because a settled day can never gain a fixture — so a
 * warm history costs a handful of requests however long the window is.
 */
export async function fixturesForRange(
  league: League,
  startDate: string,
  endDate: string,
  options: { currentTtlMs: number; settledTtlMs: number; today: string },
): Promise<Game[]> {
  if (!espnConfig.enabled) return [];

  const dates = datesBetween(startDate, endDate);
  const today = compactDate(options.today);
  const key = `espn:history:${league.id}:${compactDate(startDate)}:${compactDate(endDate)}`;

  /*
   * One date failing must not discard the league.
   *
   * A burst of requests can draw a rate limit, and a single 429 in the middle
   * of a season used to reject the whole range — costing a competition its
   * entire history and every projection with it. Losing a day of results is
   * far better than losing sixteen months, and the gap shows up as lower data
   * quality rather than as silence.
   */
  /*
   * Memoised over the dates, for the reason in `fixturesForLeague`: a season
   * is four hundred cache reads and a merge of several thousand fixtures, and
   * a rebuild should not pay that to learn what it already knows. Held for the
   * current window's lifetime, which is the shortest of the two -- the settled
   * dates underneath outlive it and make the refresh cheap.
   */
  const { value, hit } = await cached(key, options.currentTtlMs, async () => {
    const { games, failed } = await fixturesForDates(league, dates, (date) =>
      date < today ? options.settledTtlMs : options.currentTtlMs,
    );

    // Every date failing is a genuine outage for this competition, and the
    // caller should see it as one rather than as an empty season.
    if (failed === dates.length && dates.length > 0) {
      throw new ProviderError(`history unavailable for ${league.id}`, null);
    }
    return { games, failed };
  });

  if (!hit) {
    logger.info('espn_history_loaded', {
      league: league.id,
      dates: dates.length,
      failed: value.failed,
      games: value.games.length,
    });
  }
  return value.games;
}

