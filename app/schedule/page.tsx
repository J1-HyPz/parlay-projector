import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { ScheduleView } from '@/components/schedule/schedule-view';

export const dynamic = 'force-dynamic';

/**
 * The sidebar links here as `/schedule?sport=<chipId>`. Reading the parameter
 * on the server means the first paint already carries the right filter.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sport = (await searchParams).sport;

  return (
    <AppShell active="schedule">
      <PageHeader
        eyebrow="Eight-day view"
        title="Schedule"
        subtitle="Games from today through the same day next week."
      />
      <ScheduleView initialSport={typeof sport === 'string' ? sport : undefined} />
    </AppShell>
  );
}
