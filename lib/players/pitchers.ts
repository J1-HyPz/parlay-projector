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
import { parseInnings } from '../projections/pitchers.ts';
import { athleteHistory } from '../providers/espn/gamelog.ts';
import { announcedStarters, scoreboardDates } from '../providers/espn/pitchers.ts';
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

/**
 * An appearance of this many innings is a start rather than relief work.
 *
 * Three, because an opener goes one or two and a starter pulled early still
 * goes three. Measured on a live slate: real starters have 88-97% of their
 * appearances above it, a swing man 14%, and a pure reliever announced as an
 * opener **none at all**.
 */
const START_INNINGS = 3;

/**
 * Starts a pitcher needs on record before a start is projected at all.
 *
 * **An eligibility rule, not a rate rule, and the distinction is measured.**
 * Filtering the *rate* to starts only was tried and made the model lose to a
 * plain average — a pitcher's current strikeout level is better read from every
 * appearance, because the recency weighting is what tracks a change of role.
 * But "what is his level" and "does the model have any basis for projecting a
 * six-inning start" are different questions, and the second needs starts.
 *
 * Without this, a reliever named as an opener is projected from one-inning
 * outings: live, one carried an expectation of **0.82 strikeouts** for a start,
 * which is not a wrong estimate so much as an estimate of a different question.
 */
const MIN_STARTS_ON_RECORD = 8;

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

  const games: PlayerGame[] = [];
  let starts = 0;

  for (const row of rows) {
    const stats: Record<string, number> = {};
    for (const [name, raw] of Object.entries(row.stats)) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) stats[name] = parsed;
    }

    /*
     * Innings are thirds after the point, not decimals.
     *
     * `Number("6.1")` is 6.1 where the value means six and a third. Harmless for
     * the threshold below, and a landmine to leave in the record for anything
     * that later does arithmetic with it — so it is corrected here, through the
     * same function the team model's pitcher rate uses.
     */
    const innings = parseInnings(row.stats.innings);
    if (innings !== null) {
      stats.innings = innings;
      if (innings >= START_INNINGS) starts += 1;
    }

    games.push({
      athleteId: starter.athleteId,
      name: starter.name,
      teamId: starter.teamId,
      position: 'SP',
      gameId: `espn-mlb-${row.eventId}`,
      date: row.date,
      stats,
    });
  }

  if (starts < MIN_STARTS_ON_RECORD) {
    logger.info('pitcher_not_a_starter', {
      athlete: starter.athleteId,
      appearances: games.length,
      starts,
    });
    return [];
  }

  return games;
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

/**
 * Announced starters for one fixture, whichever scoreboard date lists it.
 *
 * Takes the fixture's kick-off rather than a date, because deriving the date is
 * where this goes wrong — see `scoreboardDates`.
 */
export async function announcedFor(startTime: string | null) {
  const dates = scoreboardDates(startTime);
  if (dates.length === 0) return new Map();

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
