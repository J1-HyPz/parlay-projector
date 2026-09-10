/**
 * Announced starting pitchers, and their records, for the live model.
 *
 * The counterpart to `lib/projections/pitchers.ts`, which holds the pure
 * arithmetic. This half fetches, caches, and hands that arithmetic exactly the
 * inputs the backtest handed it — which is the point. A model measured on one
 * definition of a pitcher's rate and shipped on another has not been measured
 * at all, so both paths build the rate from the same per-start log through the
 * same `rateBefore`, rather than the live path taking the season-to-date ERA
 * the scoreboard offers for free.
 *
 * That ERA is genuinely free and genuinely unusable for this: it is a
 * season-to-date figure, so a backtest built on it would score a fixture using
 * starts made after it. The gamelog costs one request per pitcher and carries
 * every start with its date, which is what makes a point-in-time rate possible
 * at all.
 */

import { cached } from '../../cache.ts';
import { espnConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { fetchEspn } from './client.ts';
import { getJson } from '../../http.ts';
import { parseInnings, rateBefore } from '../../projections/pitchers.ts';
import type { FixturePitchers, PitcherStart } from '../../projections/pitchers';

/**
 * The gamelog lives on a different ESPN base path from everything else here.
 *
 * `<sport>/<league>/athletes/<id>/gamelog` on the site API returns 404; this
 * common path returns the whole season a start at a time. Passed through the
 * shared request helper anyway, for its timeout and size cap.
 */
const COMMON_BASE = 'https://site.web.api.espn.com/apis/common/v3/sports';

/** A pitcher's season does not change between starts; a day is ample. */
const LOG_TTL_MS = 6 * 60 * 60_000;
/** Probables are announced a day or two out and can change; keep this short. */
const PROBABLES_TTL_MS = 15 * 60_000;

interface RawGamelog {
  names?: unknown;
  events?: Record<string, { gameDate?: unknown }>;
  seasonTypes?: { categories?: { events?: { eventId?: unknown; stats?: unknown[] }[] }[] }[];
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Every start on a pitcher's record, with the date each one began.
 *
 * Flattened out of the provider's month-by-month grouping, which carries no
 * meaning worth preserving. An entry missing its date, innings or runs is
 * dropped rather than defaulted — a start recorded as zero innings would drag
 * a rate toward a number the pitcher never produced.
 */
async function fetchStarts(athleteId: string): Promise<PitcherStart[]> {
  const raw = await getJson<RawGamelog>(
    `${COMMON_BASE}/baseball/mlb/athletes/${encodeURIComponent(athleteId)}/gamelog`,
    { timeoutMs: espnConfig.timeoutMs },
  );
  if (!raw) return [];

  const names = Array.isArray(raw.names) ? raw.names.map((name) => str(name)) : [];
  const innings = names.indexOf('innings');
  const runs = names.indexOf('runs');
  if (innings < 0 || runs < 0) return [];

  const starts: PitcherStart[] = [];
  for (const seasonType of raw.seasonTypes ?? []) {
    for (const category of seasonType.categories ?? []) {
      for (const event of category.events ?? []) {
        const eventId = str(event.eventId);
        if (!eventId) continue;

        const date = Date.parse(str(raw.events?.[eventId]?.gameDate) ?? '');
        const pitched = parseInnings(event.stats?.[innings]);
        const allowed = Number(event.stats?.[runs]);
        if (!Number.isFinite(date) || pitched === null || !Number.isFinite(allowed)) continue;

        starts.push({ event_id: eventId, date, innings: pitched, runs: allowed });
      }
    }
  }
  return starts;
}

/** One pitcher's starts, cached. */
export async function pitcherStarts(athleteId: string): Promise<PitcherStart[]> {
  if (!espnConfig.enabled) return [];
  try {
    const { value } = await cached(`espn:pitcher:${athleteId}`, LOG_TTL_MS, () =>
      fetchStarts(athleteId),
    );
    return value;
  } catch (error) {
    logger.warn('espn_pitcher_log_failed', {
      athlete: athleteId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return [];
  }
}

interface RawScoreboard {
  events?: {
    id?: unknown;
    competitions?: {
      competitors?: {
        homeAway?: unknown;
        probables?: { athlete?: { id?: unknown; displayName?: unknown } }[];
      }[];
    }[];
  }[];
}

/** One announced starter. */
export interface AnnouncedStarter {
  id: string;
  name: string | null;
}

/** Announced starters for one fixture. */
export interface AnnouncedStarters {
  home: AnnouncedStarter | null;
  away: AnnouncedStarter | null;
}

/**
 * Who each side has announced, for every fixture on one date.
 *
 * Keyed by the application's own game id so a caller can look up a fixture
 * without knowing the provider's numbering.
 */
async function fetchAnnounced(date: string): Promise<Map<string, AnnouncedStarters>> {
  const payload = await fetchEspn<RawScoreboard>(
    'baseball/mlb/scoreboard',
    `dates=${date}&limit=400`,
  );

  const byGame = new Map<string, AnnouncedStarters>();
  for (const event of payload?.events ?? []) {
    const eventId = str(event.id);
    if (!eventId) continue;

    const competitors = event.competitions?.[0]?.competitors ?? [];
    const sideOf = (side: 'home' | 'away'): AnnouncedStarter | null => {
      const competitor = competitors.find((entry) => str(entry?.homeAway) === side);
      const athlete = competitor?.probables?.[0]?.athlete;
      const id = str(athlete?.id);
      return id ? { id, name: str(athlete?.displayName) } : null;
    };

    const home = sideOf('home');
    const away = sideOf('away');
    if (!home && !away) continue;
    byGame.set(`espn-mlb-${eventId}`, { home, away });
  }
  return byGame;
}

/** Announced starters across a set of dates, `YYYYMMDD`. */
export async function announcedStarters(
  dates: readonly string[],
): Promise<Map<string, AnnouncedStarters>> {
  if (!espnConfig.enabled) return new Map();

  const merged = new Map<string, AnnouncedStarters>();
  await Promise.all(
    dates.map(async (date) => {
      try {
        const { value } = await cached(`espn:probables:${date}`, PROBABLES_TTL_MS, () =>
          fetchAnnounced(date),
        );
        for (const [gameId, starters] of value) merged.set(gameId, starters);
      } catch (error) {
        logger.warn('espn_probables_failed', {
          date,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }),
  );
  return merged;
}

/**
 * Rates for a fixture's two announced starters, as at its kick-off.
 *
 * Null where neither side has an announced starter with enough history — in
 * which case the projection is identical to one made before this existed,
 * which is the behaviour the backtest measured against.
 */
export async function pitchersForFixture(
  starters: AnnouncedStarters | undefined,
  kickoff: number,
): Promise<FixturePitchers | null> {
  if (!starters) return null;

  const rateFor = async (starter: AnnouncedStarter | null) => {
    if (!starter) return null;
    const rate = rateBefore(await pitcherStarts(starter.id), kickoff);
    return rate ? { ...rate, name: starter.name } : null;
  };

  const [home, away] = await Promise.all([rateFor(starters.home), rateFor(starters.away)]);
  if (!home && !away) return null;
  return { home, away };
}
