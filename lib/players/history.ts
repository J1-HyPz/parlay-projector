/**
 * What each player has actually done, game by game.
 *
 * Assembled from finished games rather than fetched per player, for the reason
 * set out in `providers/espn/boxscore.ts`: the provider's athlete gamelog
 * carries the current season only, so in September it holds one game per
 * player and no distribution can be built from it.
 *
 * The cost shape is the opposite of the obvious one. A summary is one request
 * and yields every player in that game — about fifty — so a season of the NFL
 * is a few hundred requests shared across a thousand players, against one
 * request per player per season that would not answer anyway. A finished game
 * can never change, so each is cached for a month and asked once.
 */

import { cached } from '../cache';
import { espnConfig } from '../config';
import { logger } from '../logger';
import { fetchEspn } from '../providers/espn/client';
import { normaliseBoxscore } from '../providers/espn/boxscore';
import type { PlayerGameLine, RawBoxscoreResponse } from '../providers/espn/boxscore';
import { parseEspnGameId } from '../providers/espn/fixtures';
import type { League } from '../leagues/registry';
import type { Game } from '../home/types';

/** A finished game's box score is settled; a month is arbitrary and generous. */
const BOXSCORE_TTL_MS = 30 * 24 * 60 * 60_000;

/** Summaries fetched at once, matching the fixture adapter's restraint. */
const BOXSCORE_CONCURRENCY = 4;

/**
 * Games read per competition, most recent first.
 *
 * A bound rather than a preference. Without one a cold build would ask for
 * every finished game in the rating window at once, and the older half of
 * those say the least about what a player will do on Sunday — rosters and
 * roles turn over. Recent games are read first so the cap, when it bites,
 * drops the least informative end.
 */
const MAX_GAMES = 400;

/** One player's line in one game, with the game attached. */
export interface PlayerGame extends PlayerGameLine {
  gameId: string;
  /** Kick-off, as epoch milliseconds. The model weights by recency. */
  date: number;
}

/** Finished games this competition can supply player lines for, newest first. */
function readable(games: readonly Game[], asOf: number): Game[] {
  return games
    .filter((game) => {
      if (game.status !== 'finished' || !game.start_time) return false;
      const date = Date.parse(game.start_time);
      // Strictly before `asOf`, so a backtest can never read a box score from
      // the game it is projecting.
      return Number.isFinite(date) && date < asOf;
    })
    .sort((a, b) => Date.parse(b.start_time ?? '') - Date.parse(a.start_time ?? ''))
    .slice(0, MAX_GAMES);
}

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

/** Every player line from one finished game. Empty when it cannot be read. */
async function linesForGame(league: League, game: Game): Promise<PlayerGame[]> {
  const espnPath = league.espnPath;
  const parsed = parseEspnGameId(game.id);
  if (!espnPath || !parsed) return [];

  const date = Date.parse(game.start_time ?? '');
  if (!Number.isFinite(date)) return [];

  try {
    const { value } = await cached(
      `espn:boxscore:${league.id}:${parsed.eventId}`,
      BOXSCORE_TTL_MS,
      async () => {
        const payload = await fetchEspn<RawBoxscoreResponse>(
          `${espnPath}/summary`,
          `event=${encodeURIComponent(parsed.eventId)}`,
        );
        return normaliseBoxscore(payload, league);
      },
    );

    return value.map((line) => ({ ...line, gameId: game.id, date }));
  } catch (error) {
    // One unreadable game costs that game, not the competition. A player's
    // record is a sample; a hole in it lowers the data quality rather than
    // stopping the model.
    logger.warn('player_boxscore_failed', {
      league: league.id,
      game: game.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return [];
  }
}

/**
 * One finished game's player lines, by this application's game id.
 *
 * For settlement, which needs the box score of a single game rather than a
 * season of them. Shares the same month-long cache as the history walk, so a
 * game already read for the model costs nothing to settle against.
 */
export async function boxscoreFor(league: League, gameId: string): Promise<PlayerGameLine[]> {
  const espnPath = league.espnPath;
  const parsed = parseEspnGameId(gameId);
  if (!espnConfig.enabled || !espnPath || !parsed) return [];

  const { value } = await cached(
    `espn:boxscore:${league.id}:${parsed.eventId}`,
    BOXSCORE_TTL_MS,
    async () => {
      const payload = await fetchEspn<RawBoxscoreResponse>(
        `${espnPath}/summary`,
        `event=${encodeURIComponent(parsed.eventId)}`,
      );
      return normaliseBoxscore(payload, league);
    },
  );

  return value;
}

/**
 * Player lines for a competition's finished games.
 *
 * `asOf` is the same look-ahead boundary the rest of the engine uses: only
 * games that kicked off before it are read, so a projection can never see a
 * box score from the fixture it is projecting.
 */
export async function playerGames(
  league: League,
  games: readonly Game[],
  asOf: number = Date.now(),
): Promise<PlayerGame[]> {
  if (!espnConfig.enabled) return [];

  const wanted = readable(games, asOf);
  if (wanted.length === 0) return [];

  const results = await mapWithConcurrency(wanted, BOXSCORE_CONCURRENCY, (game) =>
    linesForGame(league, game),
  );
  const lines = results.flat();

  logger.info('player_history_loaded', {
    league: league.id,
    games: wanted.length,
    lines: lines.length,
    players: new Set(lines.map((line) => line.athleteId)).size,
  });

  return lines;
}
