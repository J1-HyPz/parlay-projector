'use client';

/**
 * The four overview cards. Same markup as the original placeholders — only the
 * values are now real, and they stay `--` until data arrives or when a section
 * is unavailable.
 */

import { Activity, CalendarDays, Clock3, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { percent } from '@/lib/utils';
import { useHomeData } from './home-data';

function StatCard({
  label,
  icon: Icon,
  value,
  note,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  note?: string;
}) {
  return (
    <article className="panel flex min-h-28 items-center justify-between p-4">
      <div>
        <p className="text-xs text-white/42">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white/75">{value}</p>
        {note ? (
          <p className="mt-1 text-[10px] text-white/27">{note}</p>
        ) : (
          <span className="mt-2 block h-1.5 w-20 rounded-full bg-white/[.06]" />
        )}
      </div>
      <span className="grid size-10 place-items-center rounded-xl border border-violet-400/15 bg-violet-500/[.08] text-violet-300">
        <Icon className="size-[18px]" />
      </span>
    </article>
  );
}

export function SummaryCards() {
  const { state, data } = useHomeData();
  const summary = data?.summary;
  const ready = state === 'loaded' && summary !== undefined;

  const number = (value: number | undefined) => (ready && value !== undefined ? String(value) : '--');

  const accuracy = ready && summary.accuracy !== null ? percent(summary.accuracy, 1) : '--%';

  // Games still to start today, derived from what the API already returned.
  const upcoming =
    state === 'loaded' && data
      ? String(data.games.filter((game) => game.status === 'scheduled').length)
      : '--';

  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Overview">
      <StatCard label="Games Today" icon={CalendarDays} value={number(summary?.games_today)} />
      <StatCard label="Sports Tracked" icon={Trophy} value={number(summary?.sports_active)} />
      <StatCard
        label="Prediction Accuracy"
        icon={Activity}
        value={accuracy}
        note={
          ready && summary.predictions_settled > 0
            ? `${summary.predictions_settled} settled`
            : 'No settled predictions yet'
        }
      />
      <StatCard label="Upcoming Games" icon={Clock3} value={upcoming} />
    </section>
  );
}
