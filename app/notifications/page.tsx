import { CircleAlert, CircleCheck, CircleSlash } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { notifyConfig } from '@/lib/config';
import { WatchlistPanel } from '@/components/watchlist/watchlist-panel';
import { NotificationSettings } from '@/components/notifications/notification-settings';

export const dynamic = 'force-dynamic';


/**
 * Delivery status for Discord notifications.
 *
 * Reads configuration on the server and reports only whether a webhook is
 * present. The URL is a credential and is never rendered, in whole or in part.
 */
export default function NotificationsPage() {
  const configured = notifyConfig.webhookUrl.length > 0;
  const status = notifyConfig.misconfigured
    ? {
        icon: CircleAlert,
        tone: 'text-amber-300',
        title: 'Webhook URL not recognised',
        detail:
          'DISCORD_WEBHOOK_URL is set but is not a Discord webhook address, so nothing is being sent.',
      }
    : configured
      ? {
          icon: CircleCheck,
          tone: 'text-emerald-300',
          title: 'Connected to Discord',
          detail: `Checking for changes every ${Math.round(notifyConfig.pollIntervalMs / 60_000)} minutes.`,
        }
      : {
          icon: CircleSlash,
          tone: 'text-white/40',
          title: 'Not configured',
          detail: 'Set DISCORD_WEBHOOK_URL in the app environment to start receiving notifications.',
        };

  const StatusIcon = status.icon;

  return (
    <AppShell active="notifications">
      <PageHeader
        eyebrow="Delivery"
        title="Notifications"
        subtitle="Starred games are announced to Discord. There is no in-app inbox."
      />

      <section
        className="mt-6 rounded-2xl border border-white/8 bg-white/[.02] p-5"
        aria-labelledby="status-heading"
      >
        <div className="flex items-start gap-3">
          <StatusIcon className={`mt-0.5 size-5 shrink-0 ${status.tone}`} />
          <div className="min-w-0">
            <h2 id="status-heading" className="text-base font-semibold">
              {status.title}
            </h2>
            <p className="mt-1 text-sm text-white/45">{status.detail}</p>
          </div>
        </div>
      </section>

      <WatchlistPanel />

      <NotificationSettings />

    </AppShell>
  );
}
