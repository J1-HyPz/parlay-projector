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
import { useHomeData, useSectionFailed } from './home-data';

/** Track colour matches the original `.accuracy-ring` definition. */
const TRACK = 'rgba(255,255,255,.075)';

function ring(percent: number | null): string {
  const filled = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  return `conic-gradient(#8b5cf6 0 ${filled}%, ${TRACK} ${filled}% 100%)`;
}

export function AccuracyPanel() {
  const { state, data } = useHomeData();
  const failed = useSectionFailed('accuracy_unavailable');

  const accuracy = data?.accuracy ?? null;
  const loading = state === 'loading';
  const value = accuracy?.accuracy ?? null;

  const display = loading || failed || value === null ? '--%' : `${value.toFixed(1)}%`;

  const correctPct =
    accuracy && accuracy.settled > 0 ? (accuracy.correct / accuracy.settled) * 100 : 0;

  return (
    <aside className="panel h-fit p-5 xl:sticky xl:top-24">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Prediction Accuracy</p>
          <p className="mt-1 text-xs text-white/36">Model outcomes overview</p>
        </div>
        <Activity className="size-5 text-violet-300" />
      </div>

      <div className="my-7 flex items-center justify-center">
        <div
          className="accuracy-ring grid size-36 place-items-center rounded-full"
          style={{ background: ring(loading || failed ? null : value) }}
          role="img"
          aria-label={
            value === null ? 'Prediction accuracy unavailable' : `Prediction accuracy ${display}`
          }
        >
          <div className="grid size-[112px] place-items-center rounded-full bg-[#0d0b14] text-center">
            <span className="text-2xl font-semibold">{display}</span>
            <span className="-mt-8 text-[10px] uppercase tracking-wider text-white/30">Accuracy</span>
          </div>
        </div>
      </div>

      <div className="space-y-4 border-t border-white/7 pt-5">
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/43">Correct predictions</span>
            <span className="text-white/32">{accuracy ? accuracy.correct : '--'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.055]">
            <div
              className="h-full rounded-full bg-violet-500/35"
              style={{ width: `${correctPct}%` }}
            />
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-white/43">Settled predictions</span>
            <span className="text-white/32">{accuracy ? accuracy.settled : '--'}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.055]">
            <div
              className="h-full rounded-full bg-violet-500/35"
              style={{ width: accuracy && accuracy.settled > 0 ? '100%' : '0%' }}
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-xl border border-violet-400/10 bg-violet-500/[.045] p-3 text-[11px] leading-5 text-white/36">
        <Sparkles className="size-4 shrink-0 text-violet-300" />
        {failed
          ? 'Accuracy currently unavailable.'
          : loading
            ? 'Loading prediction history.'
            : accuracy && accuracy.settled > 0
              ? `Based on ${accuracy.settled} settled predictions.`
              : 'No settled predictions yet.'}
      </div>
    </aside>
  );
}
