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
 */

import { notifyConfig, todayInAppTimezone } from '../config';
import { logger } from '../logger';
import { getGamesToday } from '../home/sports/service';
import { sendToDiscord } from './discord';
import { buildPayloads } from './messages';
import { detectTransitions } from './transitions';
import { readState, writeState } from './state';
import { NOTIFY_EVENTS } from './types';
import type { NotifyEvent } from './types';

export interface PollResult {
  checked: number;
  detected: number;
  sent: number;
  skipped: boolean;
}

/** NOTIFY_EVENTS entries that name a real event; anything else is ignored. */
function enabledEvents(): Set<NotifyEvent> {
  return new Set(
    notifyConfig.events.filter((entry): entry is NotifyEvent =>
      (NOTIFY_EVENTS as readonly string[]).includes(entry),
    ),
  );
}

/**
 * One poll.
 *
 * Never throws: it runs on a timer with no caller to handle a rejection, and a
 * provider outage must not take the server process down with it.
 */
export async function pollAndNotify(): Promise<PollResult> {
  const idle: PollResult = { checked: 0, detected: 0, sent: 0, skipped: true };
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

    const wanted = enabledEvents();
    const selected = notifications
      .filter((notification) => wanted.has(notification.event))
      .slice(0, notifyConfig.maxPerPoll);

    if (selected.length === 0) {
      return { checked: games.length, detected: notifications.length, sent: 0, skipped: false };
    }

    const { sent } = await sendToDiscord(buildPayloads(selected, notifyConfig.linkBaseUrl));

    logger.info('notify_poll_sent', {
      checked: games.length,
      detected: notifications.length,
      announced: selected.length,
      messages: sent,
    });

    return { checked: games.length, detected: notifications.length, sent, skipped: false };
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

  logger.info('notifier_started', {
    intervalMs: notifyConfig.pollIntervalMs,
    events: [...enabledEvents()],
  });
  return true;
}

export function stopNotifier(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
