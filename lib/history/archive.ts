/**
 * Filling the long-run archive.
 *
 * Walks a competition back season by season, fetching through the same routed
 * adapter every other part of the application uses — so ESPN's 45-day chunking
 * and TheSportsDB's season-at-a-time behaviour (including the CFL's
 * round-by-round workaround) are inherited rather than reimplemented here.
 *
 * Three rules this module holds to:
 *
 *   **Only completed seasons are written.** An in-progress season can still
 *   gain results, and a file claiming a complete season while missing its last
 *   month is worse than no file — every constant fitted from it would be
 *   quietly wrong, with nothing downstream able to tell.
 *
 *   **An already-archived season is never re-fetched.** That is the entire
 *   reason this is on disk rather than in the process-local cache.
 *
 *   **An empty season is never written.** This was the opposite way round
 *   first, on the reasoning that a competition younger than the window
 *   genuinely has no fixtures — the AFLE and EFA, founded this year — so
 *   recording the empty season states a fact. Then the CFL came back empty
 *   because the provider rate-limited the fetch, and the archive wrote a file
 *   asserting that a season which was actually played contained no games. The
 *   two cases are indistinguishable from the outside, and only one of them is
 *   safe to be wrong about, so neither is persisted. Re-fetching a genuinely
 *   empty season on each run is cheap; a file that quietly claims a real
 *   season was never played is not.
 */

import { fixturesForRange } from '../providers/fixtures.ts';
import { logger } from '../logger.ts';
import { seasonsToArchive } from './season.ts';
import type { SeasonWindow } from './season.ts';
import { readSeason, writeSeason } from './store.ts';
import type { League } from '../leagues/registry';

/** Default depth. Three to five years is what the v2 spec asks history for. */
export const DEFAULT_SEASONS = 5;

/**
 * A settled season is settled.
 *
 * This TTL only governs the in-memory cache inside the adapters during the
 * fetch itself; nothing re-reads it afterwards, because the result goes to
 * disk.
 */
const SETTLED_TTL_MS = 24 * 60 * 60_000;

export interface SeasonOutcome {
  league_id: string;
  season: string;
  games: number;
  /**
   * What happened, kept as three states rather than a boolean.
   *
   * `stored` and `empty` both used to report as "not fetched", which read as
   * "already archived" and hid the case that actually mattered — a season that
   * came back with nothing and was therefore not written.
   */
  state: 'written' | 'stored' | 'empty' | 'failed';
  error?: string;
}

/**
 * Archive one season, unless it is already on disk.
 *
 * Returns what happened rather than throwing, so one competition's provider
 * failure cannot abandon the rest of a backfill.
 */
export async function archiveSeason(
  league: League,
  window: SeasonWindow,
  today: string,
): Promise<SeasonOutcome> {
  const existing = await readSeason(league.id, window.season);
  if (existing) {
    return {
      league_id: league.id,
      season: window.season,
      games: existing.games.length,
      state: 'stored',
    };
  }

  try {
    const games = await fixturesForRange(league, window.startDate, window.endDate, {
      currentTtlMs: SETTLED_TTL_MS,
      settledTtlMs: SETTLED_TTL_MS,
      today,
    });

    /*
     * Clamped to the window before writing.
     *
     * TheSportsDB works by whole calendar year, so a request for a football
     * season that runs August to May comes back carrying both years entire.
     * Without this, a fixture would land in two season files and be counted
     * twice by anything summing across seasons.
     */
    const inSeason = games.filter((game) => {
      const date = game.start_time?.slice(0, 10);
      return date !== undefined && date >= window.startDate && date <= window.endDate;
    });

    /*
     * Nothing to archive is not the same as nothing happened.
     *
     * An empty result may mean the competition did not exist yet, or that the
     * fetch was rate-limited into silence. Since this cannot tell them apart,
     * it declines to record either — the season stays unarchived and the next
     * run tries again.
     */
    if (inSeason.length === 0) {
      return { league_id: league.id, season: window.season, games: 0, state: 'empty' };
    }

    await writeSeason({
      league_id: league.id,
      season: window.season,
      fetched_at: new Date().toISOString(),
      games: inSeason,
    });

    return {
      league_id: league.id,
      season: window.season,
      games: inSeason.length,
      state: 'written',
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    logger.warn('history_season_fetch_failed', {
      league: league.id,
      season: window.season,
      reason,
    });
    return { league_id: league.id, season: window.season, games: 0, state: 'failed', error: reason };
  }
}

/**
 * Archive a competition's recent completed seasons.
 *
 * Sequential by season on purpose. A backfill is not on anyone's critical
 * path, and firing five multi-month range fetches at a provider at once is how
 * an application earns a rate limit.
 */
export async function archiveLeague(
  league: League,
  today: string,
  seasons: number = DEFAULT_SEASONS,
): Promise<SeasonOutcome[]> {
  const windows = seasonsToArchive(league, today, seasons);
  const outcomes: SeasonOutcome[] = [];

  for (const window of windows) {
    outcomes.push(await archiveSeason(league, window, today));
  }

  const fetched = outcomes.filter((outcome) => outcome.state === 'written').length;
  logger.info('history_league_archived', {
    league: league.id,
    seasons: outcomes.length,
    fetched,
    games: outcomes.reduce((sum, outcome) => sum + outcome.games, 0),
  });

  return outcomes;
}
