/**
 * Narrowing the scoreboard.
 *
 * The Live page used to build its filters out of whatever happened to be in
 * play: a sport with no live game had no chip, so on a quiet Tuesday morning
 * the page offered a single "All" button and said nothing about the seven
 * sports it actually follows. The filters described the minute rather than the
 * application.
 *
 * So the sport row is now the tracked sports — always all of them, each
 * carrying how many of its games are live and how many are still to come. A
 * sport with nothing on says so instead of vanishing, which is a smaller,
 * truer statement than an empty row.
 *
 * Counts are *faceted*: they answer "what would I get if I picked this
 * instead", so they respect the search box but not the sport already chosen.
 * Counting the current selection into every other chip would leave the whole
 * row reading zero the moment anything was picked.
 *
 * Pure. No provider, no fetching, no React — so every rule here is testable on
 * its own, which is what the scoreboard's filters never were.
 */

import type { ConcreteSportId, Game } from '../home/types.ts';
import { LEAGUES } from '../leagues/registry.ts';
import { sportOptions } from '../leagues/catalogue.ts';
import { matchesSearch, sportLabel } from '../schedule/filters.ts';

/** Sentinel for "every sport". */
export const ALL_SPORTS = 'all';
/** Sentinel for "every competition in the chosen sport". */
export const ALL_COMPETITIONS = 'all';
/**
 * Sentinel for "only competitions this application tracks".
 *
 * Worth having because the scoreboard's provider is a firehose. It answers
 * with every live game in a sport anywhere in the world — the Chilean second
 * division, the Salvadoran top flight, a Canadian junior hockey game — while
 * the rest of the application follows a catalogue of twenty-one competitions.
 * Neither set is wrong, but they are different questions, and until now the
 * page could only ask the broad one.
 */
export const TRACKED_COMPETITIONS = 'tracked';

/**
 * Catalogue id for a game, from the label it carries.
 *
 * Games carry a competition's display name; everything that has to keep
 * meaning the same thing next season keys on its id. The normalisers set the
 * label from the catalogue for both providers, so the reverse lookup is exact
 * rather than a guess — and a game from outside the catalogue simply has no id
 * rather than being forced into one.
 */
const LEAGUE_ID_BY_LABEL = new Map(LEAGUES.map((league) => [league.label, league.id]));

export function leagueIdFor(game: Game): string | null {
  if (!game.league) return null;
  return LEAGUE_ID_BY_LABEL.get(game.league) ?? null;
}

export interface LiveFilters {
  /** `all`, or a concrete sport id. */
  sport: string;
  /** `all`, or a catalogue league id. */
  league: string;
  search: string;
}

export const NO_FILTERS: LiveFilters = {
  sport: ALL_SPORTS,
  league: ALL_COMPETITIONS,
  search: '',
};

/** Whether a game survives the sport filter alone. */
export function matchesSport(game: Game, sport: string): boolean {
  return sport === ALL_SPORTS || game.sport === sport;
}

/**
 * Whether a game survives the competition filter alone.
 *
 * Matched on the competition's *name*, not its catalogue id, because most live
 * games have no catalogue id — they are from competitions the application does
 * not follow. Filtering on ids here would silently drop nine games in ten.
 */
export function matchesCompetition(game: Game, league: string): boolean {
  if (league === ALL_COMPETITIONS) return true;
  if (league === TRACKED_COMPETITIONS) return leagueIdFor(game) !== null;
  return game.league === league;
}

/**
 * Every active filter at once.
 *
 * They narrow the same set rather than replacing one another, so picking
 * Basketball and typing "lakers" means both, not the second instead of the
 * first.
 */
export function matchesLive(game: Game, filters: LiveFilters): boolean {
  if (!matchesSport(game, filters.sport)) return false;
  if (!matchesCompetition(game, filters.league)) return false;
  return matchesSearch(game, filters.search);
}

// ---------------------------------------------------------------------------
// What each choice would give you
// ---------------------------------------------------------------------------

export interface SportTally {
  id: ConcreteSportId;
  label: string;
  /** Games in play. */
  live: number;
  /** Games still to start today. */
  upcoming: number;
  /**
   * Competitions the application tracks for this sport.
   *
   * Zero means there is nothing to show and never will be until one is added —
   * a different thing from "nothing on right now", and worth saying
   * differently.
   */
  tracked: number;
  /** Why there is nothing, when the sport itself is not tracked. */
  unavailable: string | null;
}

/**
 * Live and upcoming counts for every tracked sport.
 *
 * Always every sport, in the application's usual order, so the row is a stable
 * thing a reader can learn rather than a list that reshuffles itself each time
 * a game ends.
 */
