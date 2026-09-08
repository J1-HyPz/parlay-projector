'use client';

/**
 * How many matches are on the slip, beside the navigation label.
 *
 * Renders nothing when the slip is empty or the provider is absent, so an
 * untouched application shows a plain nav item rather than a zero.
 */

import { useSlip } from './slip-context';

export function SlipCount() {
  const slip = useSlip();
  if (!slip || !slip.ready || slip.entries.length === 0) return null;

  return (
    <span
      aria-label={`${slip.entries.length} on the slip`}
      className="ml-1.5 inline-grid min-w-[18px] place-items-center rounded-full bg-violet-500/25 px-1.5 text-[10px] font-semibold tabular-nums text-violet-200"
    >
      {slip.entries.length}
    </span>
  );
}
