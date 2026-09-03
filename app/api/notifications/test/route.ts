/**
 * POST /api/notifications/test
 *
 * Sends one message to the configured webhook.
 *
 * This exists because the settings page can only report what it *believes* —
 * that a URL is present and looks like a Discord webhook. Only a delivered
 * message proves the whole path: that the process started, that the URL is
 * live, and that the channel still exists.
 *
 * It posts to the configured webhook only. No URL is accepted from the caller,
 * so this cannot be used to send anywhere else.
 */

import { notifyConfig } from '@/lib/config';
import { json } from '@/lib/home/api';
import { sendTestMessage } from '@/lib/notify/discord';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  if (!notifyConfig.webhookUrl) {
    return json(
      {
        delivered: false,
        error: 'not_configured',
        message: 'No webhook is configured. Set DISCORD_WEBHOOK_URL in the app environment.',
      },
      400,
    );
  }

  const delivered = await sendTestMessage();

  return json({
    delivered,
    ...(delivered
      ? {}
      : {
          error: 'delivery_failed' as const,
          message:
            'Discord did not accept the message. The webhook may have been deleted or revoked.',
        }),
  });
}
