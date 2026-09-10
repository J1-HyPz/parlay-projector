/**
 * Meetings between two sides, across every archived season.
 *
 * Pure. Games in, a record out.
 *
 * This is the archive's first reader, and it costs no provider call at all —
 * which is the point. Today's head-to-head comes from ESPN's `seasonseries`
 * field on the fixture summary, which carries meetings *within the current
 * season only*: typically one to four games, and in August frequently none.
 * The same question asked of files already on disk reaches back as far as the
 * archive goes.
 *
 * What it deliberately does not do is score anything. Even across five seasons
 * most pairs have met a handful of times, and a 4-1 record over five years is
 * a fact about five afternoons rather than a property of either side. The
 * record is reported with its sample size attached and never folded into a
 * probability — the same discipline every other figure in this application
 * follows.
 */

import type { Game } from '../home/types';

/** One completed meeting, oriented as it was actually played. */
export interface Meeting {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  home: string;
  away: string;
  home_score: number;
  away_score: number;
}

export interface HeadToHeadRecord {
  /** Newest first. */
  meetings: Meeting[];
  played: number;
  /** Wins for the side named first, however it lined up on the day. */
  wins: number;
  losses: number;
  draws: number;
  /** Calendar years the record spans, for a reader judging its age. */
  from: string | null;
  to: string | null;
}

/** How a side is identified. Either half may be missing. */
export interface SideRef {
  id: string | null;
  name: string;
}

/**
 * Whether a team reference points at a side of a fixture.
 *
 * Id first, because a provider renames a club far more readily than it
 * renumbers one. Name is the fallback and is compared case-insensitively;
 * neither matching means the fixture is not between these two, which is the
 * safe answer.
 */
function matches(side: SideRef, team: { id?: string | null; name?: string } | undefined): boolean {
  if (!team) return false;
  if (side.id && team.id && side.id === team.id) return true;
  if (!team.name) return false;
  return team.name.toLowerCase() === side.name.toLowerCase();
}

function score(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Completed meetings between two sides, newest first.
 *
 * Only finished fixtures with both scores: a postponed meeting is not a
 * result, and counting it would put a fixture nobody played into a record.
 */
export function meetingsBetween(
  games: readonly Game[],
  first: SideRef,
  second: SideRef,
): Meeting[] {
  const meetings: Meeting[] = [];

  for (const game of games) {
    if (game.status !== 'finished') continue;

    const home = game.home_team;
    const away = game.away_team;
    const firstAtHome = matches(first, home) && matches(second, away);
    const secondAtHome = matches(second, home) && matches(first, away);
    if (!firstAtHome && !secondAtHome) continue;

    const homeScore = score(game.score?.home);
    const awayScore = score(game.score?.away);
    const date = game.start_time?.slice(0, 10);
    if (homeScore === null || awayScore === null || !date) continue;

    meetings.push({
      id: game.id,
      date,
      home: home?.name ?? '',
      away: away?.name ?? '',
      home_score: homeScore,
      away_score: awayScore,
    });
  }

  return meetings.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The record from one side's point of view.
 *
 * `subject` is whichever side the caller wants the tally to read for — the
 * home team of the fixture being previewed, normally. A meeting is counted by
 * who actually won it, not by who was at home in it.
 */
export function summariseMeetings(
  meetings: readonly Meeting[],
  subject: SideRef,
): HeadToHeadRecord {
  let wins = 0;
  let losses = 0;
  let draws = 0;

  for (const meeting of meetings) {
    const subjectAtHome = meeting.home.toLowerCase() === subject.name.toLowerCase();
    const own = subjectAtHome ? meeting.home_score : meeting.away_score;
    const other = subjectAtHome ? meeting.away_score : meeting.home_score;

    if (own > other) wins += 1;
    else if (own < other) losses += 1;
    else draws += 1;
  }

  const dates = meetings.map((meeting) => meeting.date).sort();

  return {
    meetings: [...meetings],
    played: meetings.length,
    wins,
    losses,
    draws,
    from: dates[0]?.slice(0, 4) ?? null,
    to: dates.at(-1)?.slice(0, 4) ?? null,
  };
}

/**
 * Meetings below which no pattern is worth stating.
 *
 * Six is not a large sample and is not claimed to be. It is the point at which
 * a lopsided record stops being describable by a single unusual afternoon, and
 * the wording that goes with it always carries the count so a reader can
 * discount it themselves.
 */
export const MIN_MEETINGS = 6;

/** Share of meetings one side must have won before the skew is mentioned. */
const CLEAR_SKEW = 0.7;

/**
 * A statable pattern, or null.
 *
 * Null is the usual answer and is meant to be. Most pairs have met four times
 * in five years, and "they have won two of four" is noise dressed as a
 * finding — exactly what the rest of this application refuses to print.
 */
export function headToHeadPattern(
  record: HeadToHeadRecord,
  subject: string,
  opponent: string,
): string | null {
  if (record.played < MIN_MEETINGS) return null;

  const decided = record.wins + record.losses;
  if (decided === 0) return null;

  const span = record.from && record.to && record.from !== record.to ? ` since ${record.from}` : '';

  if (record.wins / record.played >= CLEAR_SKEW) {
    return `${subject} have won ${record.wins} of the last ${record.played} meetings with ${opponent}${span}.`;
  }
  if (record.losses / record.played >= CLEAR_SKEW) {
    return `${opponent} have won ${record.losses} of the last ${record.played} meetings with ${subject}${span}.`;
  }
  return null;
}
