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
import { athleteGamelog } from './gamelog.ts';
import type { GamelogRow } from './gamelog.ts';
import { parseInnings, rateBefore } from '../../projections/pitchers.ts';
import type { FixturePitchers, PitcherStart } from '../../projections/pitchers';

/** Probables are announced a day or two out and can change; keep this short. */
const PROBABLES_TTL_MS = 15 * 60_000;

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * A pitcher's starts, read out of gamelog rows.
 *
 * Pure, and exported for that reason: the innings notation is the one thing
 * here that has gone wrong before, and it should be checkable without a
 * network. Dating and flattening are the adapter's job by the time rows arrive.
 */
export function startsFrom(rows: readonly GamelogRow[]): PitcherStart[] {
  const starts: PitcherStart[] = [];

  for (const row of rows) {
    const pitched = parseInnings(row.stats.innings);
    const allowed = Number(row.stats.runs);
    // A start recorded as no innings would drag a rate toward a number the
    // pitcher never produced, so an unreadable row is dropped rather than
    // defaulted.
    if (pitched === null || !Number.isFinite(allowed)) continue;

    starts.push({ event_id: row.eventId, date: row.date, innings: pitched, runs: allowed });
  }

  return starts;
}

/**
 * One pitcher's starts, cached.
 *
 * Reads through the shared gamelog adapter rather than parsing the payload
 * again here. The rate this produces feeds the *team* model, so the only thing
 * that mattered in moving it was that the numbers not change — `innings` still
 * goes through `parseInnings`, which is the whole reason the adapter hands back
 * the provider's own text instead of helpfully converting it.
 */
export async function pitcherStarts(athleteId: string): Promise<PitcherStart[]> {
  if (!espnConfig.enabled) return [];
  const { rows } = await athleteGamelog('baseball/mlb', athleteId);
  return startsFrom(rows);
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

/**
 * The scoreboard dates a fixture could be listed under.
 *
 * **The scoreboard is keyed by US date, not UTC**, and getting this wrong loses
 * most of an evening's card. Measured: event 401817044 starts at
 * `2026-09-23T01:40Z` and appears on the **22nd's** board, because 01:40 UTC is
 * half past nine the previous evening in the east. Asking only for the UTC date
 * therefore finds no announced starter for any fixture beginning before about
 * four in the morning UTC — which is nearly every night game.
 *
 * So both candidates are asked for. Each is cached per date and the slate-wide
 * build already fetches most of them, so the second one is usually free.
 */
export function scoreboardDates(startTime: string | null): string[] {
  if (!startTime) return [];
  const at = Date.parse(startTime);
  if (!Number.isFinite(at)) return [];

  const compact = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
  // The UTC day, and the one before it. Ordered newest first so a caller
  // reading the first match gets the more likely one.
  return [...new Set([compact(at), compact(at - 86_400_000)])];
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