export function tallySports(
  live: readonly Game[],
  upcoming: readonly Game[],
  search = '',
): SportTally[] {
  const matching = (games: readonly Game[], sport: ConcreteSportId) =>
    games.filter((game) => game.sport === sport && matchesSearch(game, search)).length;

  // Every tracked competition counts here, not only the ones with a model: a
  // scoreboard shows what is happening whether or not it can be predicted.
  return sportOptions(() => true).map((option) => ({
    id: option.id,
    label: option.label,
    live: matching(live, option.id),
    upcoming: matching(upcoming, option.id),
    tracked: option.competitions.length,
    unavailable: option.unavailable,
  }));
}

export interface CompetitionTally {
  /** The competition's name, or one of the two sentinels. */
  id: string;
  label: string;
  live: number;
  /** Whether this competition is one the application follows. */
  tracked: boolean;
}

/** Catalogue order, so the followed competitions lead the list. */
const CATALOGUE_ORDER = new Map(LEAGUES.map((league, index) => [league.label, index]));

/**
 * Competitions worth offering for the chosen sport.
 *
 * Built from the games actually on the board rather than from the catalogue.
 * The catalogue version of this read every competition as `(0)`, because the
 * scoreboard's provider returns whatever is being played worldwide and almost
 * none of it is in the catalogue — a list of ten zeroes above nineteen visible
 * games, which is worse than no list at all.
 *
 * Followed competitions sort first, in catalogue order; the rest follow
 * alphabetically. A "tracked only" row sits at the top when the two sets
 * differ, which is the quickest way to get from the firehose to the twenty-one
 * competitions the rest of the application is about.
 */
export function competitionTallies(
  sport: string,
  live: readonly Game[],
  search = '',
): CompetitionTally[] {
  const inScope = live.filter(
    (game) => matchesSport(game, sport) && matchesSearch(game, search),
  );

  const counts = new Map<string, number>();
  for (const game of inScope) {
    if (!game.league) continue;
    counts.set(game.league, (counts.get(game.league) ?? 0) + 1);
  }

  // One competition and nothing to compare it against is not a choice.
  if (counts.size <= 1) return [];

  const rows: CompetitionTally[] = [...counts.entries()]
    .map(([label, count]) => ({
      id: label,
      label,
      live: count,
      tracked: LEAGUE_ID_BY_LABEL.has(label),
    }))
    .sort((a, b) => {
      const left = CATALOGUE_ORDER.get(a.label);
      const right = CATALOGUE_ORDER.get(b.label);
      if (left !== undefined && right !== undefined) return left - right;
      if (left !== undefined) return -1;
      if (right !== undefined) return 1;
      return a.label.localeCompare(b.label);
    });

  const trackedCount = rows
    .filter((row) => row.tracked)
    .reduce((sum, row) => sum + row.live, 0);

  const scopeLabel =
    sport === ALL_SPORTS ? 'All competitions' : `All ${sportLabel(sport as ConcreteSportId).toLowerCase()}`;

  const head: CompetitionTally[] = [
    { id: ALL_COMPETITIONS, label: scopeLabel, live: inScope.length, tracked: false },
  ];

  // Only offered when it would actually narrow anything.
  if (trackedCount > 0 && trackedCount < inScope.length) {
    head.push({
      id: TRACKED_COMPETITIONS,
      label: 'Tracked competitions',
      live: trackedCount,
      tracked: true,
    });
  }

  return [...head, ...rows];
}

/**
 * A short description of what is currently being looked at.
 *
 * Used in the empty state, so "nothing here" always says what "here" was — the
 * previous message named the sport and dropped the competition and the search
 * term, which made a search returning nothing look like a broken page.
 */
export function describeFilters(filters: LiveFilters): string {
  const parts: string[] = [];

  const named =
    filters.league !== ALL_COMPETITIONS && filters.league !== TRACKED_COMPETITIONS
      ? filters.league
      : null;

  if (named) {
    parts.push(named);
  } else if (filters.sport !== ALL_SPORTS) {
    parts.push(sportLabel(filters.sport as ConcreteSportId));
  }

  if (filters.league === TRACKED_COMPETITIONS) parts.push('in a tracked competition');

  const term = filters.search.trim();
  if (term) parts.push(`matching “${term}”`);

  return parts.join(' ');
}

/** Whether anything is narrowing the board at all. */
export function isFiltered(filters: LiveFilters): boolean {
  return (
    filters.sport !== ALL_SPORTS ||
    filters.league !== ALL_COMPETITIONS ||
    filters.search.trim() !== ''
  );
}
