/**
 * The overview card used above Home, Schedule and Live.
 *
 * There were four near-identical copies of this -- one per page, plus a dead
 * one in dashboard-ui that rendered a permanent `--`. They had already drifted
 * (one omitted the note, one rendered a placeholder bar instead), so the four
 * pages disagreed about what an overview card was.
 *
 * On a phone these are the whole first screen. Four full-width cards pushed
 * every actual fixture below the fold, so the compact variant is the default
 * below `sm` and the roomy one returns when there is width for it.
 */

import type { LucideIcon } from 'lucide-react';

export interface StatCardProps {
  label: string;
  icon: LucideIcon;
  /** Already formatted. `--` while loading or unavailable -- never a zero. */
  value: string;
  /** Optional line under the value: what the number is counting. */
  note?: string;
}

export function StatCard({ label, icon: Icon, value, note }: StatCardProps) {
  return (
    <article className="panel flex items-center justify-between gap-3 p-3 sm:min-h-28 sm:p-4">
      <div className="min-w-0">
        <p className="line-clamp-2 text-2xs leading-tight text-ink-subtle sm:truncate sm:text-xs">
          {label}
        </p>
        <p className="mt-1 text-xl font-semibold text-ink-strong tabular-nums sm:mt-2 sm:text-2xl">
          {value}
        </p>
        {note ? <p className="mt-1 line-clamp-2 text-2xs text-ink-faint">{note}</p> : null}
      </div>
      <span
        aria-hidden="true"
        className="grid size-9 shrink-0 place-items-center rounded-xl border border-violet-400/15 bg-violet-500/[.08] text-violet-300 sm:size-10"
      >
        <Icon className="size-4 sm:size-[18px]" />
      </span>
    </article>
  );
}

/**
 * The row the four cards sit in.
 *
 * Two across on a phone rather than four stacked: the same information in a
 * quarter of the height, which is the difference between seeing a fixture on
 * the first screen and not.
 */
export function StatGrid({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <section className="mt-6 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4" aria-label={label}>
      {children}
    </section>
  );
}
