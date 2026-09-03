/**
 * Notification poller.
 *
 * Compares today's fixtures against the statuses seen on the previous run and
 * posts the differences to Discord. Reuses `getGamesToday`, so it shares the
 * cached fixture fetch the Home and Live pages already make rather than adding
 * a second round of provider requests.
 *
 * State is written on every poll, whether or not anything is sent: skipping the
 * write after a quiet poll would make the next one re-examine stale data.
 *
 * Only games on the watchlist are announced. Status tracking still covers every
 * game, so starring a fixture midway through the day does not lose the history
 * needed to detect its next transition.
 */

import { notifyConfig, todayInAppTimezone } from '../config';
import { logger } from '../logger';
import { getGamesToday } from '../home/sports/service';
import type { Game } from '../home/types';
import { sendToDiscord } from './discord';
import { buildPayloads } from './messages';
import { detectTransitions } from './transitions';
import { readState, writeState } from './state';
import { pruneStoredWatchlist, readWatchlist } from '../watchlist/store';
import { effectiveSettings } from './settings-store';
import type { NotifyEvent } from './types';

export interface PollResult {
  checked: number;
  detected: number;
  sent: number;
  /** Games dropped from the watchlist this poll. */
  unwatched: number;
  skipped: boolean;
}

/**
 * Terminal states observed this poll, for pruning the watchlist.
 *
 * `postponed` is deliberately absent: a postponed fixture is usually
 * rescheduled under the same id, so it stays watched and the 48-hour staleness
 * rule removes it if it never resumes.
 */
function settledStates(games: readonly Game[]): Map<string, 'finished' | 'cancelled'> {
  const settled = new Map<string, 'finished' | 'cancelled'>();
  for (const game of games) {
    if (game.status === 'finished' || game.status === 'cancelled') {
      settled.set(game.id, game.status);
    }
  }
  return settled;
}

/**
 * One poll.
 *
 * Never throws: it runs on a timer with no caller to handle a rejection, and a
 * provider outage must not take the server process down with it.
 */
export async function pollAndNotify(): Promise<PollResult> {
  const idle: PollResult = { checked: 0, detected: 0, sent: 0, unwatched: 0, skipped: true };
  if (!notifyConfig.webhookUrl) return idle;

  try {
    const date = todayInAppTimezone();
    const [{ games, failed }, previous] = await Promise.all([getGamesToday('all'), readState()]);

    // Every league failing would look like an empty fixture list, and recording
    // that would make the next poll treat the whole day as newly seen.
    if (failed) {
      logger.warn('notify_poll_skipped', { reason: 'fixtures_unavailable' });
      return idle;
    }

    const { notifications, next } = detectTransitions(previous, games, date);
    await writeState(next);

    // Status tracking above covers every game, so a transition is never missed
    // for a game starred midway through. Only the announcement is narrowed.
    const watched = new Set((await readWatchlist()).map((entry) => entry.gameId));

    const settings = await effectiveSettings();
    // Turned off in the application: still tracks statuses so a later poll can
    // detect transitions correctly, but announces nothing.
    const wanted = settings.enabled ? new Set(settings.events) : new Set<NotifyEvent>();
    const selected = notifications
      .filter(
        (notification) => wanted.has(notification.event) && watched.has(notification.gameId),
      )
      .slice(0, settings.maxPerPoll);

    // Pruning is driven by the status just observed, not by whether a message
    // was sent: a game that finishes while notifications are off still leaves
    // the list. Runs after selection so a final is announced before it is
    // unsubscribed.
    const pruned = await pruneStoredWatchlist(settledStates(games));

    if (selected.length === 0) {
      return {
        checked: games.length,
        detected: notifications.length,
        sent: 0,
        unwatched: pruned.removed.length,
        skipped: false,
      };
    }

    const { sent } = await sendToDiscord(buildPayloads(selected, notifyConfig.linkBaseUrl));

    logger.info('notify_poll_sent', {
      checked: games.length,
      detected: notifications.length,
      watched: watched.size,
      announced: selected.length,
      messages: sent,
      unwatched: pruned.removed.length,
    });

    return {
      checked: games.length,
      detected: notifications.length,
      sent,
      unwatched: pruned.removed.length,
      skipped: false,
    };
  } catch (error) {
    logger.error('notify_poll_failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return idle;
  }
}

let timer: NodeJS.Timeout | null = null;

/**
 * Start the poll timer. Idempotent, and a no-op when no webhook is configured.
 *
 * `unref` so the timer never holds the process open on shutdown.
 */
export function startNotifier(): boolean {
  if (timer || !notifyConfig.webhookUrl) return false;

  timer = setInterval(() => {
    void pollAndNotify();
  }, notifyConfig.pollIntervalMs);
  timer.unref?.();

  logger.info('notifier_started', { intervalMs: notifyConfig.pollIntervalMs });
  return true;
}

export function stopNotifier(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
