/**
 * ESPN path mapping.
 *
 * ESPN organises by sport and competition, so an internal sport id maps to one
 * path for the North American leagues and to a per-competition path for
 * football. Competitions are listed explicitly rather than guessed: an unknown
 * competition simply yields no enrichment.
 */

import type { ConcreteSportId } from '../../home/types';

/** Sports with a single ESPN league path. */
const SINGLE_LEAGUE: Partial<Record<ConcreteSportId, string>> = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  mlb: 'baseball/mlb',
  nhl: 'hockey/nhl',
  tennis: 'tennis/atp',
};

/**
 * Football competitions, keyed by lowercase league name as the primary
 * provider reports it. Only competitions actually covered are listed.
 */
const FOOTBALL_LEAGUES: Record<string, string> = {
  'english premier league': 'soccer/eng.1',
  'premier league': 'soccer/eng.1',
  'uefa champions league': 'soccer/uefa.champions',
  'champions league': 'soccer/uefa.champions',
  'uefa europa league': 'soccer/uefa.europa',
  'europa league': 'soccer/uefa.europa',
  'spanish la liga': 'soccer/esp.1',
  'la liga': 'soccer/esp.1',
  'german bundesliga': 'soccer/ger.1',
  bundesliga: 'soccer/ger.1',
  'italian serie a': 'soccer/ita.1',
  'serie a': 'soccer/ita.1',
  'french ligue 1': 'soccer/fra.1',
  'ligue 1': 'soccer/fra.1',
  'english league championship': 'soccer/eng.2',
  'major league soccer': 'soccer/usa.1',
};

/**
 * ESPN path for a game, or null when the competition is not covered.
 *
 * Returning null is the normal case for a minor league, and simply means no
 * enrichment for that fixture.
 */
export function espnPathFor(sport: ConcreteSportId, league: string | null): string | null {
  if (sport === 'football') {
    const key = league?.trim().toLowerCase();
    return key ? (FOOTBALL_LEAGUES[key] ?? null) : null;
  }
  return SINGLE_LEAGUE[sport] ?? null;
}

/** Competitions covered, for documentation and diagnostics. */
export function coveredFootballLeagues(): string[] {
  return [...new Set(Object.values(FOOTBALL_LEAGUES))].sort();
}
