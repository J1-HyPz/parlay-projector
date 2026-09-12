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
import { resolveScope } from '../leagues/catalogue';
import type { ParlayScope } from '../leagues/catalogue';
import { fixturesForRange } from '../providers/fixtures';
import { addDays } from '../schedule/range';
import { modelConfigFor, modelConfigForLeague } from './config';
import type { SportModelConfig } from './config';
import { buildRatings, gamesNeeded, toResults } from './features';
import type { RatingSet } from './features';
import { candidateSelections, projectGame } from './project';
import type { ProjectionOutcome } from './project';
import { marketsForLeagues } from '../odds/service';
import { leagueAvailability } from '../providers/espn/availability';
import type { LeagueAvailability } from '../providers/espn/availability';
import { announcedStarters, pitchersForFixture } from '../providers/espn/pitchers';
import type { AnnouncedStarters } from '../providers/espn/pitchers';
import { compactDate } from '../providers/espn/fixture-normalise';
import { conditionsForGames } from '../providers/weather';
import type { FixtureConditions } from './weather';
import type { SquadNews } from './features';
import type { FixturePitchers } from './pitchers';
import { buildRaceRatings, RACE_CONFIG, toRaceResults } from './race-model';
import type { RaceRatings } from './race-model';
import { gridFrom, projectRace, raceSelections } from './race-selections';
import type { RaceOutcome } from './race-selections';
import { boutConfigForLeague, buildBoutRatings, toBoutResults } from './bout-model';
import type { BoutRatings } from './bout-model';
import { boutSelections, projectContest } from './bout-selections';
import type { BoutOutcome } from './bout-selections';
import type { GameMarkets } from '../markets/types';
import { sidesOf } from '../home/types';
import type { Game, ConcreteSportId } from '../home/types';
import type { GameProjection, Selection } from './types';

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
    const other = modelConfigForLeague(candidate.id, candidate.sport);
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
  const config = modelConfigForLeague(league.id, league.sport);
  if (!config) return null;

  const pool = poolFor(league, config);

  /*
   * Sequential across the pool.
   *
   * Each league already fetches its own windows with bounded concurrency, so
   * running nine football competitions in parallel multiplied that by nine. The
   * whole thing is cached hard, so this costs wall-clock only on a cold start.
   */
  const loaded: { league: League; games: Game[] }[] = [];
  for (const member of pool) {
    loaded.push({ league: member, games: await leagueGames(member, config) });
  }

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

/**
 * Which sport and competition a build is confined to.
 *
 * `league` is a catalogue id, never a display name: "Premier League" is what a
 * competition is called this season, `epl` is what it is.
 */
export interface CandidateFilter {
  sport: ConcreteSportId | 'all';
  /** Catalogue league id, or null/absent for every competition in the sport. */
  league?: string | null;
}

export interface CandidateResult {
  selections: Selection[];
  /**
   * The projections behind them.
   *
   * Deliberately the projection only, not the simulated distribution. A
   * distribution is four arrays of ten thousand numbers, and holding one per
   * fixture in a cached result put tens of megabytes behind a five-minute key
   * for the sake of a field almost nothing read. Anything needing the
   * distribution — a same-game combination, the market explorer — asks for one
   * fixture at a time through `gameCandidates`.
   */
  projections: GameProjection[];
  /** Competitions whose data could not be loaded; the rest still produced output. */
  failedLeagues: string[];
  /** Fixtures skipped for insufficient history, for the empty-state message. */
  skipped: number;
  /** Fixtures a bookmaker was quoting prices for. */
  pricedGames: number;
}

/**
 * What a request is allowed to draw on.
 *
 * A filter is binding, not advisory: whatever comes back from here is the
 * entire universe the rest of the build sees. There is no later stage that
 * could reach past it — which is the point. Someone who asked for the Premier
 * League and got two eligible matches must be told there were two, never
 * quietly handed a third leg from the NBA because it scored better.
 *
 * An unresolvable filter yields nothing rather than everything. Failing open
 * here would mean a typo in a league id silently returned the whole card.
 */
