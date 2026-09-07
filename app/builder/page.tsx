import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { BuilderView } from '@/components/builder/builder-view';
export const dynamic = 'force-dynamic';
export default async function BuilderPage({
  searchParams,
}: {
  searchParams: Promise<{ game?: string }>;
}) {
  const query = await searchParams;
  return (
    <AppShell active="builder">
      <PageHeader
        eyebrow="Your betting workspace"
        title="Builder"
        subtitle="Choose real markets, review the complete line and save a draft."
      />
      <BuilderView
        initialGame={typeof query.game === 'string' ? query.game : ''}
      />
    </AppShell>
  );
}
