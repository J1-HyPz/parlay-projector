/**
 * Discord webhook transport.
 *
 * The webhook URL is a credential -- anyone holding it can post to the channel
 * -- so it is never logged, never included in an error message, and never sent
 * to the browser. Failures are reported by status code only.
 *
 * Not built on lib/http.ts: that helper is shaped for reading JSON from
 * providers, whereas this POSTs and cares about 429 `retry_after`.
 */

import { notifyConfig } from '../config';
import { logger } from '../logger';
import type { DiscordPayload } from './messages';

export interface SendResult {
  sent: number;
  failed: number;
}

/** Discord returns 204 with no body on success. */
const SUCCESS = new Set([200, 204]);

/** One retry only. A webhook that is rate limited twice can wait for the next poll. */
const MAX_ATTEMPTS = 2;

/** Discord's 429 body carries `retry_after` in seconds. */
async function retryAfterMs(response: Response): Promise<number> {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 10_000);

  try {
    const body = (await response.json()) as { retry_after?: unknown };
    const seconds = Number(body?.retry_after);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000);
  } catch {
    // A 429 without a parseable body still deserves a pause.
  }
  return 1000;
}

async function postOnce(url: string, payload: DiscordPayload): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), notifyConfig.timeoutMs);
  try {
    return await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'user-agent': 'parlay-projector' },
      body: JSON.stringify(payload),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Post payloads in order, stopping at the first unrecoverable failure.
 *
 * Sequential rather than concurrent: chat messages arriving out of order read
 * badly, and a burst is exactly what trips the webhook rate limit.
 */
export async function sendToDiscord(payloads: readonly DiscordPayload[]): Promise<SendResult> {
  const url = notifyConfig.webhookUrl;
  if (!url || payloads.length === 0) return { sent: 0, failed: 0 };

  let sent = 0;

  for (const payload of payloads) {
    let delivered = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !delivered; attempt += 1) {
      try {
        const response = await postOnce(url, payload);

        if (SUCCESS.has(response.status)) {
          delivered = true;
          break;
        }

        if (response.status === 429 && attempt < MAX_ATTEMPTS) {
          const wait = await retryAfterMs(response);
          logger.warn('discord_rate_limited', { waitMs: wait });
          await new Promise((resolve) => setTimeout(resolve, wait));
          continue;
        }

        // Status only. The response body can echo the request, and the request
        // went to a URL that must not reach the log.
        logger.error('discord_send_failed', { status: response.status, attempt });
        break;
      } catch (error) {
        logger.error('discord_send_error', {
          attempt,
          reason: error instanceof Error ? error.name : 'unknown',
        });
        break;
      }
    }

    if (delivered) sent += 1;
    else return { sent, failed: payloads.length - sent };
  }

  return { sent, failed: 0 };
}
