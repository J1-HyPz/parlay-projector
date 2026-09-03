/**
 * GET  /api/notifications/settings  — the settings currently in force
 * PUT  /api/notifications/settings  — change them
 *
 * The environment supplies defaults; anything saved here overrides them, and
 * the poller re-reads on every cycle so a change applies without a restart.
 *
 * The webhook URL is deliberately absent from both directions. It is a
 * credential, this application has no authentication, and an endpoint that
 * accepted one would let anyone who can reach the server redirect the
 * notifications to a channel of their own. The response says only whether a
 * webhook is present.
 */

import { notifyConfig } from '@/lib/config';
import { json } from '@/lib/home/api';
import { NOTIFY_EVENTS } from '@/lib/notify/types';
import { MAX_POLL_SECONDS, MIN_POLL_SECONDS, parseSettings } from '@/lib/notify/settings';
import { effectiveSettings, saveSettings } from '@/lib/notify/settings-store';
import type { NotifySettings } from '@/lib/notify/settings';

export const dynamic = 'force-dynamic';

function body(settings: NotifySettings, stored = true) {
  return {
    settings: {
      enabled: settings.enabled,
      events: settings.events,
      poll_seconds: settings.pollSeconds,
      max_per_poll: settings.maxPerPoll,
    },
    supported_events: [...NOTIFY_EVENTS],
    limits: { min_poll_seconds: MIN_POLL_SECONDS, max_poll_seconds: MAX_POLL_SECONDS },
    webhook: {
      // Presence only — never the value, never a fragment of it.
      configured: notifyConfig.webhookUrl.length > 0,
      misconfigured: notifyConfig.misconfigured,
      env_var: 'DISCORD_WEBHOOK_URL',
    },
    ...(stored ? {} : { error: 'settings_not_persisted' as const }),
  };
}

export async function GET(): Promise<Response> {
  return json(body(await effectiveSettings()));
}

export async function PUT(request: Request): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  // Everything is validated and clamped; unknown fields are ignored rather
  // than rejected, so a partial update leaves the rest alone.
  const { settings, stored } = await saveSettings(parseSettings(payload));
  return json(body(settings, stored));
}
