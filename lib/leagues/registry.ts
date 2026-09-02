/**
 * League catalogue.
 *
 * Leagues are first-class here rather than implied by a sport id. "Basketball"
 * is not one thing: the NBA, the WNBA and the two NCAA divisions have separate
 * seasons, standings structures and rosters, and a user asking for college
 * basketball does not want NBA fixtures mixed in.
 *
 * Every entry is backed by a provider path that was verified to return real
 * data. Nothing speculative is listed — an unlisted competition simply is not
 * offered, rather than appearing and returning nothing.
 *
 * Pure data and lookups; no network, no config.
 */

import type { ConcreteSportId } from '../home/types';

/** Broad grouping used for filtering. */
export type LeagueGroup =
  | 'american-football'
  | 'basketball'
  | 'baseball'
  | 'hockey'
  | 'football'
  | 'other';

export interface League {
  /** Stable internal id used in URLs and cache keys. */
  id: string;
  label: string;
  /** Short label for chips and narrow columns. */
  shortLabel: string;
  group: LeagueGroup;
  /**
   * Internal sport id, where one applies. College and women's competitions map
   * onto the nearest existing sport so shared code keeps working.
   */
  sport: ConcreteSportId;
  /** ESPN path segment, e.g. `basketball/wnba`. */
  espnPath: string;
  /** Whether the provider publishes a standings table for this league. */
  hasStandings: boolean;
  /** True for collegiate competitions. */
  collegiate: boolean;
}

/**
 * Verified leagues.
 *
 * Each `espnPath` returned live fixtures when this catalogue was built.
 */
export const LEAGUES: readonly League[] = [
  // American football
  {
    id: 'nfl',
    label: 'NFL',
    shortLabel: 'NFL',
    group: 'american-football',
    sport: 'nfl',
    espnPath: 'football/nfl',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'ncaaf',
    label: 'NCAA Football',
    shortLabel: 'NCAAF',
    group: 'american-football',
    sport: 'nfl',
    espnPath: 'football/college-football',
    hasStandings: true,
    collegiate: true,
  },

  // Basketball
  {
    id: 'nba',
    label: 'NBA',
    shortLabel: 'NBA',
    group: 'basketball',
    sport: 'nba',
    espnPath: 'basketball/nba',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'wnba',
    label: 'WNBA',
    shortLabel: 'WNBA',
    group: 'basketball',
    sport: 'nba',
    espnPath: 'basketball/wnba',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'ncaam',
    label: "NCAA Men's Basketball",
    shortLabel: 'NCAAM',
    group: 'basketball',
    sport: 'nba',
    espnPath: 'basketball/mens-college-basketball',
    hasStandings: true,
    collegiate: true,
  },
  {
    id: 'ncaaw',
    label: "NCAA Women's Basketball",
    shortLabel: 'NCAAW',
    group: 'basketball',
    sport: 'nba',
    espnPath: 'basketball/womens-college-basketball',
    hasStandings: true,
    collegiate: true,
  },

  // Baseball
  {
    id: 'mlb',
    label: 'MLB',
    shortLabel: 'MLB',
    group: 'baseball',
    sport: 'mlb',
    espnPath: 'baseball/mlb',
    hasStandings: true,
    collegiate: false,
  },

  // Ice hockey
  {
    id: 'nhl',
    label: 'NHL',
    shortLabel: 'NHL',
    group: 'hockey',
    sport: 'nhl',
    espnPath: 'hockey/nhl',
    hasStandings: true,
    collegiate: false,
  },

  // Football / soccer — deliberately limited to the major competitions.
  // Without an explicit list the provider returns every league worldwide,
  // which buried the leagues anyone actually wants.
  {
    id: 'epl',
    label: 'Premier League',
    shortLabel: 'EPL',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/eng.1',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'championship',
    label: 'EFL Championship',
    shortLabel: 'EFLC',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/eng.2',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'league-one',
    label: 'EFL League One',
    shortLabel: 'EFL1',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/eng.3',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'ucl',
    label: 'UEFA Champions League',
    shortLabel: 'UCL',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/uefa.champions',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'uel',
    label: 'UEFA Europa League',
    shortLabel: 'UEL',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/uefa.europa',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'uecl',
    label: 'UEFA Conference League',
    shortLabel: 'UECL',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/uefa.europa.conf',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'laliga',
    label: 'La Liga',
    shortLabel: 'LIGA',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/esp.1',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'bundesliga',
    label: 'Bundesliga',
    shortLabel: 'BUN',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/ger.1',
    hasStandings: true,
    collegiate: false,
  },
  {
    id: 'seriea',
    label: 'Serie A',
    shortLabel: 'SERA',
    group: 'football',
    sport: 'football',
    espnPath: 'soccer/ita.1',
    hasStandings: true,
    collegiate: false,
  },
] as const;

export function findLeague(id: string | null | undefined): League | null {
  if (typeof id !== 'string') return null;
  const key = id.trim().toLowerCase();
  return LEAGUES.find((league) => league.id === key) ?? null;
}

export function leaguesInGroup(group: LeagueGroup): League[] {
  return LEAGUES.filter((league) => league.group === group);
}

export function leagueIds(): string[] {
  return LEAGUES.map((league) => league.id);
}

/**
 * Validate a league id from a request.
 *
 * Returns null for anything not on the catalogue, so an unknown value is a 404
 * rather than an unchecked path segment reaching the provider.
 */
export function parseLeagueId(raw: string | null | undefined): League | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  if (!/^[a-z0-9-]{1,32}$/i.test(raw.trim())) return null;
  return findLeague(raw);
}
