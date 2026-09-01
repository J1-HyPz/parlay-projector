import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { ScheduleView } from '@/components/schedule/schedule-view';

export const dynamic = 'force-dynamic';

export default function SchedulePage() {
  return (
    <AppShell active="schedule">
      <PageHeader
        eyebrow="Eight-day view"
        title="Schedule"
        subtitle="Games from today through the same day next week."
      />
      <ScheduleView />
    </AppShell>
  );
}
