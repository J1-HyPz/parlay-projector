/**
 * Projection service.
 *
 *   fixtures (existing ESPN adapter)
 *        ↓
 *   completed results ──► ratings ──► projection ──► candidate selections
 *
 * Reuses the sports data layer wholesale: history and upcoming fixtures both
 * come from the shared ESPN adapter. No provider is called from a component,
 * and no second sports pipeline exists.
 *
 * Two things govern how much can be projected, and both are handled here.
 *
 * *How far back.* The window is per sport, because an NFL team plays seventeen
 * games across five months and an NBA team plays eighty in six. The request is
 * chunked, because the provider fails silently on long ranges — see
 * `fixturesForRange`.
 *
 * *What counts as history.* Competitions in the same rating pool are rated
 * together. Every football competition shares one, so a Champions League tie is
 * projected from the clubs' domestic results rather than from the handful of
 * European games they have played.
 *
 * Cost control matters: a page of parlays must not become hundreds of provider
 * requests. History windows that ended before today can never change and are
 * cached for days, so after the first warm-up only the current window is
 * refetched, and the ratings built from it are cached too.
 */

import { cached } from '../cache';
import { APP_TIMEZONE, projectionConfig, todayInAppTimezone } from '../config';
import { logger } from '../logger';
import { LEAGUES } from '../leagues/registry';
import type { League } from '../leagues/registry';
import { fixturesForRange } from '../providers/espn/fixtures';
import { addDays } from '../schedule/range';
import { modelConfigFor } from './config';
import type { SportModelConfig } from './config';
import { buildRatings, toResults } from './features';
import type { RatingSet } from './features';
import { candidateSelections, projectGame } from './project';
import type { ProjectionOutcome } from './project';
import type { Game, ConcreteSportId } from '../home/types';
import type { Selection } from './types';

/** Ratings change only when a game finishes. */
const RATINGS_TTL_MS = 3 * 60 * 60_000;
/** The window containing today; the only one that can still gain results. */
const CURRENT_WINDOW_TTL_MS = 3 * 60 * 60_000;
/** A window that ended before today is settled and will never change again. */
const SETTLED_WINDOW_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Refresh cadence, tightening as kick-off approaches.
 *
 * Nothing about a fixture three days out changes minute to minute, and polling
 * as if it did would hammer the provider for no gain.
 */
export function projectionTtlFor(startTime: string | null, now = Date.now()): number {
  if (!startTime) return projectionConfig.cacheTtlMs;
  const hours = (Date.parse(startTime) - now) / 3_600_000;
  if (!Number.isFinite(hours)) return projectionConfig.cacheTtlMs;

  if (hours > 24) return 6 * 60 * 60_000;
  if (hours > 6) return 2 * 60 * 60_000;
  return 30 * 60_000;
}

