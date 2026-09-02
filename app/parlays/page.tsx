/**
 * Parlays — the projection workspace.
 *
 * The engine's front end: risk level, sport and number of selections in,
 * a model-backed line out.
 *
 * There is no stake field and no projected return. This application holds no
 * bookmaker data, so a monetary figure would be invented; probability and model
 * confidence are what the model can actually support.
 */

import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { ParlayView } from '@/components/parlays/parlay-view';

export const dynamic = 'force-dynamic';

export default function ParlaysPage() {
  return (
    <AppShell active="parlays">
      <PageHeader
        eyebrow="Projection workspace"
        title="Parlays"
        subtitle="Statistical projections for upcoming fixtures, combined by risk profile."
      />
      <ParlayView />
      <p className="mt-8 border-t border-white/7 pt-4 text-[11px] leading-5 text-white/25">
        Parlay Projector provides statistical estimates based on available data. Sports
        outcomes are uncertain and projections may be incorrect.
      </p>
    </AppShell>
  );
}