export function scopeFor(filter: CandidateFilter): ParlayScope {
  const scope = resolveScope(filter.sport, filter.league ?? null);
  return scope ?? { sport: filter.sport, league: filter.league ?? null, leagues: [] };
}

/** Competitions in scope that the scoring model can project. */
function fixtureLeagues(scope: ParlayScope): League[] {
  return scope.leagues.filter(
    (league) => modelConfigForLeague(league.id, league.sport) !== null,
  );
}

/**
 * How long a built candidate set is reused.
 *
 * Building one simulates every eligible fixture ten thousand times — with two
 * hundred fixtures that is millions of simulated games, and it was previously
 * repeated on *every* request. Changing risk level, leg count or day does not
 * change a single projection, so all of them now share one build.
 *
 * Five minutes is far tighter than the per-fixture projection TTLs it sits in
 * front of, so nothing goes stale that would not have anyway.
 */
const CANDIDATES_TTL_MS = 5 * 60_000;

/**
 * Every model-backed selection across the eligible fixtures.
 *
 * Cached: the simulations are seeded from the game id and so are deterministic,
 * which means a cached set is identical to a rebuilt one. The cache also
 * de-duplicates concurrent requests, so several controls changed in quick
 * succession share a single build rather than queueing several.
 */
export async function buildCandidates(
  filter: CandidateFilter = { sport: 'all' },
  asOf: number = Date.now(),
): Promise<CandidateResult> {
  const league = filter.league ?? 'all';
  const { value } = await cached(
    `projection:candidates:${filter.sport}:${league}:${projectionConfig.modelVersion}:${Math.floor(
      asOf / CANDIDATES_TTL_MS,
    )}`,
    CANDIDATES_TTL_MS,
    () => computeCandidates(filter, asOf),
  );
  return value;
}

/**
 * One fixture's squad news, pulled out of its competition's report.
 *
 * Null when the competition is not covered, and null again when either side
 * cannot be identified — an unidentified team's absences cannot be attributed
 * to it, and guessing would put one club's injuries against another's name.
 * A team absent from the map is covered and simply has nobody listed, which is
 * an empty list rather than a null.
 */
function squadNewsFor(report: LeagueAvailability, game: Game): SquadNews | null {
  if (!report) return null;
  const homeId = game.home_team?.id ?? null;
  const awayId = game.away_team?.id ?? null;
  if (!homeId || !awayId) return null;

  return {
    home: report.get(homeId) ?? [],
    away: report.get(awayId) ?? [],
  };
}

/**
 * Announced starters for the fixtures about to be projected.
 *
 * Baseball only, and empty for every other competition — the substitution
 * exists for the one sport where a single participant accounts for most of a
 * side's defensive innings, and no other sport here publishes a starter ahead
 * of the fixture anyway.
 *
 * Keyed by the dates the fixtures fall on rather than by fixture, so a whole
 * slate costs one request per date instead of one per game.
 */
async function startersFor(
  leagues: readonly League[],
  games: readonly Game[],
): Promise<Map<string, AnnouncedStarters>> {
  if (!leagues.some((league) => league.id === 'mlb')) return new Map();

  const dates = new Set<string>();
  for (const game of games) {
    if (game.sport !== 'mlb') continue;
    const day = game.start_time?.slice(0, 10);
    if (day) dates.add(compactDate(day));
  }
  if (dates.size === 0) return new Map();

  return announcedStarters([...dates]);
}

