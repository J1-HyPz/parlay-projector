/**
 * Game detail for one session of a race weekend.
 *
 * Motorsport reaches the detail page the same way a fight does and for the
 * same reason: the provider's summary endpoint — which every team fixture's
 * page is built from — answers 404 for a session id, so a request for one
 * threw and every practice, qualifying and race page returned "temporarily
 * unavailable". It was not temporary. The cards knew it and routed around it,
 * pointing at the sport hub instead of at the session, so a reader could see
 * that a Grand Prix existed and never open it.
 *
 * So a session's page is built from the fixture the scoreboard already
 * normalised, which carries everything a session has: the event, which part
 * of the weekend it is, when and where, the field, and the classified order
 * once it has run.
 *
 * A race has no home side and no away side, and none is invented — the detail
 * simply carries neither, exactly as the fixture does. Every section built
 * around two teams stands down here, and the page reads `entrants` instead.
 * Pure, so the mapping can be tested without a provider.
 */

import type { Game } from '../home/types';
import type { GameDetail, SessionLink } from './types';

/** Sessions of the same weekend, in the order they are run. */
export function weekendOf(
  game: Game,
  sessions: readonly Game[],
): SessionLink[] {
  return sessions
    .filter((entry) => entry.title !== null && entry.title === game.title)
    .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
    .map((entry) => ({
      id: entry.id,
      session: entry.session ?? null,
      start_time: entry.start_time,
      status: entry.status,
    }));
}

/**
 * A session's detail, from its fixture.
 *
 * Null when the fixture is not one contested by a field, which the adapters
 * never emit for a race competition but the type allows.
 */
export function raceDetailFrom(
  game: Game,
  sessions: readonly Game[] = [],
): GameDetail | null {
  if (!Array.isArray(game.entrants)) return null;

  return {
    id: game.id,
    sport: game.sport,
    league: game.league,
    league_badge: game.league_badge,
    season: game.season,
    round: game.round,
    start_time: game.start_time,
    status: game.status,
    provider_status: game.provider_status,
    // No home side and no away side, and none invented. `entrants` below is
    // who is taking part.
    venue: game.venue,
    // A session has no scoreline. Its result is the finishing order carried
    // on the entrants.
    score: null,
    game_state: game.status === 'live' ? game.provider_status : null,
    broadcast: game.broadcast,
    standings: { home: null, away: null },
    recent_games: { home: [], away: [] },
    head_to_head: [],
    head_to_head_record: null,
    availability: null,
    _sources: { game: 'espn' },

    title: game.title ?? null,
    entrants: game.entrants,
    session: game.session ?? null,
    weekend: weekendOf(game, sessions),
  };
}
