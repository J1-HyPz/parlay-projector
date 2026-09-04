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
  | 'motorsport'
  | 'other';

/**
 * How a competition's events are contested.
 *
 * `fixture` is two sides and a score — every team sport here. `race` is a field
 * finishing in order, which has no home side, no away side and no score, and
 * so is normalised, displayed and projected differently throughout.
 */
export type LeagueFormat = 'fixture' | 'race';

/**
 * Which provider serves a competition.
 *
 * Most come from ESPN, which has richer coverage — standings, teams, rosters,
 * news and transactions. A few exist only on TheSportsDB, and those get
 * fixtures and results but not the rest; the UI degrades to an empty state
 * rather than pretending otherwise.
 */
export type LeagueProvider = 'espn' | 'thesportsdb';

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
  /** Which provider serves this competition. */
  provider: LeagueProvider;
  /**
   * Whether events are two-sided fixtures or a field finishing in order.
   *
   * Absent means `fixture`, which is every team competition — stated only
   * where it differs, so the catalogue does not repeat itself twenty times.
   */
  format?: LeagueFormat;
  /**
   * ESPN path segment, e.g. `basketball/wnba`.
   * Null for competitions ESPN does not carry.
   */
  espnPath: string | null;
  /**
   * TheSportsDB league id, e.g. `4405` for the CFL.
   * Null for competitions served by ESPN.
   */
  sportsdbLeagueId: string | null;
  /** Whether the provider publishes a standings table for this league. */
  hasStandings: boolean;
  /**
   * Whether the provider publishes structured transactions for this league.
   *
   * Verified against ESPN's core API: the five North American professional
   * leagues return real entries, while every soccer competition and both NCAA
   * divisions return an empty list. Recorded here so a hub can say "not
   * published for this competition" rather than showing a permanently empty
   * section that looks broken.
   */
  hasTransactions: boolean;
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
    provider: 'espn',
    espnPath: 'football/nfl',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: true,
    collegiate: false,
  },
  {
    id: 'ncaaf',
    label: 'NCAA Football',
    shortLabel: 'NCAAF',
    group: 'american-football',
    sport: 'nfl',
    provider: 'espn',
    espnPath: 'football/college-football',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: true,
  },

  /*
   * Competitions ESPN does not carry.
   *
   * ESPN holds CFL *teams* but publishes no fixtures or results for it at all —
   * its scoreboard returns zero events for every season — so these three come
   * from TheSportsDB, which does have them. Fixtures and results only: no
   * news, no transactions, and standings only where the provider publishes a
   * table.
   */
  {
    id: 'cfl',
    label: 'CFL',
    shortLabel: 'CFL',
    group: 'american-football',
    sport: 'nfl',
    provider: 'thesportsdb',
    espnPath: null,
    sportsdbLeagueId: '4405',
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'afle',
    label: 'American Football League Europe',
    shortLabel: 'AFLE',
    group: 'american-football',
    sport: 'nfl',
    provider: 'thesportsdb',
    espnPath: null,
    sportsdbLeagueId: '5877',
    // No table published for this competition; the hub says so rather than
    // rendering an empty one.
    hasStandings: false,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'efa',
    label: 'European Football Alliance',
    shortLabel: 'EFA',
    group: 'american-football',
    sport: 'nfl',
    provider: 'thesportsdb',
    espnPath: null,
    sportsdbLeagueId: '5876',
    hasStandings: false,
    hasTransactions: false,
    collegiate: false,
  },

  // Basketball
  {
    id: 'nba',
    label: 'NBA',
    shortLabel: 'NBA',
    group: 'basketball',
    sport: 'nba',
    provider: 'espn',
    espnPath: 'basketball/nba',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: true,
    collegiate: false,
  },
  {
    id: 'wnba',
    label: 'WNBA',
    shortLabel: 'WNBA',
    group: 'basketball',
    sport: 'nba',
    provider: 'espn',
    espnPath: 'basketball/wnba',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: true,
    collegiate: false,
  },
  {
    id: 'ncaam',
    label: "NCAA Men's Basketball",
    shortLabel: 'NCAAM',
    group: 'basketball',
    sport: 'nba',
    provider: 'espn',
    espnPath: 'basketball/mens-college-basketball',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: true,
  },
  {
    id: 'ncaaw',
    label: "NCAA Women's Basketball",
    shortLabel: 'NCAAW',
    group: 'basketball',
    sport: 'nba',
    provider: 'espn',
    espnPath: 'basketball/womens-college-basketball',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: true,
  },

  // Baseball
  {
    id: 'mlb',
    label: 'MLB',
    shortLabel: 'MLB',
    group: 'baseball',
    sport: 'mlb',
    provider: 'espn',
    espnPath: 'baseball/mlb',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: true,
    collegiate: false,
  },

  // Ice hockey
  {
    id: 'nhl',
    label: 'NHL',
    shortLabel: 'NHL',
    group: 'hockey',
    sport: 'nhl',
    provider: 'espn',
    espnPath: 'hockey/nhl',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: true,
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
    provider: 'espn',
    espnPath: 'soccer/eng.1',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'championship',
    label: 'EFL Championship',
    shortLabel: 'EFLC',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/eng.2',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'league-one',
    label: 'EFL League One',
    shortLabel: 'EFL1',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/eng.3',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'ucl',
    label: 'UEFA Champions League',
    shortLabel: 'UCL',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/uefa.champions',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'uel',
    label: 'UEFA Europa League',
    shortLabel: 'UEL',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/uefa.europa',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'uecl',
    label: 'UEFA Conference League',
    shortLabel: 'UECL',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/uefa.europa.conf',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'laliga',
    label: 'La Liga',
    shortLabel: 'LIGA',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/esp.1',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'bundesliga',
    label: 'Bundesliga',
    shortLabel: 'BUN',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/ger.1',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },
  {
    id: 'seriea',
    label: 'Serie A',
    shortLabel: 'SERA',
    group: 'football',
    sport: 'football',
    provider: 'espn',
    espnPath: 'soccer/ita.1',
    sportsdbLeagueId: null,
    hasStandings: true,
    hasTransactions: false,
    collegiate: false,
  },

  // Motorsport
  {
    id: 'f1',
    label: 'Formula 1',
    shortLabel: 'F1',
    group: 'motorsport',
    sport: 'f1',
    provider: 'espn',
    // Verified live: returns the full season calendar, each Grand Prix
    // carrying its practice, qualifying and race sessions with the field in
    // finishing order.
    espnPath: 'racing/f1',
    format: 'race',
    sportsdbLeagueId: null,
    // Drivers' and Constructors' championships, on the v2 standings path.
    hasStandings: true,
    // Transactions are a North American professional-league concept; the
    // provider publishes none for motorsport.
    hasTransactions: false,
    collegiate: false,
  },
] as const;

/** True for a competition contested by a field rather than by two sides. */
export function isRaceLeague(league: League): boolean {
  return league.format === 'race';
}

/** Competitions served by a given provider. */
export function leaguesByProvider(provider: LeagueProvider): League[] {
  return LEAGUES.filter((league) => league.provider === provider);
}

/** True when the competition's provider supplies news and transactions. */
export function supportsEditorialData(league: League): boolean {
  return league.provider === 'espn';
}

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