async function computeCandidates(
  filter: CandidateFilter,
  asOf: number,
): Promise<CandidateResult> {
  const scope = scopeFor(filter);
  const leagues = fixtureLeagues(scope);
  const failedLeagues: string[] = [];
  const selections: Selection[] = [];
  const projections: GameProjection[] = [];
  let skipped = 0;

  /*
   * Bookmaker prices for the fixtures that could appear.
   *
   * Only the forward window, which is where the eligible fixtures are — there
   * is no point asking for prices on games that have already been played. A
   * competition with no prices returns nothing and its selections come out as
   * model projections, which is the honest description of them.
   */
  const today = todayInAppTimezone();
  let quotes = new Map<string, GameMarkets>();
  try {
    quotes = await marketsForLeagues(leagues, today, addDays(today, 7));
  } catch (error) {
    logger.warn('odds_lookup_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  /*
   * Squad availability, one request per competition rather than per fixture.
   *
   * The game page reads this out of the per-fixture summary it already
   * fetches; a slate cannot, so it uses the competition-wide report instead.
   * A failure yields null for that competition and the projections there
   * simply say no availability data was published, which is true of them.
   */
  const availability = new Map<string, LeagueAvailability>();
  await Promise.all(
    leagues.map(async (league) => {
      availability.set(league.id, await leagueAvailability(league));
    }),
  );

  // One entry per pool, so competitions sharing ratings are loaded once.
  const pools = new Map<string, League>();
  for (const league of leagues) {
    const config = modelConfigForLeague(league.id, league.sport);
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

  /*
   * Starting pitchers, resolved once per fixture before the projection loop.
   *
   * Done here rather than inside the loop so that loop stays synchronous and
   * so the gamelog for a pitcher starting on two different days is fetched
   * once. Everything is cached behind these calls, so a warm slate costs
   * nothing.
   */
  const allFixtures: Game[] = [];
  for (const { model } of models) {
    if (!model) continue;
    for (const list of model.upcoming.values()) allFixtures.push(...list);
  }

  /*
   * Conditions, one request per city rather than per fixture.
   *
   * Only for competitions whose config carries a measured weather rule, and
   * only for fixtures the provider says are open-air — there is no point
   * forecasting the weather for a dome.
   */
  const weatherable = allFixtures.filter((game) => {
    const config = modelConfigFor(game.sport);
    return Boolean(config?.weather) && game.venue?.indoor === false;
  });
  const conditions = await conditionsForGames(weatherable);

  const starters = await startersFor(leagues, allFixtures);
  const pitcherRates = new Map<string, FixturePitchers | null>();
  await Promise.all(
    allFixtures.map(async (game) => {
      if (game.sport !== 'mlb' || !game.start_time) return;
      const kickoff = Date.parse(game.start_time);
      if (!Number.isFinite(kickoff)) return;
      pitcherRates.set(game.id, await pitchersForFixture(starters.get(game.id), kickoff));
    }),
  );

  for (const { model } of models) {
    if (!model) continue;

    for (const league of leagues) {
      const config = modelConfigForLeague(league.id, league.sport);
      if (!config) continue;

      const fixtures = model.upcoming.get(league.id);
      if (!fixtures) continue;

      for (const game of fixtures) {
        const outcome = projectGame(game, model.ratings, config, {
          simulations: projectionConfig.simulations,
          availability: squadNewsFor(availability.get(league.id) ?? null, game),
          pitchers: pitcherRates.get(game.id) ?? null,
          conditions: conditions.get(game.id) ?? null,
          now: new Date(asOf),
        });
        // Null means insufficient data. That fixture produces nothing — it is
        // never filled in with a fabricated estimate.
        if (!outcome) {
          skipped += 1;
          continue;
        }

        projections.push(outcome.projection);
        selections.push(
          ...candidateSelections(game, outcome, config, quotes.get(game.id) ?? null, asOf).map(
            // Stamped here because this is the one place that holds the
            // competition itself rather than the label a fixture carries.
            (selection) => ({ ...selection, league_id: league.id }),
          ),
        );
      }
    }
  }

  // Races are a separate model on the same pipeline: same fixtures adapter,
  // same cache, same Selection shape out the other end.
  selections.push(...(await raceCandidates(scope, asOf)));

  // So are fights and tennis matches, on the third model.
  const bouts = await boutCandidates(scope, asOf);
  selections.push(...bouts.selections);
  skipped += bouts.skipped;
  failedLeagues.push(...bouts.failed);

  const pricedGames =
    projections.filter((projection) => quotes.has(projection.game_id)).length + bouts.priced;

  logger.info('projection_candidates_built', {
    sport: scope.sport,
    league: scope.league ?? 'all',
    pools: pools.size,
    projected: projections.length + bouts.projected,
    skipped,
    selections: selections.length,
    priced: pricedGames,
    verified: selections.filter((s) => s.market.availability === 'verified').length,
    failed: failedLeagues.length,
  });

  return { selections, projections, failedLeagues, skipped, pricedGames };
}

// ---------------------------------------------------------------------------
// Fights and tennis
// ---------------------------------------------------------------------------

export interface BoutModel {
  /** Ratings built from every completed contest in the window. */
  ratings: BoutRatings;
  /** Upcoming contests, scheduled and not yet started. */
  upcoming: Game[];
}

/**
 * Ratings for a fight or tennis competition, built only from contests that
 * had already finished.
 *
 * The bout counterpart to `buildPoolModel`. No pool: a fighter is rated at a
 * division and a player on a tour, and neither competition shares results
 * with another. `asOf` is the same look-ahead boundary — `toBoutResults`
 * filters on it, so the ratings cannot see the result of the contest being
 * projected.
 */
export async function buildBoutModel(
  league: League,
  asOf: number = Date.now(),
): Promise<BoutModel | null> {
  const config = boutConfigForLeague(league.id);
  if (!config) return null;

  const today = todayInAppTimezone();
  let games: Game[];
  try {
    games = await fixturesForRange(
      league,
      addDays(today, -config.historyDays),
      addDays(today, 7),
      { currentTtlMs: CURRENT_WINDOW_TTL_MS, settledTtlMs: SETTLED_WINDOW_TTL_MS, today },
    );
  } catch (error) {
    logger.warn('projection_history_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
  if (games.length === 0) return null;

  const { value: ratings } = await cached(
    `projection:bout-ratings:${league.id}:${Math.floor(asOf / RATINGS_TTL_MS)}`,
    RATINGS_TTL_MS,
    async () => buildBoutRatings(toBoutResults(games, asOf), config),
  );

  const upcoming = games.filter(
    (game) =>
      game.status === 'scheduled' &&
      game.start_time !== null &&
      Date.parse(game.start_time) > asOf,
  );

  logger.info('bout_pool_built', {
    league: league.id,
    results: ratings.sample,
    rated: ratings.fighters.size,
    upcoming: upcoming.length,
  });

  return { ratings, upcoming };
}

interface BoutCandidateResult {
  selections: Selection[];
  projected: number;
  skipped: number;
  priced: number;
  failed: string[];
}

/**
 * Every fight and tennis selection across the eligible competitions.
 *
 * Kept apart from the scoring model for the same reason races are: a contest
 * between two people has no score to simulate, and bolting it onto the team
 * model would mean rating a fight as a nil-nil draw waiting to happen. The
 * two meet again at `Selection`, so a fight leg travels through the optimiser,
 * the store and the accuracy figures like any other.
 *
 * A large share of every card is skipped, and that is the model working as
 * designed: a fighter with fewer than three fights at the weight, or a player
 * with fewer than ten tour matches, gets no projection rather than a thin one.
 */
async function boutCandidates(scope: ParlayScope, asOf: number): Promise<BoutCandidateResult> {
  const leagues = scope.leagues.filter((league) => boutConfigForLeague(league.id) !== null);
  const result: BoutCandidateResult = {
    selections: [],
    projected: 0,
    skipped: 0,
    priced: 0,
    failed: [],
  };
  if (leagues.length === 0) return result;

  const today = todayInAppTimezone();
  let quotes = new Map<string, GameMarkets>();
  try {
    quotes = await marketsForLeagues(leagues, today, addDays(today, 7));
  } catch (error) {
    logger.warn('odds_lookup_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  for (const league of leagues) {
    const config = boutConfigForLeague(league.id);
    if (!config) continue;

    try {
      const model = await buildBoutModel(league, asOf);
      if (!model) continue;

      let projected = 0;
      for (const game of model.upcoming) {
        const outcome = projectContest(game, model.ratings, config, { now: new Date(asOf) });
        // Null means insufficient record. That contest produces nothing — it
        // is never filled in with a fabricated estimate.
        if (!outcome) {
          result.skipped += 1;
          continue;
        }

        projected += 1;
        if (quotes.has(game.id)) result.priced += 1;
        result.selections.push(
          ...boutSelections(game, outcome, quotes.get(game.id) ?? null, asOf).map(
            (selection) => ({ ...selection, league_id: league.id }),
          ),
        );
      }
      result.projected += projected;

      logger.info('bout_candidates_built', {
        league: league.id,
        upcoming: model.upcoming.length,
        projected,
        selections: result.selections.length,
      });
    } catch (error) {
      // One competition's outage must not take the rest of the card with it.
      logger.warn('bout_candidates_failed', {
        league: league.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
      result.failed.push(league.id);
    }
  }

  return result;
}

/**
 * Projection for one fight or tennis match, for the game detail page.
 *
 * Null for any fixture that is not one, and null for a contest the model has
 * too little record to say anything about.
 */
export async function boutProjectionForGame(
  game: Game,
  asOf: number = Date.now(),
): Promise<BoutOutcome | null> {
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (!league) return null;
  const config = boutConfigForLeague(league.id);
  if (!config) return null;

  const { value } = await cached(
    `projection:bout:${game.id}:${config.modelVersion}`,
    projectionTtlFor(game.start_time, asOf),
    async () => {
      const model = await buildBoutModel(league, asOf);
      if (!model) return null;
      return projectContest(game, model.ratings, config, { now: new Date(asOf) });
    },
  );

  return value;
}

/**
 * Whichever projection a fixture has.
 *
 * A fixture is projected by exactly one engine, and which one is a property
 * of its competition. Callers that only hold a game — the detail page, the
 * market explorer — ask here rather than guessing, and get the scoring
 * projection, the bout projection or the race projection, never two of them and
 * never the wrong one.
 */
export interface FixtureProjection {
  game: ProjectionOutcome | null;
  bout: BoutOutcome | null;
  race: RaceOutcome | null;
}

export async function fixtureProjection(
  game: Game,
  asOf: number = Date.now(),
): Promise<FixtureProjection> {
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (league?.format === 'race') {
    return { game: null, bout: null, race: await raceProjectionForGame(game, asOf) };
  }
  if (league && boutConfigForLeague(league.id)) {
    return { game: null, bout: await boutProjectionForGame(game, asOf), race: null };
  }
  return { game: await projectionForGame(game, asOf), bout: null, race: null };
}

// ---------------------------------------------------------------------------
// Why there is no projection
// ---------------------------------------------------------------------------

/**
 * What a fixture is missing, when it produced nothing.
 *
 * "Projection unavailable" is an honest answer and an unhelpful one: it does not
 * separate a competition the engine cannot model at all from one whose teams are
 * three games short of the threshold and will start answering in a fortnight. A
 * reader who cannot tell those apart reasonably reads either as the application
 * being broken — which is exactly what happened with college football, dark for
 * the opening weeks of every season with nothing on the page to say why.
 *
 * Never a guess: every sentence here names counts the model actually holds.
 */
export interface ProjectionGap {
  reason: 'no_model' | 'wrong_session' | 'unrated_sides' | 'insufficient_history';
  /** One sentence naming the specific shortfall. */
  detail: string;
}

function historyGap(game: Game, set: RatingSet, config: SportModelConfig): ProjectionGap {
  const sides = sidesOf(game);
  const home = sides ? set.ratings.get(sides.home.name) : undefined;
  const away = sides ? set.ratings.get(sides.away.name) : undefined;

  if (!sides || !home || !away) {
    const unknown = [
      !home ? (sides?.home.name ?? 'the home side') : null,
      !away ? (sides?.away.name ?? 'the away side') : null,
    ].filter((name): name is string => name !== null);

    return {
      reason: 'unrated_sides',
      detail:
        `${unknown.join(' and ')} ${unknown.length === 1 ? 'has' : 'have'} no completed ` +
        `games inside the model's ${config.historyDays}-day window.`,
    };
  }

  return {
    reason: 'insufficient_history',
    detail:
      `${sides.home.name} have ${home.games} completed ${home.games === 1 ? 'game' : 'games'} ` +
      `and ${sides.away.name} ${away.games}, inside the model's ${config.historyDays}-day ` +
      `window. Both sides need at least ${gamesNeeded(config)}.`,
  };
}

/**
 * Why this fixture produced no projection.
 *
 * Called only after one came back empty. Everything it reads is already cached
 * by the attempt that failed, so describing the gap costs no further provider
 * call.
 */
export async function projectionGap(
  game: Game,
  asOf: number = Date.now(),
): Promise<ProjectionGap> {
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (!league) {
    return {
      reason: 'no_model',
      detail: 'This competition is not one the projection engine models.',
    };
  }

  if (league.format === 'race') {
    if (!isProjectableSession(game)) {
      return {
        reason: 'wrong_session',
        detail:
          `The model projects the race itself. ${game.session ?? 'This session'} has no ` +
          'finishing order worth predicting, and nothing is estimated for it.',
      };
    }
    return {
      reason: 'insufficient_history',
      detail:
        'Too few drivers in this field have completed races inside the rating window to ' +
        'support a projection.',
    };
  }

  if (boutConfigForLeague(league.id)) {
    return {
      reason: 'insufficient_history',
      detail:
        'One or both of these competitors has too short a record inside the rating window ' +
        'to support a projection.',
    };
  }

  const config = modelConfigForLeague(league.id, league.sport);
  if (!config) {
    return {
      reason: 'no_model',
      detail: 'This competition is not one the projection engine models.',
    };
  }

  const model = await buildPoolModel(league, asOf);
  if (!model) {
    return {
      reason: 'unrated_sides',
      detail:
        `No completed results are available for ${league.label} inside the model's ` +
        `${config.historyDays}-day window.`,
    };
  }

  return historyGap(game, model.ratings, config);
}

/**
 * Every race selection across the eligible motorsport competitions.
 *
 * Kept apart from the scoring model rather than bolted onto it: a race is
 * projected as a finishing order and has nothing the other model can use. The
 * two meet again at `Selection`, which is what lets a race leg travel through
 * the optimiser, the store and the accuracy figures like any other.
 */
export interface RaceModel {
  /** Every session in the window, practice and qualifying included. */
  sessions: Game[];
  ratings: RaceRatings;
}

/**
 * Every session of a motorsport competition's window, with the ratings built
 * from the ones that had already been run.
 *
 * The race counterpart to `buildPoolModel`. There is no pool: a driver is rated
 * across a championship and no championship shares results with another. `asOf`
 * is the same look-ahead boundary — `toRaceResults` filters on it, so the
 * ratings cannot see the result of the race being projected.
 */
export async function buildRaceModel(
  league: League,
  asOf: number = Date.now(),
): Promise<RaceModel> {
  const today = todayInAppTimezone();
  const sessions = await fixturesForRange(
    league,
    addDays(today, -RACE_CONFIG.historyDays),
    addDays(today, 14),
    { currentTtlMs: CURRENT_WINDOW_TTL_MS, settledTtlMs: SETTLED_WINDOW_TTL_MS, today },
  );

  const { value: ratings } = await cached(
    `projection:race-ratings:${league.id}:${Math.floor(asOf / RATINGS_TTL_MS)}`,
    RATINGS_TTL_MS,
    async () => buildRaceRatings(toRaceResults(sessions, asOf)),
  );

  return { sessions, ratings };
}

/**
 * What the model is allowed to know about one race when it projects it.
 *
 * Derived here rather than at each call site, because the session page and the
 * parlay build must reach the same answer for the same race: two pages
 * disagreeing about who is on the grid would be two different projections
 * wearing one model version.
 */
function raceOptions(
  sessions: readonly Game[],
  race: Game,
  asOf: number,
): { grid: ReadonlyMap<string, number> | null; field: string[]; fieldSource: 'weekend' | 'recent' } {
  const weekend = sessions.filter((session) => session.title === race.title);

  /*
   * The grid is only visible once qualifying has genuinely been run and has
   * already started. Anything else would let a projection see a session that
   * had not happened when it was made.
   */
  const grid = gridFrom(weekend, asOf);

  const ran = (session: Game): boolean =>
    session.status === 'finished' &&
    (session.entrants?.length ?? 0) > 0 &&
    session.start_time !== null &&
    Date.parse(session.start_time) < asOf;

  // This weekend's own running is the better field: it is the actual entry
  // list, and it reflects any driver change.
  const thisWeekend = weekend
    .filter(ran)
    .sort((a, b) => Date.parse(b.start_time ?? '') - Date.parse(a.start_time ?? ''))[0];
  const field = (thisWeekend?.entrants ?? []).map((entrant) => entrant.name);
  if (field.length > 0) return { grid, field, fieldSource: 'weekend' };

  /*
   * Failing that, the field from the last race actually run.
   *
   * The provider publishes an entry list only once a session has taken place,
   * so a race weeks away arrives with nobody in it. Taking the most recent
   * classified field is an assumption — that broadly the same drivers turn up —
   * but it is an assumption about observed people rather than an invented list,
   * and the projection records that it made it.
   */
  const lastRace = [...sessions]
    .filter((session) => session.session === 'Race' && ran(session))
    .sort((a, b) => Date.parse(b.start_time ?? '') - Date.parse(a.start_time ?? ''))[0];

  return {
    grid,
    field: (lastRace?.entrants ?? []).map((entrant) => entrant.name),
    fieldSource: 'recent',
  };
}

/**
 * Whether the race model has an opinion about this session.
 *
 * Only the Grand Prix itself. Practice has no result worth predicting, and
 * qualifying would need a pace model rather than the race model with a
 * different label on it — so a qualifying page says that plainly instead of
 * showing race probabilities against the wrong session.
 */
export function isProjectableSession(game: Game): boolean {
  return game.session === 'Race';
}

async function raceCandidates(scope: ParlayScope, asOf: number): Promise<Selection[]> {
  const leagues = scope.leagues.filter((league) => league.format === 'race');
  if (leagues.length === 0) return [];

  const selections: Selection[] = [];

  for (const league of leagues) {
    try {
      const { sessions, ratings } = await buildRaceModel(league, asOf);

      const upcoming = sessions.filter(
        (session) =>
          isProjectableSession(session) &&
          session.status === 'scheduled' &&
          session.start_time !== null &&
          Date.parse(session.start_time) > asOf,
      );

      for (const race of upcoming) {
        const outcome = projectRace(race, ratings, {
          simulations: projectionConfig.simulations,
          ...raceOptions(sessions, race, asOf),
          now: new Date(asOf),
        });
        if (!outcome) continue;

        selections.push(
          ...raceSelections(race, outcome, ratings).map((selection) => ({
            ...selection,
            league_id: league.id,
          })),
        );
      }

      logger.info('race_candidates_built', {
        league: league.id,
        rated: ratings.drivers.size,
        races: ratings.sample,
        upcoming: upcoming.length,
        selections: selections.length,
      });
    } catch (error) {
      // A motorsport outage must not take the rest of the card with it.
      logger.warn('race_candidates_failed', {
        league: league.id,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  return selections;
}

/**
 * Projection for one race, for the session detail page.
 *
 * Null for anything that is not a Grand Prix — a practice or a qualifying page
 * reaches here and is told the model has nothing for it, which is the truth
 * rather than a race projection under another session's name.
 */
export async function raceProjectionForGame(
  game: Game,
  asOf: number = Date.now(),
): Promise<RaceOutcome | null> {
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (!league || league.format !== 'race') return null;
  if (!isProjectableSession(game)) return null;

  const { value } = await cached(
    `projection:race:${game.id}:${projectionConfig.modelVersion}`,
    projectionTtlFor(game.start_time, asOf),
    async () => {
      const { sessions, ratings } = await buildRaceModel(league, asOf);
      return projectRace(game, ratings, {
        simulations: projectionConfig.simulations,
        ...raceOptions(sessions, game, asOf),
        now: new Date(asOf),
      });
    },
  );

  return value;
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
  // The catalogue label is what a game carries, so match on that.
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (!league) return null;

  /*
   * The competition's model, not its sport's.
   *
   * This read `modelConfigFor(game.sport)`, which is the one lookup that cannot
   * tell NCAA football from the NFL — they share a sport id, and the whole
   * reason NCAAF carries its own configuration is that they do not score alike.
   * So the parlay build, which asks by competition, projected a college fixture
   * at a 53.6-point baseline with a 4-point home edge, while this page
   * projected the same fixture at the NFL's 44 and 1.8. Two different
   * scorelines for one game, under one model version. The CFL and the two
   * European leagues were in the same position.
   */
  const config = modelConfigForLeague(league.id, league.sport);
  if (!config) return null;

  const { value } = await cached(
    `projection:game:${game.id}:${projectionConfig.modelVersion}`,
    projectionTtlFor(game.start_time, asOf),
    async () => {
      const kickoff = Date.parse(game.start_time ?? '');
      const [model, report, starters] = await Promise.all([
        buildPoolModel(league, asOf),
        leagueAvailability(league),
        startersFor([league], [game]),
      ]);
      if (!model) return null;

      const pitchers = Number.isFinite(kickoff)
        ? await pitchersForFixture(starters.get(game.id), kickoff)
        : null;

      const conditions: FixtureConditions | null = config.weather
        ? ((await conditionsForGames([game])).get(game.id) ?? null)
        : null;

      return projectGame(game, model.ratings, config, {
        simulations: projectionConfig.simulations,
        availability: squadNewsFor(report, game),
        pitchers,
        conditions,
        now: new Date(asOf),
      });
    },
  );

  return value;
}

/**
 * Everything one fixture supports: the projection, its simulations, its
 * markets, and every selection they produce.
 *
 * The single-fixture counterpart to `buildCandidates`. It exists because a
 * same-game combination, a bet builder and a market explorer all need the
 * simulated distribution — which the bulk candidate build deliberately does
 * not keep, because holding one per fixture costs tens of megabytes for
 * something almost nothing reads.
 *
 * Here it is one fixture at a time, so the distribution is affordable and the
 * joint probabilities that make a same-game line honest can be counted.
 */
export interface GameCandidates {
  game: Game;
  /**
   * The scoring projection and its simulations.
   *
   * Null for a fight, a tennis match or a race. A contest between two people has
   * no distribution at all: a single winner probability is the whole of the
   * model's claim. A race has one, but of finishing orders rather than
   * scorelines, which the same-game counter cannot read — so both are held to a
   * single leg rather than multiplied. `bout` and `race` carry those projections
   * instead, and exactly one of the three is ever present.
   */
  outcome: ProjectionOutcome | null;
  bout: BoutOutcome | null;
  race: RaceOutcome | null;
  selections: Selection[];
  markets: GameMarkets | null;
}

export async function gameCandidates(
  game: Game,
  asOf: number = Date.now(),
): Promise<GameCandidates | null> {
  const league = LEAGUES.find((entry) => entry.label === game.league);
  if (!league) return null;

  const isRace = league.format === 'race';
  const boutConfig = boutConfigForLeague(league.id);
  const config = isRace || boutConfig ? null : modelConfigForLeague(league.id, league.sport);
  if (!isRace && !boutConfig && !config) return null;

  const projected = await fixtureProjection(game, asOf);
  if (!projected.game && !projected.bout && !projected.race) return null;

  const today = todayInAppTimezone();
  let markets: GameMarkets | null = null;
  try {
    const quotes = await marketsForLeagues([league], today, addDays(today, 7));
    markets = quotes.get(game.id) ?? null;
  } catch (error) {
    // Prices enrich a projection; they are never a precondition for one.
    logger.warn('odds_lookup_failed', {
      game: game.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  }

  const selections = projected.race
    ? raceSelections(game, projected.race, (await buildRaceModel(league, asOf)).ratings)
    : projected.bout
      ? boutSelections(game, projected.bout, markets, asOf)
      : config && projected.game
        ? candidateSelections(game, projected.game, config, markets, asOf)
        : [];

  return {
    game,
    outcome: projected.game,
    bout: projected.bout,
    race: projected.race,
    selections: selections.map((selection) => ({ ...selection, league_id: league.id })),
    markets,
  };
}

export const projectionTimezone = APP_TIMEZONE;
