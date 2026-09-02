/**
 * GET /api/internal/notifications
 *
 * Diagnostics for Discord delivery: whether a webhook is configured, which
 * transitions are announced, and how often the poller runs.
 *
 * Returns no secrets. The webhook URL is a credential, so this reports only
 * that one is present and which environment variable supplies it — never the
 * value, and never any part of it.
 */

import { notifyConfig } from '@/lib/config';
import { json } from '@/lib/home/api';
import { NOTIFY_EVENTS } from '@/lib/notify/types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const configured = notifyConfig.webhookUrl.length > 0;

  return json({
    discord: {
      configured,
      /** True when DISCORD_WEBHOOK_URL is set but is not a Discord webhook URL. */
      misconfigured: notifyConfig.misconfigured,
      credential_env_var: 'DISCORD_WEBHOOK_URL',
      events: notifyConfig.events.filter((event) =>
        (NOTIFY_EVENTS as readonly string[]).includes(event),
      ),
      supported_events: [...NOTIFY_EVENTS],
      poll_interval_seconds: Math.round(notifyConfig.pollIntervalMs / 1000),
      max_per_poll: notifyConfig.maxPerPoll,
      links_enabled: notifyConfig.linkBaseUrl.length > 0,
    },
  });
}
