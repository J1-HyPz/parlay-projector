/**
 * Pure merge rules for cross-provider data.
 *
 * Kept separate from `enrichment.ts` so it has no runtime imports and is
 * directly unit-testable — the enrichment service itself pulls in config,
 * logging and adapters.
 */

import type { FormResult, RecentGame, TeamStanding } from '../games/types';

/** One previous meeting, as the enrichment provider reports it. */
export interface ProviderMeeting {
  id: string;
  date: string | null;
  home: string | null;
  away: string | null;
  homeScore: number | null;
  awayScore: number | null;
}

/**
 * Parse a record summary into a standing.
 *
 * `11-2` is wins-losses; `1-0-1` is wins-draws-losses (football) or
 * wins-losses-overtime (hockey). An unparseable value leaves the existing
 * standing untouched rather than blanking it.
 */
export function recordToStanding(
  record: string | null,
  existing: TeamStanding | null,
): TeamStanding | null {
  if (!record) return existing;

  const parts = record.split('-').map((part) => Number.parseInt(part.trim(), 10));
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part))) return existing;

  const [wins, second, third] = parts;
  const draws = parts.length >= 3 ? (second ?? null) : null;
  const losses = parts.length >= 3 ? (third ?? null) : (second ?? null);

  return {
    // Detail the enrichment provider does not supply is preserved.
    rank: existing?.rank ?? null,
    played: existing?.played ?? null,
    wins: wins ?? null,
    draws,
    losses: losses ?? null,
    goals_for: existing?.goals_for ?? null,
    goals_against: existing?.goals_against ?? null,
    goal_difference: existing?.goal_difference ?? null,
    points: existing?.points ?? null,
    form: existing?.form ?? [],
    group: existing?.group ?? null,
  };
}

/** A standing built from form alone, when no record parsed. */
export function standingFromForm(form: FormResult[]): TeamStanding | null {
  if (form.length === 0) return null;
  return {
    rank: null, played: null, wins: null, draws: null, losses: null,
    goals_for: null, goals_against: null, goal_difference: null,
    points: null, form, group: null,
  };
}

/** Previous meetings, expressed from one team's point of view. */
export function meetingsToRecentGames(
  meetings: readonly ProviderMeeting[],
  teamName: string | null,
): RecentGame[] {
  if (!teamName) return [];

  const games: RecentGame[] = [];
  for (const meeting of meetings) {
    const isHome = meeting.home === teamName;
    const isAway = meeting.away === teamName;
    if (!isHome && !isAway) continue;

    const teamScore = isHome ? meeting.homeScore : meeting.awayScore;
    const opponentScore = isHome ? meeting.awayScore : meeting.homeScore;

    games.push({
      id: meeting.id,
      date: meeting.date ? meeting.date.slice(0, 10) : null,
      opponent: (isHome ? meeting.away : meeting.home) ?? 'Unknown',
      home: isHome,
      team_score: teamScore,
      opponent_score: opponentScore,
      result:
        teamScore === null || opponentScore === null
          ? null
          : teamScore > opponentScore
            ? 'W'
            : teamScore < opponentScore
              ? 'L'
              : 'D',
    });
  }
  return games;
}
