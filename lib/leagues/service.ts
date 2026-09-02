/**
 * League data service.
 *
 * Serves the league catalogue, standings, team lists and rosters from the
 * enrichment provider, which covers every listed competition without
 * credentials.
 *
 * Cached hard: rosters and standings change on the order of days, not seconds,
 * and every request costs provider budget.
 */

import { cached } from '../cache';
import { espnConfig } from '../config';
import { fetchEspn } from '../providers/espn/client';
import {
  getSportsdbStandings,
  getSportsdbTeams,
} from '../providers/thesportsdb/league-data';
import { logger } from '../logger';
import type { League } from './registry';
import {
  normaliseRoster,
  normaliseStandings,
  normaliseTeams,
} from './normalise';
import type {
  RawRosterResponse,
  RawStandingsGroup,
  RawTeamsResponse,
} from './normalise';
import type { PlayerProfile, StandingsGroup, TeamProfile } from './types';

/** Standings move at most once a day. */
const STANDINGS_TTL_MS = 60 * 60_000;
/** Team lists are effectively static within a season. */
const TEAMS_TTL_MS = 12 * 60 * 60_000;
/** Rosters change with transactions, so a few hours is plenty. */
const ROSTER_TTL_MS = 6 * 60 * 60_000;

/** Season year, in the provider's convention. */
function currentSeason(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

export async function getStandings(league: League): Promise<StandingsGroup[] | null> {
  if (!league.hasStandings) return null;

  // Competitions ESPN does not carry come from their own provider.
  if (league.provider === 'thesportsdb') {
    return getSportsdbStandings(league, String(currentSeason()));
  }

  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath) return null;

  try {
    const { value, hit } = await cached(
      `league:standings:${league.id}`,
      STANDINGS_TTL_MS,
      async () => {
        // The v2 host is the one that returns real groups; the site path
        // returns only a link stub.
        const payload = await fetchEspn<RawStandingsGroup>(
          `${espnPath}/standings`,
          `season=${currentSeason()}`,
          'v2',
        );
        return normaliseStandings(payload);
      },
    );

    if (!hit) {
      logger.info('league_standings_refreshed', {
        league: league.id,
        groups: value.length,
      });
    }
    return value.length > 0 ? value : null;
  } catch (error) {
    logger.warn('league_standings_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

export async function getTeams(league: League): Promise<TeamProfile[] | null> {
  if (league.provider === 'thesportsdb') return getSportsdbTeams(league);
  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath) return null;

  try {
    const { value } = await cached(`league:teams:${league.id}`, TEAMS_TTL_MS, async () => {
      const payload = await fetchEspn<RawTeamsResponse>(`${espnPath}/teams`);
      return normaliseTeams(payload);
    });
    return value.length > 0 ? value : null;
  } catch (error) {
    logger.warn('league_teams_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

export async function getRoster(
  league: League,
  teamId: string,
): Promise<PlayerProfile[] | null> {
  /*
   * Rosters are an ESPN capability.
   *
   * TheSportsDB has a player endpoint, but it carries no statistics and no
   * squad-by-season data worth the request, so these competitions report no
   * roster rather than a list that says nothing.
   */
  if (league.provider === 'thesportsdb') return null;
  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath) return null;

  try {
    const { value } = await cached(
      `league:roster:${league.id}:${teamId}`,
      ROSTER_TTL_MS,
      async () => {
        const payload = await fetchEspn<RawRosterResponse>(
          `${espnPath}/teams/${encodeURIComponent(teamId)}/roster`,
        );
        return normaliseRoster(payload);
      },
    );
    return value.length > 0 ? value : null;
  } catch (error) {
    logger.warn('league_roster_failed', {
      league: league.id,
      team: teamId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}
