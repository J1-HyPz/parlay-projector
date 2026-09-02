/**
 * Standings and team lists from TheSportsDB.
 *
 * Only for the competitions ESPN does not carry. Emits the same
 * `StandingsGroup` and `TeamProfile` shapes the ESPN service does, so the hub
 * renders them without knowing the difference.
 *
 * Coverage is thinner than ESPN's and is not assumed: a competition with no
 * published table returns null and the hub says so, rather than rendering an
 * empty table that looks broken. There is no roster endpoint worth using here,
 * so rosters are simply unavailable for these competitions.
 */

import { cached } from '../../cache';
import { sportsConfig } from '../../config';
import { logger } from '../../logger';
import { getJson } from '../../http';
import type { League } from '../../leagues/registry';
import type { StandingsGroup, StandingsRow, TeamProfile } from '../../leagues/types';

/** Standings move at most once a day. */
const STANDINGS_TTL_MS = 60 * 60_000;
/** Team lists are effectively static within a season. */
const TEAMS_TTL_MS = 12 * 60 * 60_000;

function url(path: string, query: string): string {
  const base = sportsConfig.baseUrl.replace(/\/+$/, '');
  return `${base}/${sportsConfig.apiKey}/${path}?${query}`;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = str(value);
  if (text === null) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

interface RawTableRow {
  idTeam?: unknown;
  strTeam?: unknown;
  strBadge?: unknown;
  intRank?: unknown;
  intPlayed?: unknown;
  intWin?: unknown;
  intLoss?: unknown;
  intDraw?: unknown;
  intPoints?: unknown;
  intGoalsFor?: unknown;
  intGoalsAgainst?: unknown;
  intGoalDifference?: unknown;
  strForm?: unknown;
}

interface RawTableResponse {
  table?: RawTableRow[] | null;
}

export function normaliseSportsdbTable(
  payload: RawTableResponse | null | undefined,
  leagueLabel: string,
): StandingsGroup[] {
  const rows = payload?.table;
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const normalised: StandingsRow[] = [];

  for (const row of rows) {
    const id = str(row.idTeam);
    const name = str(row.strTeam);
    if (!id || !name) continue;

    const wins = num(row.intWin);
    const losses = num(row.intLoss);
    const played = num(row.intPlayed);

    normalised.push({
      team_id: id,
      team_name: name,
      abbreviation: null,
      logo: str(row.strBadge),
      rank: num(row.intRank),
      games_played: played,
      wins,
      losses,
      ties: num(row.intDraw),
      // Derived rather than provided; null when there is nothing to divide by.
      win_percent:
        wins !== null && losses !== null && wins + losses > 0 ? wins / (wins + losses) : null,
      games_behind: null,
      points_for: num(row.intGoalsFor),
      points_against: num(row.intGoalsAgainst),
      point_differential: num(row.intGoalDifference),
      points: num(row.intPoints),
      record: wins !== null && losses !== null ? `${wins}-${losses}` : null,
      streak: null,
    });
  }

  if (normalised.length === 0) return [];

  // This provider publishes one flat table per competition — no conferences or
  // divisions — so there is a single group.
  return [
    {
      id: 'overall',
      name: leagueLabel,
      abbreviation: null,
      rows: normalised.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999)),
    },
  ];
}

/** Null when the provider publishes no table for this competition. */
export async function getSportsdbStandings(
  league: League,
  season: string,
): Promise<StandingsGroup[] | null> {
  const leagueId = league.sportsdbLeagueId;
  if (!leagueId || !league.hasStandings) return null;

  try {
    const { value } = await cached(
      `sportsdb:table:${league.id}:${season}`,
      STANDINGS_TTL_MS,
      async () => {
        const payload = await getJson<RawTableResponse>(
          url('lookuptable.php', `l=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`),
          { timeoutMs: sportsConfig.timeoutMs, redactSecret: sportsConfig.apiKey },
        );
        return normaliseSportsdbTable(payload, league.label);
      },
    );

    return value.length > 0 ? value : null;
  } catch (error) {
    logger.warn('sportsdb_standings_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

interface RawTeam {
  idTeam?: unknown;
  strTeam?: unknown;
  strTeamShort?: unknown;
  strBadge?: unknown;
  strLocation?: unknown;
  strStadiumLocation?: unknown;
  strColour1?: unknown;
  idLeague?: unknown;
}

interface RawTeamsResponse {
  teams?: RawTeam[] | null;
}

export function normaliseSportsdbTeams(
  payload: RawTeamsResponse | null | undefined,
  leagueId: string,
): TeamProfile[] {
  const teams = payload?.teams;
  if (!Array.isArray(teams)) return [];

  const profiles: TeamProfile[] = [];

  for (const team of teams) {
    const id = str(team.idTeam);
    const name = str(team.strTeam);
    if (!id || !name) continue;

    /*
     * Guard against the provider answering with the wrong competition.
     *
     * On the public test key this endpoint ignores the league id and returns a
     * fixed demo set of English football clubs. Checking the id the rows carry
     * means a misconfigured or throttled key produces nothing rather than a hub
     * full of the wrong teams.
     */
    const rowLeague = str(team.idLeague);
    if (rowLeague !== null && rowLeague !== leagueId) continue;

    profiles.push({
      id,
      name,
      short_name: str(team.strTeamShort),
      abbreviation: str(team.strTeamShort),
      location: str(team.strLocation) ?? str(team.strStadiumLocation),
      logo: str(team.strBadge),
      colour: str(team.strColour1)?.replace(/^#/, '') ?? null,
    });
  }

  return profiles;
}

/** Null when the provider lists no teams for this competition. */
export async function getSportsdbTeams(league: League): Promise<TeamProfile[] | null> {
  const leagueId = league.sportsdbLeagueId;
  if (!leagueId) return null;

  try {
    const { value } = await cached(`sportsdb:teams:${league.id}`, TEAMS_TTL_MS, async () => {
      const payload = await getJson<RawTeamsResponse>(
        url('lookup_all_teams.php', `id=${encodeURIComponent(leagueId)}`),
        { timeoutMs: sportsConfig.timeoutMs, redactSecret: sportsConfig.apiKey },
      );
      return normaliseSportsdbTeams(payload, leagueId);
    });

    return value.length > 0 ? value : null;
  } catch (error) {
    logger.warn('sportsdb_teams_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}
