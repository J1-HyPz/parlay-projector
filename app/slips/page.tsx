/**
 * Slips — the matches you picked, and the line the model builds from them.
 *
 * The manual counterpart to Parlays. There the optimiser chooses both halves of
 * a line: which fixtures to use and what to back on them. Here the first half
 * is yours.
 */

import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { SlipView } from '@/components/slip/slip-view';

export const dynamic = 'force-dynamic';

export default function SlipsPage() {
  return (
    <AppShell active="slips">
      <PageHeader
        eyebrow="Your picks"
        title="Slips"
        subtitle="Choose the matches; the model picks the strongest bet on each, at the risk level you set."
      />
      <SlipView />
      <p className="mt-8 border-t border-white/7 pt-4 text-[11px] leading-5 text-white/25">
        Parlay Projector provides statistical estimates based on available data. Sports outcomes
        are uncertain and projections may be incorrect.
      </p>
    </AppShell>
  );
}
