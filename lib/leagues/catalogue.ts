/**
 * What the parlay engine can actually build from.
 *
 * Derived from the league catalogue rather than listed a second time. The
 * Parlays page used to carry its own array of six sports, which was already
 * wrong — it offered neither tennis nor Formula 1 months after both were
 * added, because nothing connected it to the registry. A sport or competition
 * added to `LEAGUES` now appears in the selector with no further change, and
 * one that is removed disappears from it.
 *
 * Two questions are answered here and nowhere else:
 *
 *   Which competitions exist?   the registry
 *   Which can be projected?     the model configuration
 *
 * They are different questions. A competition can be tracked — fixtures,
 * results, standings — without the projection engine having a model for its
 * sport, and a sport can be recognised by the application without a single
 * competition being tracked for it yet. Both cases are reported as what they
 * are rather than by quietly dropping the sport, so the selector never offers
 * something that can only ever fail.
 *
 * Pure data and lookups; no network, no configuration.
 */

import { SPORT_IDS } from '../home/types.ts';
import type { ConcreteSportId, SportId } from '../home/types';
import { modelConfigForLeague } from '../projections/config.ts';
import { sportLabel } from '../schedule/filters.ts';
import { FOOTBALL_GROUPS } from '../sports/hubs.ts';
import { findLeague, LEAGUES } from './registry.ts';
import type { League } from './registry';

/** Sentinel for "every sport", matching the rest of the application. */
export const ALL_SPORTS = 'all';
/** Sentinel for "every competition in the chosen sport". */
export const ALL_COMPETITIONS = 'all';

/**
 * Whether the engine has a model for this competition.
 *
 * A race carries its own model — a field finishing in order, which the scoring
 * model knows nothing about — so it is projectable despite having no entry in
 * the scoring model's table.
 */
export function isProjectable(league: League): boolean {
  if (league.format === 'race') return true;
  return modelConfigForLeague(league.id, league.sport) !== null;
}

/** Region headings the catalogue already records, keyed by league id. */
const REGION_BY_LEAGUE = new Map<string, string>(
  FOOTBALL_GROUPS.flatMap((group) => group.slugs.map((slug) => [slug, group.label] as const)),
);

export interface CompetitionOption {
  /** Catalogue id — the stable identity, used in requests and cache keys. */
  id: string;
  label: string;
  short_label: string;
  /**
   * Region heading, where one is already known.
   *
   * Only football has these, because only football has enough competitions for
   * an ungrouped list to be hard to read. Nothing is invented for the sports
   * that do not need it.
   */
  group: string | null;
}

export interface SportOption {
  id: ConcreteSportId;
  label: string;
  /**
   * Catch-all label, e.g. `All football competitions`.
   *
   * Null when the sport has exactly one tracked competition — offering "all"
   * and one identical choice below it is noise, so the selector simply shows
   * the competition.
   */
  all_label: string | null;
  /** False when no competition for this sport can currently be projected. */
  supported: boolean;
  /**
   * Why it cannot, when it cannot.
   *
   * Shown rather than the sport being hidden: a reader who knows the
   * application tracks tennis should be told what is missing, not left to
   * wonder where it went.
   */
  unavailable: string | null;
  competitions: CompetitionOption[];
}

function toOption(league: League): CompetitionOption {
  return {
    id: league.id,
    label: league.label,
    short_label: league.shortLabel,
    group: REGION_BY_LEAGUE.get(league.id) ?? null,
  };
}

/**
 * Every sport the application recognises, with the competitions that qualify.
 *
 * `include` decides what qualifies, and the two callers want different things.
 * Parlays want competitions the engine can *project*, because offering one it
 * cannot model would be offering a dead end. The Live scoreboard wants every
 * competition *tracked*, because a scoreboard shows what is happening whether
 * or not there is a model behind it.
 *
 * In `SPORT_IDS` order, which is the order the rest of the application uses,
 * so every selector reads the same way.
 */
export function sportOptions(
  include: (league: League) => boolean = isProjectable,
): SportOption[] {
  return SPORT_IDS.filter((id): id is ConcreteSportId => id !== 'all').map((id) => {
    const tracked = LEAGUES.filter((league) => league.sport === id);
    const competitions = tracked.filter(include);
    const label = sportLabel(id);

    return {
      id,
      label,
      all_label: competitions.length > 1 ? `All ${label} competitions` : null,
      supported: competitions.length > 0,
      unavailable:
        competitions.length > 0
          ? null
          : tracked.length === 0
            ? 'No competition is tracked for this sport yet.'
            : 'The projection engine has no model for this sport yet.',
      competitions: competitions.map(toOption),
    };
  });
}

/** The competitions the engine can build from, for one sport or all of them. */
export function projectableLeagues(sport: SportId = ALL_SPORTS): League[] {
  return LEAGUES.filter(
    (league) => isProjectable(league) && (sport === ALL_SPORTS || league.sport === sport),
  );
}

/**
 * A resolved sport and competition filter.
 *
 * `leagues` is the authoritative list: whatever the engine is given, it is
 * given exactly these and nothing else. That is what makes the filter binding
 * rather than advisory — there is no later stage that could reach past it for
 * a stronger selection in another competition.
 */
export interface ParlayScope {
  sport: SportId;
  /** Catalogue league id, or null for every competition in the sport. */
  league: string | null;
  leagues: League[];
}

/**
 * Validate a sport and competition pair from a request.
 *
 * Returns null for anything the catalogue does not offer — an unknown sport, an
 * unknown competition, one with no model, or one belonging to a different sport
 * than the one asked for. A caller turns that into a 400 rather than silently
 * widening the search, which is the failure mode that would matter most: a
 * reader who asked for the Premier League must never be handed the NBA.
 */
export function resolveScope(
  rawSport: string | null | undefined,
  rawLeague: string | null | undefined,
): ParlayScope | null {
  const sportValue = (rawSport ?? ALL_SPORTS).trim().toLowerCase() || ALL_SPORTS;
  if (!(SPORT_IDS as readonly string[]).includes(sportValue)) return null;
  const sport = sportValue as SportId;

  const leagueValue = (rawLeague ?? '').trim().toLowerCase();

  if (leagueValue === '' || leagueValue === ALL_COMPETITIONS) {
    return { sport, league: null, leagues: projectableLeagues(sport) };
  }

  const league = findLeague(leagueValue);
  if (!league || !isProjectable(league)) return null;
  // A competition from another sport is a contradiction, not a widening.
  if (sport !== ALL_SPORTS && league.sport !== sport) return null;

  return { sport, league: league.id, leagues: [league] };
}

/** How a scope should be described in a heading or a summary. */
export function describeScope(scope: ParlayScope): { sport: string; competition: string } {
  const sport = scope.sport === ALL_SPORTS ? 'All sports' : sportLabel(scope.sport);

  if (scope.league) {
    return { sport, competition: findLeague(scope.league)?.label ?? scope.league };
  }

  if (scope.sport === ALL_SPORTS) return { sport, competition: 'All competitions' };

  const option = sportOptions().find((entry) => entry.id === scope.sport);
  return {
    sport,
    competition: option?.all_label ?? option?.competitions[0]?.label ?? 'All competitions',
  };
}
