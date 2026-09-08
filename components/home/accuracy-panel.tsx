'use client';

/**
 * Prediction accuracy.
 *
 * Reports how stored predictions scored against actual results. When nothing
 * has settled it shows `--%` and says so — the ring renders as an empty track
 * rather than a decorative arc, because a filled arc next to `--%` would imply
 * history that does not exist.
 */

import { Activity, Sparkles } from 'lucide-react';
import { percent } from '@/lib/utils';
import { MIN_REPORTABLE } from '@/lib/projections/metrics';
import { useHomeData, useSectionFailed } from './home-data';
import { RecentResults } from './recent-results';

/** Track colour matches the original `.accuracy-ring` definition. */
const TRACK = 'rgba(255,255,255,.075)';

/**
 * The dial, from a fraction.
 *
 * Takes 0-1 like every other probability here and converts once, at the point
 * the CSS needs a percentage. It used to take the value straight through, so a
 * model at 0.76 drew 0.76% of a circle.
 */
function ring(fraction: number | null): string {
  const filled = fraction === null ? 0 : Math.max(0, Math.min(100, fraction * 100));
  return `conic-gradient(#8b5cf6 0 ${filled}%, ${TRACK} ${filled}% 100%)`;
}

export function AccuracyPanel() {
  const { state, data } = useHomeData();
  const failed = useSectionFailed('accuracy_unavailable');

  const accuracy = data?.accuracy ?? null;
  const loading = state === 'loading';
  const value = accuracy?.accuracy ?? null;

  const display = loading || failed || value === null ? '--%' : percent(value, 1);

  const correctPct =
    accuracy && accuracy.settled > 0 ? (accuracy.correct / accuracy.settled) * 100 : 0;

  /*
   * The panel sticks on wide screens, and the results section makes it
   * appreciably taller. Without a ceiling the bottom of it becomes unreachable
   * on a laptop-height viewport — a sticky element cannot be scrolled past.
   * The height only engages when the content genuinely does not fit.
   */
  return (
    <aside className="panel h-fit p-5 xl:sticky xl:top-24 xl:max-h-[calc(100vh-7rem)] xl:overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Prediction Accuracy</p>
          <p className="mt-1 text-xs text-ink-faint">Model outcomes overview</p>
        </div>
        <Activity className="size-5 text-violet-300" />
      </div>

      <div className="my-7 flex items-center justify-center">
        <div
          className="accuracy-ring grid size-36 place-items-center rounded-full"
          style={{ background: ring(loading || failed ? null : value) }}
        >
          <div className="grid size-[112px] place-items-center rounded-full bg-[#0d0b14] text-center">
            <span className="text-2xl font-semibold text-ink-strong">{display}</span>
            <span className="-mt-8 text-2xs uppercase tracking-wider text-ink-faint">Accuracy</span>
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-line pt-5">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-subtle">Correct predictions</span>
            <span className="text-ink-faint">{accuracy ? accuracy.correct : '--'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-violet-500/35"
              style={{ width: `${correctPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-ink-subtle">Settled predictions</span>
            <span className="text-ink-faint">{accuracy ? accuracy.settled : '--'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-violet-500/35"
              style={{ width: accuracy && accuracy.settled > 0 ? '100%' : '0%' }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-start gap-2 rounded-xl border border-violet-400/10 bg-violet-500/[.045] p-3 text-2xs leading-5 text-ink-subtle">
        <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-violet-300" />
        <span>
          {failed
            ? 'Accuracy currently unavailable.'
            : loading
              ? 'Loading prediction history.'
              : accuracy === null || accuracy.settled === 0
                ? 'No settled predictions yet.'
                : accuracy.accuracy === null
                  ? /*
                     * Withheld, not missing. A rate from a dozen results has a
                     * margin of error wide enough to cover almost any claim, so
                     * the dial stays empty until there is enough behind it --
                     * and now says so, instead of leaving `--%` to read as a
                     * fault.
                     */
                    `${accuracy.settled} settled. A rate is published from ${MIN_REPORTABLE}.`
                  : `Based on ${accuracy.settled} settled predictions.`}
        </span>
      </div>

      {/* What the percentage above is made of. Loads on its own, so a failure
          here cannot take the accuracy figure with it. */}
      <RecentResults />
    </aside>
  );
}
