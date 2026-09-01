import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { LiveView } from '@/components/live/live-view';

export const dynamic = 'force-dynamic';

export default function LivePage() {
  return (
    <AppShell active="live">
      <PageHeader
        eyebrow="Scoreboard"
        title="Live Games"
        subtitle="Games currently in progress, refreshed automatically."
      />
      <LiveView />
    </AppShell>
  );
}
