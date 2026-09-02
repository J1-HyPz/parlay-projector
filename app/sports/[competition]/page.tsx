/**
 * GET /sports/:competition
 *
 * One dynamic route serves every competition hub. The slug is validated on the
 * server against the hub configuration, which is itself derived from the league
 * catalogue, so an unknown competition is a 404 rather than an empty page.
 *
 * `?division=` opens the combined NCAA basketball hub on Men's or Women's, and
 * makes /sports/ncaam and /sports/ncaaw resolve to it with the right division
 * already selected.
 */

import { notFound } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SportHub } from '@/components/sports/sport-hub';
import { defaultDivision, divisionFor, resolveHub } from '@/lib/sports/hubs';

export const dynamic = 'force-dynamic';

export default async function SportHubPage({
  params,
  searchParams,
}: {
  params: Promise<{ competition: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { competition } = await params;
  const resolved = resolveHub(competition);
  if (!resolved) notFound();

  const { hub } = resolved;

  // An explicit ?division= wins; otherwise an alias slug (ncaam/ncaaw) has
  // already chosen one, and failing that the hub opens on its default.
  const requested = (await searchParams).division;
  const division =
    typeof requested === 'string'
      ? divisionFor(hub, requested)
      : (resolved.division ?? defaultDivision(hub));

  return (
    <AppShell active="sports" activeHub={hub.slug}>
      <SportHub hub={hub} initialDivision={division?.id ?? 'all'} />
    </AppShell>
  );
}