/** Completed results and upcoming fixtures for one competition. */
async function leagueGames(league: League, config: SportModelConfig): Promise<Game[]> {
  const today = todayInAppTimezone();

  try {
    return await fixturesForRange(
      league,
      addDays(today, -config.historyDays),
      addDays(today, 7),
      {
        currentTtlMs: CURRENT_WINDOW_TTL_MS,
        settledTtlMs: SETTLED_WINDOW_TTL_MS,
        today,
      },
    );
  } catch (error) {
    logger.warn('projection_history_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return [];
  }
}

/** Competitions rated together with this one. */
function poolFor(league: League, config: SportModelConfig): League[] {
  if (!config.ratingPool) return [league];

  return LEAGUES.filter((candidate) => {
    const other = modelConfigFor(candidate.sport);
    return other?.ratingPool === config.ratingPool;
  });
}

export interface PoolModel {
  /** Ratings built from every competition in the pool. */
  ratings: RatingSet;
  /** Upcoming fixtures, keyed by the league they belong to. */
  upcoming: Map<string, Game[]>;
}

/**
 * Ratings for a pool, built only from games that had already finished.
 *
 * `asOf` defaults to now. Backtests pass an earlier instant, and because
 * `toResults` filters on it, the ratings genuinely cannot see the result of the
 * game being projected.
 */
export async function buildPoolModel(
  league: League,
  asOf: number = Date.now(),
): Promise<PoolModel | null> {
  const config = modelConfigFor(league.sport);
  if (!config) return null;

  const pool = poolFor(league, config);

  const loaded = await Promise.all(
    pool.map(async (member) => ({
      league: member,
      games: await leagueGames(member, config),
    })),
  );

  const all = loaded.flatMap((entry) => entry.games);
  if (all.length === 0) return null;

  const key = pool.map((member) => member.id).join('+');
  const { value: ratings } = await cached(
    `projection:ratings:${key}:${Math.floor(asOf / RATINGS_TTL_MS)}`,
    RATINGS_TTL_MS,
    async () => buildRatings(toResults(all, asOf), config),
  );

  // Eligible fixtures only: scheduled, not yet started, inside the window.
  const upcoming = new Map<string, Game[]>();
  for (const entry of loaded) {
    upcoming.set(
      entry.league.id,
      entry.games.filter(
        (game) =>
          game.status === 'scheduled' &&
          game.start_time !== null &&
          Date.parse(game.start_time) > asOf,
      ),
    );
  }

  logger.info('projection_pool_built', {
    pool: key,
    results: ratings.sample,
    teams: ratings.ratings.size,
  });

  return { ratings, upcoming };
}

export interface CandidateResult {
  selections: Selection[];
  projections: ProjectionOutcome[];
  /** Competitions whose data could not be loaded; the rest still produced output. */
  failedLeagues: string[];
  /** Fixtures skipped for insufficient history, for the empty-state message. */
  skipped: number;
}

function leaguesFor(sport: ConcreteSportId | 'all'): League[] {
  const supported = LEAGUES.filter((league) => modelConfigFor(league.sport) !== null);
  return sport === 'all' ? supported : supported.filter((league) => league.sport === sport);
}

/**
 * Every model-backed selection across the eligible fixtures.
 *
 * Pools are built once and shared, so the nine football competitions cost one
 * set of ratings rather than nine. A pool failing leaves the others usable.
 */
export async function buildCandidates(
  sport: ConcreteSportId | 'all' = 'all',
  asOf: number = Date.now(),
): Promise<CandidateResult> {
  const leagues = leaguesFor(sport);
  const failedLeagues: string[] = [];
  const selections: Selection[] = [];
  const projections: ProjectionOutcome[] = [];
  let skipped = 0;

  // One entry per pool, so competitions sharing ratings are loaded once.
  const pools = new Map<string, League>();
  for (const league of leagues) {
    const config = modelConfigFor(league.sport);
    if (!config) continue;
    const key = config.ratingPool ?? league.id;
    if (!pools.has(key)) pools.set(key, league);
  }

  const models = await Promise.all(
    [...pools.entries()].map(async ([key, representative]) => {
      try {
        return { key, model: await buildPoolModel(representative, asOf) };
      } catch (error) {
        logger.warn('projection_pool_failed', {
          pool: key,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        failedLeagues.push(key);
        return { key, model: null };
      }
    }),
  );

  for (const { model } of models) {
    if (!model) continue;

    for (const league of leagues) {
      const config = modelConfigFor(league.sport);
      if (!config) continue;

      const fixtures = model.upcoming.get(league.id);
      if (!fixtures) continue;

      for (const game of fixtures) {
        const outcome = projectGame(game, model.ratings, config, {
          simulations: projectionConfig.simulations,
          now: new Date(asOf),
        });
        // Null means insufficient data. That fixture produces nothing — it is
        // never filled in with a fabricated estimate.
        if (!outcome) {
          skipped += 1;
          continue;
        }

        projections.push(outcome);
        selections.push(...candidateSelections(game, outcome, config));
      }
    }
  }

  logger.info('projection_candidates_built', {
    sport,
    pools: pools.size,
    projected: projections.length,
    skipped,
    selections: selections.length,
    failed: failedLeagues.length,
  });

  return { selections, projections, failedLeagues, skipped };
}

/**
 * Projection for one fixture, for the game detail page.
 *
 * Uses the fixture's own pool, so a Champions League tie is rated from the
 * clubs' domestic results.
 */
export async function projectionForGame(
  game: Game,
  asOf: number = Date.now(),
): Promise<ProjectionOutcome | null> {
  const config = modelConfigFor(game.sport);
  if (!config) return null;

  // The catalogue label is what a game carries, so match on that.
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (!league) return null;

  const { value } = await cached(
    `projection:game:${game.id}:${projectionConfig.modelVersion}`,
    projectionTtlFor(game.start_time, asOf),
    async () => {
      const model = await buildPoolModel(league, asOf);
      if (!model) return null;
      return projectGame(game, model.ratings, config, {
        simulations: projectionConfig.simulations,
        now: new Date(asOf),
      });
    },
  );

  return value;
}

export const projectionTimezone = APP_TIMEZONE;
