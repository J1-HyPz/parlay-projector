import { BellRing, CircleAlert, CircleCheck, CircleSlash, Clock3 } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { notifyConfig } from '@/lib/config';
import { NOTIFY_EVENTS } from '@/lib/notify/types';
import { WatchlistPanel } from '@/components/watchlist/watchlist-panel';

export const dynamic = 'force-dynamic';

const EVENT_COPY: Record<string, string> = {
  kickoff: 'A game kicks off',
  final: 'A game finishes, with the final score',
  postponed: 'A game is postponed',
  cancelled: 'A game is cancelled',
};

/**
 * Delivery status for Discord notifications.
 *
 * Reads configuration on the server and reports only whether a webhook is
 * present. The URL is a credential and is never rendered, in whole or in part.
 */
export default function NotificationsPage() {
  const configured = notifyConfig.webhookUrl.length > 0;
  const active = new Set(
    notifyConfig.events.filter((event) => (NOTIFY_EVENTS as readonly string[]).includes(event)),
  );

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

      <section className="mt-6" aria-labelledby="events-heading">
        <h2 id="events-heading" className="text-base font-semibold">
          What gets sent
        </h2>
        <ul className="mt-3 space-y-2">
          {NOTIFY_EVENTS.map((event) => {
            const on = active.has(event);
            return (
              <li
                key={event}
                className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/[.02] px-4 py-3"
              >
                {on ? (
                  <BellRing className="size-4 shrink-0 text-violet-300" />
                ) : (
                  <CircleSlash className="size-4 shrink-0 text-white/25" />
                )}
                <span className={`text-sm ${on ? 'text-white/70' : 'text-white/32'}`}>
                  {EVENT_COPY[event]}
                </span>
                <span className="ml-auto text-[11px] uppercase tracking-[.14em] text-white/28">
                  {on ? 'On' : 'Off'}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-center gap-2 text-xs text-white/34">
          <Clock3 className="size-3.5" />
          Controlled by NOTIFY_EVENTS in the app environment.
        </p>
      </section>
    </AppShell>
  );
}
