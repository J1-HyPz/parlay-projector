/**
 * Accuracy — how the model actually scored.
 *
 * The service behind this has computed a competition breakdown, a calibration
 * table and a risk-ordering check for as long as it has existed, and none of
 * it was rendered anywhere: the application's entire visible claim about its
 * own accuracy was one percentage on the homepage.
 *
 * A model that reports only a headline figure is asking to be trusted. This
 * page is the alternative — the same number, split by the things that can hide
 * inside it.
 */

import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { AccuracyView } from '@/components/accuracy/accuracy-view';

export const dynamic = 'force-dynamic';

export default function AccuracyPage() {
  return (
    <AppShell active="accuracy">
      <PageHeader
        eyebrow="Model diagnostics"
        title="Accuracy"
        subtitle="Settled predictions scored against what actually happened, split by competition, sport and risk level."
      />
      <AccuracyView />
      <p className="mt-8 border-t border-line pt-4 text-2xs leading-5 text-ink-faint">
        Every figure here is computed from predictions stored before kick-off, and a rate is
        withheld until the sample behind it can support one. Past accuracy does not make any
        future projection more likely to be correct.
      </p>
    </AppShell>
  );
}
