/**
 * One athlete's record, a game at a time.
 *
 * The provider's athlete gamelog, generalised out of the pitcher-specific
 * reader that has been using it since the starting-pitcher work. Two things
 * make it the right source for a player market where a box-score walk is not:
 *
 *   **It reaches back.** `?season=YYYY` serves a past season — measured, nine
 *   seasons for an NFL quarterback and ten for a pitcher, and the payload
 *   advertises which ones it will serve in its own `filters`. The comment this
 *   module replaces asserted the opposite ("asked for an earlier season it
 *   returns nothing"), and that single wrong assumption is why a player's
 *   record was being assembled from several hundred box scores.
 *
 *   **It is one request for one player.** Which is the wrong shape for rating
 *   a whole squad — fifty players share one box score — and exactly the right
 *   shape for a market about two named individuals. Whether this or the box
 *   score is cheaper is a property of how many players the market is about,
 *   not a fact about the endpoint.
 *
 * **Values come back as the provider wrote them, unparsed.** A gamelog carries
 * innings as `"6.1"` meaning six and a third, time on ice as `"18:14"`, and
 * completions as `"23/28"` — three notations that all look like numbers and
 * none of which `Number()` reads correctly. Parsing belongs with the caller
 * that knows which statistic it asked for; `parseInnings` already exists for
 * the first of them and must keep being reached.
 *
 * Pure normaliser, separate fetch. The normaliser is what the tests exercise
 * against a real saved payload.
 */

