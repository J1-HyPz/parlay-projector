/**
 * Splitting a competition's fixtures into the sections a hub renders.
 *
 * Pure, so the boundary rules are testable: which bucket a game falls into is
 * the only real logic in the hub's scores area, and the awkward cases (a game
 * still marked live from yesterday, a postponement sitting in the future) are
 * decided here rather than scattered through components.
 *
 * Operates on the shared `Game` model. No second score or status vocabulary is
 * introduced.
 */

import { gameDate } from '../schedule/range.ts';
import type { Game } from '../home/types';

/** How many days either side of today a hub loads. */
export const HUB_DAYS_BACK = 7;
export const HUB_DAYS_AHEAD = 7;

export interface HubGameSections {
  /** In progress right now, whatever day they started. */
  live: Game[];
  /** Scheduled for today and not yet under way. */
  today: Game[];
  /** Completed, most recent first. */
  results: Game[];
  /** Still to come after today, soonest first. */
  upcoming: Game[];
}

/** A settled game: nothing more will happen in it. */
function isComplete(game: Game): boolean {
  return (
    game.status === 'finished' || game.status === 'cancelled' || game.status === 'postponed'
  );
}

function byKickoff(a: Game, b: Game): number {
  return (a.start_time ?? '').localeCompare(b.start_time ?? '');
}

/**
 * Bucket a competition's fixtures.
 *
 * The rules, in order of precedence:
 *
 *   live      status is `live`, regardless of date — a game that ran past
 *             midnight is still live, and belongs at the top rather than in
 *             yesterday's results.
 *   results   complete, and not scheduled for a future date. A postponement
 *             announced for next week is upcoming news, not a past result.
 *   today     kicks off today and has not finished.
 *   upcoming  everything else still to come.
 *
 * A game with no usable kick-off time cannot be placed on a day, so it is only
 * ever shown if it is live or complete.
 */
export function splitGames(
  games: readonly Game[],
  today: string,
  timezone: string,
): HubGameSections {
  const live: Game[] = [];
  const todays: Game[] = [];
  const results: Game[] = [];
  const upcoming: Game[] = [];

  for (const game of games) {
    if (game.status === 'live') {
      live.push(game);
      continue;
    }

    const date = gameDate(game.start_time, timezone);

    if (isComplete(game)) {
      // A fixture already called off for a future date is not a result yet.
      if (date === null || date <= today) results.push(game);
      else upcoming.push(game);
      continue;
    }

    if (date === null) continue;
    if (date === today) todays.push(game);
    else if (date > today) upcoming.push(game);
    // Anything earlier that never reached a terminal status is dropped: the
    // provider stopped updating it, and showing it as "scheduled" would be a lie.
  }

  return {
    live: live.sort(byKickoff),
    today: todays.sort(byKickoff),
    // Most recent first: the last round matters more than the one before it.
    results: results.sort((a, b) => byKickoff(b, a)),
    upcoming: upcoming.sort(byKickoff),
  };
}

/** Trim each section for an overview, which links to the full lists. */
export function previewSections(
  sections: HubGameSections,
  limit: number,
): HubGameSections {
  return {
    // Live is never trimmed: it is the reason someone opened the page.
    live: sections.live,
    today: sections.today.slice(0, limit),
    results: sections.results.slice(0, limit),
    upcoming: sections.upcoming.slice(0, limit),
  };
}

export interface HubCounts {
  live: number;
  today: number;
  results: number;
  upcoming: number;
}

export function countSections(sections: HubGameSections): HubCounts {
  return {
    live: sections.live.length,
    today: sections.today.length,
    results: sections.results.length,
    upcoming: sections.upcoming.length,
  };
}

/**
 * Season label from the fixtures on hand, e.g. `2026` or `2026/27`.
 *
 * Read from the provider's own `season` field rather than derived from the
 * calendar: a season that spans a new year is the provider's business to say,
 * not something to infer. Football seasons are rendered as a span because that
 * is how they are written; a single-year season is left alone.
 */
export function seasonLabel(games: readonly Game[], spansYears: boolean): string | null {
  for (const game of games) {
    const season = game.season;
    if (!season) continue;
    if (!spansYears) return season;

    const year = Number.parseInt(season, 10);
    if (!Number.isFinite(year)) return season;
    return `${year}/${String((year + 1) % 100).padStart(2, '0')}`;
  }
  return null;
}
