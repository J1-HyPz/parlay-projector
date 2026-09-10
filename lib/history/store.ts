/**
 * The long-run history archive.
 *
 * One file per competition per completed season, under
 * `DATA_DIR/history/<league>/<season>.json`.
 *
 * **This is not a longer rating window, and the distinction is the whole
 * point.** `historyDays` feeds `buildRatings` — a team's *current* attack and
 * defence rate — and extending it is the mistake NCAA Football's config
 * already made and this project already fixed: a window reaching into a prior
 * season lets a team with no games yet this year borrow last year's roster at
 * a data quality high enough to clear every risk profile. Nothing in this
 * module is wired into `buildRatings`, and nothing read from here may be.
 * It exists to calibrate league constants and to answer questions about
 * seasons, not about form.
 *
 * Why files, and why one per season rather than one archive:
 *
 *   A completed season never changes. The in-memory cache the rest of the
 *   application uses is process-local, so it would re-fetch several years of
 *   fixtures on every redeploy — an avoidable cost at this volume, and the
 *   reason this is the first provider data the application persists at all.
 *
 *   A calculation only ever needs one competition's history at a time, exactly
 *   as `buildRatings` already does for the current window. Splitting by league
 *   and season means answering a question about one competition never loads
 *   the other nineteen, and adding a newly-finished season writes one small
 *   file instead of rewriting a large one.
 *
 * No database, deliberately, for the reasons §10 of the v2 spec sets out:
 * single writer, no ad-hoc cross-league queries, one container. If that ever
 * changes, the four functions below are the interface a database would have to
 * satisfy, and no caller would move.
 */

import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../config.ts';
import { logger } from '../logger.ts';
import { parseSeasonFile } from './store-parse.ts';
import type { SeasonArchive } from './store-parse.ts';
import type { Game } from '../home/types';

export function historyRoot(): string {
  return path.join(DATA_DIR, 'history');
}

export function leagueDir(leagueId: string): string {
  return path.join(historyRoot(), leagueId);
}

export function seasonPath(leagueId: string, season: string): string {
  return path.join(leagueDir(leagueId), `${season}.json`);
}

/**
 * One season's archived games, or null when nothing is stored.
 *
 * A file that cannot be read or does not parse yields null rather than
 * throwing. A caller then treats the season as un-archived and can re-fetch
 * it, which is recoverable; a thrown error part-way through a calibration
 * would take the whole run with it.
 */
export async function readSeason(
  leagueId: string,
  season: string,
): Promise<SeasonArchive | null> {
  const file = seasonPath(leagueId, season);
  try {
    const parsed = parseSeasonFile(JSON.parse(await readFile(file, 'utf8')));
    if (!parsed) {
      logger.warn('history_season_unusable', { league: leagueId, season });
      return null;
    }
    return parsed;
  } catch (error) {
    // A missing file is the normal case for a season not yet archived, and is
    // not worth a log line; anything else is.
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') {
      logger.warn('history_season_read_failed', {
        league: leagueId,
        season,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
    return null;
  }
}

/**
 * Write one completed season.
 *
 * Written to a temporary file and renamed, so a reader never sees a half-
 * written season — the same discipline the prediction store uses, and for the
 * same reason: a truncated file here would look like a short season rather
 * than like a failure.
 */
export async function writeSeason(archive: SeasonArchive): Promise<void> {
  const dir = leagueDir(archive.league_id);
  await mkdir(dir, { recursive: true });

  const file = seasonPath(archive.league_id, archive.season);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(archive), 'utf8');
  await rename(temporary, file);

  logger.info('history_season_written', {
    league: archive.league_id,
    season: archive.season,
    games: archive.games.length,
  });
}

/** Seasons already archived for a competition, newest first. */
export async function archivedSeasons(leagueId: string): Promise<string[]> {
  try {
    const entries = await readdir(leagueDir(leagueId));
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -'.json'.length))
      .sort((a, b) => b.localeCompare(a));
  } catch {
    return [];
  }
}

/**
 * Every archived game for a competition, oldest first.
 *
 * Loads one competition's files and no others. Deliberately returns plain
 * `Game` records — the same shape the rest of the application already works
 * in — so a caller needs no knowledge of how this is stored.
 */
export async function readLeagueHistory(leagueId: string): Promise<Game[]> {
  const seasons = await archivedSeasons(leagueId);
  const games: Game[] = [];

  for (const season of seasons.reverse()) {
    const archive = await readSeason(leagueId, season);
    if (archive) games.push(...archive.games);
  }

  return games.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));
}
