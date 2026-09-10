/**
 * Validation for the history archive.
 *
 * Pure, so the rules can be tested without a filesystem. These files survive
 * redeploys and are the input to calibration, so they are treated as untrusted:
 * a truncated or hand-edited file must degrade to "this season is not
 * archived", never to a season that looks complete and is not.
 *
 * The bar is deliberately different from the prediction store's. There, a
 * dropped record loses one prediction. Here, a season quietly missing a third
 * of its games would move whatever constant is fitted from it and nothing
 * downstream could tell — so a file whose games do not survive validation is
 * rejected *whole* rather than silently thinned.
 */

import type { Game, GameStatus } from '../home/types';

/** One competition's completed season. */
export interface SeasonArchive {
  league_id: string;
  /** The season's starting year, matching `seasonWindow`. */
  season: string;
  /** When this was fetched. For provenance, never for freshness — it is final. */
  fetched_at: string;
  games: Game[];
}

/**
 * Share of a file's games that must validate for the file to be usable.
 *
 * Not 100%: a provider occasionally emits one malformed fixture, and rejecting
 * a whole season over it would lose four months of good results. Not a
 * majority either — a file that has lost a tenth of its games has lost enough
 * to move a fitted constant, and should be re-fetched rather than trusted.
 */
const MIN_USABLE_SHARE = 0.95;

const STATUSES: ReadonlySet<string> = new Set<GameStatus>([
  'scheduled',
  'live',
  'finished',
  'postponed',
  'cancelled',
]);

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isScore(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const score = value as { home?: unknown; away?: unknown };
  return (
    (score.home === null || typeof score.home === 'number') &&
    (score.away === null || typeof score.away === 'number')
  );
}

/**
 * A game usable as history.
 *
 * Checks only what the archive is *for*: an identity, a sport, a time it
 * happened, a status and a well-formed score. Provider decoration — badges,
 * broadcast, venue detail — is carried through untouched and never validated,
 * because nothing reading this archive depends on it.
 */
export function isArchivableGame(value: unknown): value is Game {
  if (!value || typeof value !== 'object') return false;
  const game = value as Record<string, unknown>;

  return (
    str(game.id) !== null &&
    str(game.sport) !== null &&
    STATUSES.has(game.status as string) &&
    // A fixture with no time cannot be placed in a season, which is the one
    // question this archive exists to answer.
    str(game.start_time) !== null &&
    isScore(game.score)
  );
}

/**
 * Parse a season file, or null when it cannot be trusted.
 *
 * Returns null rather than a partial season. See the note at the top of this
 * file: a thinned season is the failure mode worth refusing, because nothing
 * downstream can detect it.
 */
export function parseSeasonFile(raw: unknown): SeasonArchive | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as Record<string, unknown>;

  const leagueId = str(file.league_id);
  const season = str(file.season);
  if (!leagueId || !season || !Array.isArray(file.games)) return null;

  const games = file.games.filter(isArchivableGame);

  // An empty season is legitimate — a competition can have no completed
  // fixtures in a window — but a file that *had* games and lost most of them
  // to validation is a damaged file, not an empty season.
  if (file.games.length > 0 && games.length < file.games.length * MIN_USABLE_SHARE) {
    return null;
  }

  return {
    league_id: leagueId,
    season,
    fetched_at: str(file.fetched_at) ?? '',
    games,
  };
}
