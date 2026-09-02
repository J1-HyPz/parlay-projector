/**
 * Projection service.
 *
 *   fixtures (existing ESPN adapter)
 *        ↓
 *   completed results ──► ratings ──► projection ──► candidate selections
 *
 * Reuses the sports data layer wholesale: history and upcoming fixtures both
 * come from `fixturesForLeague`, the same cached adapter Schedule, Home and the
 * hubs use. No provider is called from a component, and no second sports
 * pipeline exists.
 *
 * Cost control matters here — a page of parlays must not become hundreds of
 * provider requests. One request per league covers a whole season of history,
 * it is cached for hours, and the ratings derived from it are cached too, so
 * generating every risk level costs the same as generating one.
 */

import { cached } from '../cache';
import { APP_TIMEZONE, projectionConfig, todayInAppTimezone } from '../config';
import { logger } from '../logger';
import { LEAGUES } from '../leagues/registry';
import type { League } from '../leagues/registry';
import { fixturesForLeague } from '../providers/espn/fixtures';
import { addDays } from '../schedule/range';
import { modelConfigFor } from './config';
import { buildRatings, toResults } from './features';
import type { RatingSet } from './features';
import { candidateSelections, projectGame } from './project';
import type { ProjectionOutcome } from './project';
import type { Game, ConcreteSportId } from '../home/types';
import type { Selection } from './types';

/**
 * How far back ratings look.
 *
 * Long enough to cover a season in every supported sport, short enough that one
 * request per league still returns inside the provider's result cap.
 */
const HISTORY_DAYS = 200;

/** Ratings change only when a game finishes; hours of cache is right. */
const RATINGS_TTL_MS = 3 * 60 * 60_000;

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

/**
 * Completed results for a league, plus the fixtures still to come.
 *
 * One provider request covers both: the history window ends a week ahead, so
 * the same payload carries the games being projected.
 */
async function leagueGames(league: League): Promise<Game[]> {
  const today = todayInAppTimezone();
  const start = addDays(today, -HISTORY_DAYS);
  const end = addDays(today, 7);

  try {
    return await fixturesForLeague(league, start, end, RATINGS_TTL_MS);
  } catch (error) {
    logger.warn('projection_history_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return [];
  }
}

export interface LeagueModel {
  league: League;
  ratings: RatingSet;
  upcoming: Game[];
}

/**
 * Ratings for one league, built only from games that had already finished.
 *
 * `asOf` defaults to now. Backtests pass an earlier instant, and because
 * `toResults` filters on it, the ratings genuinely cannot see the result of the
 * game being projected.
 */
export async function buildLeagueModel(
  league: League,
  asOf: number = Date.now(),
): Promise<LeagueModel | null> {
  const config = modelConfigFor(league.sport);
  if (!config) return null;

  const games = await leagueGames(league);
  if (games.length === 0) return null;

  const { value } = await cached(
    `projection:ratings:${league.id}:${Math.floor(asOf / RATINGS_TTL_MS)}`,
    RATINGS_TTL_MS,
    async () => buildRatings(toResults(games, asOf), config),
  );

  // Eligible fixtures only: scheduled, not yet started, inside the window.
  const upcoming = games.filter(
    (game) =>
      game.status === 'scheduled' &&
      game.start_time !== null &&
      Date.parse(game.start_time) > asOf,
  );

  return { league, ratings: value, upcoming };
}

export interface CandidateResult {
  selections: Selection[];
  projections: ProjectionOutcome[];
  /** Leagues whose data could not be loaded; the rest still produced output. */
  failedLeagues: string[];
}

function leaguesFor(sport: ConcreteSportId | 'all'): League[] {
  const supported = LEAGUES.filter((league) => modelConfigFor(league.sport) !== null);
  return sport === 'all' ? supported : supported.filter((league) => league.sport === sport);
}

/**
 * Every model-backed selection across the eligible fixtures.
 *
 * Leagues are processed independently, so one failing leaves the rest usable.
 */
export async function buildCandidates(
  sport: ConcreteSportId | 'all' = 'all',
  asOf: number = Date.now(),
): Promise<CandidateResult> {
  const leagues = leaguesFor(sport);
  const failedLeagues: string[] = [];
  const selections: Selection[] = [];
  const projections: ProjectionOutcome[] = [];

  const models = await Promise.all(
    leagues.map(async (league) => {
      try {
        return await buildLeagueModel(league, asOf);
      } catch (error) {
        logger.warn('projection_model_failed', {
          league: league.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
        failedLeagues.push(league.id);
        return null;
      }
    }),
  );

  for (const model of models) {
    if (!model) continue;
    const config = modelConfigFor(model.league.sport);
    if (!config) continue;

    for (const game of model.upcoming) {
      const outcome = projectGame(game, model.ratings, config, {
        simulations: projectionConfig.simulations,
        now: new Date(asOf),
      });
      // Null means insufficient data. That fixture simply produces nothing —
      // it is never filled in with a fabricated estimate.
      if (!outcome) continue;

      projections.push(outcome);
      selections.push(...candidateSelections(game, outcome, config));
    }
  }

  logger.info('projection_candidates_built', {
    sport,
    leagues: leagues.length,
    projected: projections.length,
    selections: selections.length,
    failed: failedLeagues.length,
  });

  return { selections, projections, failedLeagues };
}

/**
 * Projection for one fixture, for the game detail page.
 *
 * Looks the game up in its own league's model rather than scanning everything,
 * so a detail page costs one league's cached history.
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
      const model = await buildLeagueModel(league, asOf);
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
