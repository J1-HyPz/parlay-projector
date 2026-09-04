/**
 * Which games changed since the last poll.
 *
 * Pure and side-effect free so it can be unit-tested directly: every awkward
 * case here (a restart, a provider flapping, a game seen for the first time
 * already in progress) is a correctness question about *when not to send*.
 */

import { fixtureLabel } from '../home/types';
import type { Game, GameStatus } from '../home/types';
import type { GameNotification, NotifyEvent, NotifyState } from './types';

/**
 * The event a status change represents, or null if it is not worth announcing.
 *
 * Only forward transitions count. A provider briefly reporting `unknown` and
 * then recovering must not produce a second kick-off message, so anything
 * arriving from `unknown` is treated as a correction rather than news.
 */
export function eventFor(previous: GameStatus, next: GameStatus): NotifyEvent | null {
  if (previous === next) return null;

  switch (next) {
    case 'live':
      return previous === 'scheduled' ? 'kickoff' : null;
    case 'finished':
      return previous === 'scheduled' || previous === 'live' ? 'final' : null;
    case 'postponed':
      return previous === 'scheduled' || previous === 'live' ? 'postponed' : null;
    case 'cancelled':
      return previous === 'scheduled' || previous === 'live' ? 'cancelled' : null;
    default:
      return null;
  }
}

export interface TransitionResult {
  notifications: GameNotification[];
  /** The state to persist, whether or not anything is sent. */
  next: NotifyState;
}

/**
 * Compare this poll's games against the last recorded statuses.
 *
 * A game with no previous entry is recorded but never announced. On a cold
 * start every game in progress would otherwise fire a kick-off message, and
 * after a redeploy that would mean announcing an afternoon of football at once.
 * The cost is that a genuine transition spanning a restart is missed; a false
 * flood is the worse failure.
 */
export function detectTransitions(
  previous: NotifyState | null,
  games: readonly Game[],
  date: string,
): TransitionResult {
  // A new day starts from scratch: yesterday's ids will never be seen again.
  const known = previous && previous.date === date ? previous.statuses : {};

  const statuses: Record<string, GameStatus> = {};
  const notifications: GameNotification[] = [];

  for (const game of games) {
    statuses[game.id] = game.status;

    const before = Object.prototype.hasOwnProperty.call(known, game.id)
      ? known[game.id]
      : undefined;
    if (before === undefined) continue;

    const event = eventFor(before, game.status);
    if (!event) continue;

    notifications.push({
      event,
      gameId: game.id,
      league: game.league,
      sport: game.sport,
      // A race has no two sides to name, so both slots carry the event's own
      // name — which is what the message should say for it anyway.
      home: game.home_team?.name ?? fixtureLabel(game),
      away: game.away_team?.name ?? fixtureLabel(game),
      score: event === 'final' ? (game.score ?? null) : null,
    });
  }

  return { notifications, next: { date, statuses } };
}