import { cached } from '../../cache.ts';
import { espnConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { getJson } from '../../http.ts';

/**
 * The gamelog lives on a different base path from everything else here.
 *
 * `<sport>/<league>/athletes/<id>/gamelog` on the site API returns 404; this
 * common path answers. Passed through the shared request helper anyway, for
 * its timeout and size cap.
 */
const COMMON_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports';

/** A completed season never changes; the current one gains a game a week. */
const PAST_SEASON_TTL_MS = 7 * 24 * 60 * 60_000;
const CURRENT_SEASON_TTL_MS = 6 * 60 * 60_000;

interface RawFilterOption {
  value?: unknown;
}

interface RawFilter {
  name?: unknown;
  options?: RawFilterOption[] | null;
}

export interface RawGamelogResponse {
  names?: unknown;
  filters?: RawFilter[] | null;
  events?: Record<string, { gameDate?: unknown }> | null;
  seasonTypes?:
    | {
        displayName?: unknown;
        categories?: { events?: { eventId?: unknown; stats?: unknown[] }[] }[] | null;
      }[]
    | null;
}

/** One appearance, with the provider's own values kept as text. */
export interface GamelogRow {
  /** Provider event id, so an appearance ties back to its fixture. */
  eventId: string;
  /** Kick-off, in epoch milliseconds. */
  date: number;
  /** Raw values by statistic name, exactly as published. */
  stats: Readonly<Record<string, string>>;
}

export interface Gamelog {
  rows: GamelogRow[];
  /**
   * Seasons this athlete has in this competition, newest first.
   *
   * Read from the payload's own `season` filter rather than guessed at. It is
   * per athlete, not per league — a rookie offers one season where a veteran
   * offers ten — so it is the only honest way to know how far back to ask.
   */
  seasons: number[];
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Seasons the payload says it will serve, newest first. */
function seasonsFrom(payload: RawGamelogResponse): number[] {
  const filter = (payload.filters ?? []).find((entry) => str(entry.name) === 'season');
  const seasons = (filter?.options ?? [])
    .map((option) => Number(str(option.value)))
    .filter((year) => Number.isInteger(year) && year > 1900);

  return [...new Set(seasons)].sort((a, b) => b - a);
}

/**
 * Every appearance on one athlete's record, flattened.
 *
 * The provider groups by season type and then by category — regular season,
 * post-season, and for baseball batting against pitching. None of that
 * grouping carries meaning this application needs, and flattening it means a
 * caller asking "what has he done" does not have to know the shape.
 *
 * A row missing its date is dropped. The date is what every point-in-time rate
 * is filtered on, so a row without one could only be counted by pretending to
 * know when it happened.
 */
export function normaliseGamelog(payload: RawGamelogResponse): Gamelog {
  const names = Array.isArray(payload.names)
    ? payload.names.map((name) => str(name))
    : [];

  const rows: GamelogRow[] = [];

  for (const seasonType of payload.seasonTypes ?? []) {
    for (const category of seasonType.categories ?? []) {
      for (const event of category.events ?? []) {
        const eventId = str(event.eventId);
        if (!eventId) continue;

        const date = Date.parse(str(payload.events?.[eventId]?.gameDate) ?? '');
        if (!Number.isFinite(date)) continue;

        const stats: Record<string, string> = {};
        names.forEach((name, index) => {
          if (!name) return;
          const raw = str(event.stats?.[index]);
          // A name already filled is not overwritten: baseball repeats a few
          // between its batting and pitching categories, and taking whichever
          // came last would be arbitrary.
          if (raw !== null && !(name in stats)) stats[name] = raw;
        });

        rows.push({ eventId, date, stats });
      }
    }
  }

  // Newest first, which is the order every rate in this application expects.
  rows.sort((a, b) => b.date - a.date);

  return { rows, seasons: seasonsFrom(payload) };
}

export interface GamelogRequest {
  /**
   * Season to ask for, as the provider numbers it.
   *
   * Omitted means the current season. For the winter sports the value is the
   * season-*ending* year: 2025 returns the NBA's and the NHL's 2024-25.
   */
  season?: number;
  /** Baseball only: `batting` or `pitching`. Ignored elsewhere. */
  category?: string;
}

/**
 * One athlete's gamelog for one season.
 *
 * Empty for every reason that is not an error — the provider disabled, a
 * competition it does not key, an athlete with nothing on record — and empty
 * on failure too, which costs that player their market rather than breaking
 * the fixture.
 */
export async function athleteGamelog(
  leaguePath: string,
  athleteId: string,
  request: GamelogRequest = {},
): Promise<Gamelog> {
  if (!espnConfig.enabled) return { rows: [], seasons: [] };

  const query = new URLSearchParams();
  if (request.season !== undefined) query.set('season', String(request.season));
  if (request.category) query.set('category', request.category);
  const suffix = query.toString();

  const key = `espn:gamelog:${leaguePath}:${athleteId}:${suffix || 'current'}`;
  const ttl = request.season === undefined ? CURRENT_SEASON_TTL_MS : PAST_SEASON_TTL_MS;

  try {
    const { value } = await cached(key, ttl, async () => {
      const payload = await getJson<RawGamelogResponse>(
        `${COMMON_BASE}/${leaguePath}/athletes/${encodeURIComponent(athleteId)}/gamelog` +
          (suffix ? `?${suffix}` : ''),
        { timeoutMs: espnConfig.timeoutMs },
      );
      return payload ? normaliseGamelog(payload) : { rows: [], seasons: [] };
    });
    return value;
  } catch (error) {
    logger.warn('espn_gamelog_failed', {
      league: leaguePath,
      athlete: athleteId,
      season: request.season ?? 'current',
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { rows: [], seasons: [] };
  }
}

/**
 * One athlete's appearances reaching back until there are enough of them.
 *
 * The current season first, then earlier ones while the record is still short
 * of `want` and the athlete has earlier seasons to offer. Which seasons exist
 * comes from the first response rather than from a guess, so a rookie costs
 * one request and a veteran costs only as many as the sample needs.
 *
 * `before` is the look-ahead boundary and is applied here rather than left to
 * the caller: an appearance at or after it is not evidence about the fixture
 * being projected, and a function that returned it would be one mistake away
 * from leaking a result into its own prediction.
 */
export async function athleteHistory(
  leaguePath: string,
  athleteId: string,
  before: number,
  want: number,
  request: Omit<GamelogRequest, 'season'> = {},
): Promise<GamelogRow[]> {
  const first = await athleteGamelog(leaguePath, athleteId, request);
  const rows = first.rows.filter((row) => row.date < before);
  if (rows.length >= want || first.seasons.length === 0) return rows;

  /*
   * Only seasons that could contain an appearance before the boundary. Asking
   * for a season that begins after the fixture would spend a request to
   * receive games the filter above then throws away.
   */
  const boundaryYear = new Date(before).getUTCFullYear();
  const earlier = first.seasons.filter((year) => year <= boundaryYear).slice(0, 4);

  for (const season of earlier) {
    if (rows.length >= want) break;
    const older = await athleteGamelog(leaguePath, athleteId, { ...request, season });
    for (const row of older.rows) {
      if (row.date >= before) continue;
      if (rows.some((existing) => existing.eventId === row.eventId)) continue;
      rows.push(row);
    }
  }

  rows.sort((a, b) => b.date - a.date);
  return rows;
}
