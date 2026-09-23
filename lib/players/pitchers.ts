/**
 * A fixture's two announced starting pitchers, as the player model wants them.
 *
 * The pilot market's data layer, and it is a different shape from the football
 * one on purpose. Rating a football squad means knowing about fifty people, so
 * the cheap source is the box score — one request, everyone in it. A pitcher
 * market is about exactly two named individuals, so the cheap source is their
 * own gamelogs: **two requests a fixture rather than sixty**, and reaching back
 * ten seasons instead of as far as the fixture window happens to go.
 *
 * Two rules hold it together, and both are load-bearing:
 *
 *   **No announcement, no market.** The provider names a probable starter, and
 *   that is the only participation evidence published for any individual in any
 *   sport here. Where it is absent this returns nothing, rather than guessing
 *   from whoever pitched last time — a market on the wrong pitcher would settle
 *   against a record the model never had an opinion about.
 *
 *   **Every appearance is strictly before the cut-off.** `athleteHistory`
 *   applies that boundary itself, so a backtest cannot read a start from the
 *   fixture it is projecting. The same function serves the live path and the
 *   harness, which is what makes a measured model the shipped model.
 */

import { logger } from '../logger.ts';
import { athleteHistory } from '../providers/espn/gamelog.ts';
import { announcedStarters } from '../providers/espn/pitchers.ts';
import type { AnnouncedStarters } from '../providers/espn/pitchers.ts';
import type { PlayerGame } from './history.ts';

/** Baseball's path on the gamelog host. */
const MLB_PATH = 'baseball/mlb';

/**
 * Appearances fetched per pitcher.
 *
 * Comfortably above the twenty `MLB_PITCHER_STATS` treats as a full sample, so
 * the rate is not still climbing when the market is priced, and low enough that
 * a pitcher costs one or two requests rather than a decade of them.
 */
const WANT_STARTS = 30;

/** Which side of the fixture a starter is on, and who they are. */
export interface FixtureStarter {
  side: 'home' | 'away';
  athleteId: string;
  name: string;
  /** Provider team id, so the projection is attributed to the right side. */
  teamId: string | null;
}

/**
 * One pitcher's appearances, in the shape the generic model reads.
 *
 * The gamelog hands back the provider's own text, so the conversion to numbers
 * happens here where the statistic is known. A value that is not a finite
 * number is omitted rather than written as zero — a start with no strikeout
 * column is not a start with no strikeouts, and averaging the difference in
 * would drag every rate toward nothing.
 */
export async function pitcherGames(
  starter: FixtureStarter,
  before: number,
): Promise<PlayerGame[]> {
  const rows = await athleteHistory(MLB_PATH, starter.athleteId, before, WANT_STARTS, {
    category: 'pitching',
  });

  return rows.map((row) => {
    const stats: Record<string, number> = {};
    for (const [name, raw] of Object.entries(row.stats)) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) stats[name] = parsed;
    }

    return {
      athleteId: starter.athleteId,
      name: starter.name,
      teamId: starter.teamId,
      position: 'SP',
      gameId: `espn-mlb-${row.eventId}`,
      date: row.date,
      stats,
    };
  });
}

/**
 * The two announced starters for one fixture, or an empty list.
 *
 * `dates` is what the scoreboard is keyed by, so the caller passes the fixture's
 * own date. A side with nobody announced is simply absent from the result, which
 * is the honest answer and is commoner than both sides being named — measured,
 * seven of twelve fixtures had both and five had one.
 */
export function fixtureStarters(
  announced: AnnouncedStarters | undefined,
  teams: { home: string | null; away: string | null },
): FixtureStarter[] {
  if (!announced) return [];

  const out: FixtureStarter[] = [];
  for (const side of ['home', 'away'] as const) {
    const starter = announced[side];
    if (!starter?.name) continue;
    out.push({
      side,
      athleteId: starter.id,
      name: starter.name,
      teamId: teams[side],
    });
  }
  return out;
}

/** Announced starters for a set of fixture dates, `YYYYMMDD`. */
export async function announcedFor(dates: readonly string[]) {
  try {
    return await announcedStarters(dates);
  } catch (error) {
    // No announcement is a reason to publish nothing, never a reason to fail:
    // the fixture still has a team projection and a page to render.
    logger.warn('pitcher_probables_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return new Map();
  }
}
