import { CalendarDays, Clock3, LayoutGrid, List, Search, Trophy } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader, StatCard, TeamPlaceholder } from '@/components/dashboard-ui';
import { FilterSelect, SportFilters } from '@/components/interactive-controls';

const days = [
  ['Tue', 'Today'], ['Wed', '--'], ['Thu', '--'], ['Fri', '--'],
  ['Sat', '--'], ['Sun', '--'], ['Mon', '--'], ['Tue', '--'],
];

const scheduleRows = ['NFL', 'NBA', 'MLB', 'NHL'];

export default function SchedulePage() {
  return (
    <AppShell active="schedule">
      <PageHeader eyebrow="Seven-day view" title="Schedule" subtitle="Upcoming games over the next 7 days." />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Schedule overview">
        <StatCard label="Games This Week" icon={CalendarDays} note="Current day through next week" />
        <StatCard label="Sports Tracked" icon={Trophy} note="Across all configured leagues" />
        <StatCard label="Today" icon={Clock3} note="Scheduled games" />
        <StatCard label="Tomorrow" icon={CalendarDays} note="Scheduled games" />
      </section>

      <section className="mt-6">
        <h2 className="sr-only">Date range</h2>
        <div className="horizontal-cards rounded-2xl border border-white/[.085] bg-white/[.02] p-1.5">
          {days.map(([day, date], index) => (
            <button
              key={`${day}-${index}`}
              className={`min-h-[54px] min-w-[92px] flex-1 rounded-xl px-4 text-center transition ${index === 0 ? 'border border-violet-400/35 bg-violet-500/15 text-white' : 'text-white/42 hover:bg-white/[.035] hover:text-white'}`}
              aria-pressed={index === 0}
            >
              <span className="block text-xs font-semibold uppercase tracking-wide">{day}</span>
              <span className={`mt-1 block text-[10px] ${index === 0 ? 'text-violet-300' : 'text-white/28'}`}>{date}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 space-y-3" aria-label="Schedule filters">
        <SportFilters compact />
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="schedule-search" className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search games, teams, or venues</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/28" />
            <input id="schedule-search" readOnly placeholder="Search games, teams, venues..." className="h-10 w-full rounded-xl border border-white/9 bg-white/[.025] pl-9 pr-3 text-xs text-white/60 outline-none placeholder:text-white/25 focus:border-violet-400/40" />
          </label>
          <FilterSelect label="League" items={['All Leagues', 'Primary leagues']} />
          <FilterSelect label="Timezone" items={['Local time', 'UTC']} />
          <div className="flex rounded-xl border border-white/9 bg-white/[.025] p-1">
            <button className="grid size-8 place-items-center rounded-lg bg-violet-500/15 text-violet-300" aria-label="List view"><List className="size-4" /></button>
            <button className="grid size-8 place-items-center rounded-lg text-white/32" aria-label="Grid view"><LayoutGrid className="size-4" /></button>
          </div>
        </div>
      </section>

      <section className="mt-4" aria-labelledby="schedule-list-heading">
        <h2 id="schedule-list-heading" className="sr-only">Scheduled games</h2>
        <div className="hidden overflow-hidden rounded-2xl border border-white/[.085] bg-white/[.018] md:block">
          <div className="grid grid-cols-[110px_130px_minmax(210px,1.3fr)_minmax(150px,1fr)_120px_90px] gap-4 border-b border-white/8 px-4 py-3 text-[10px] font-medium uppercase tracking-wider text-white/28">
            <span>Sport / League</span><span>Date &amp; Time</span><span>Matchup</span><span>Venue</span><span>Broadcast</span><span>Status</span>
          </div>
          {scheduleRows.map((league, index) => (
            <article key={league} className="grid min-h-[78px] grid-cols-[110px_130px_minmax(210px,1.3fr)_minmax(150px,1fr)_120px_90px] items-center gap-4 border-b border-white/[.065] px-4 py-3 last:border-b-0">
              <div className="flex items-center gap-2"><span className="grid size-8 place-items-center rounded-full border border-white/8 bg-white/[.04] text-[9px] text-violet-300">{league}</span><span className="text-xs text-white/52">{league}</span></div>
              <div className="text-xs leading-5 text-white/45"><span className="block">Day --</span><span className="text-white/28">Time --</span></div>
              <div className="space-y-2"><TeamPlaceholder label="Team placeholder A" /><TeamPlaceholder label="Team placeholder B" /></div>
              <div className="text-xs leading-5 text-white/38"><span className="block">Venue placeholder</span><span className="text-white/25">Location --</span></div>
              <span className="text-xs text-white/32">Network --</span>
              <span className={`w-fit rounded-full border px-2 py-1 text-[10px] ${index === 0 ? 'border-violet-400/20 bg-violet-500/[.08] text-violet-300' : 'border-white/8 text-white/35'}`}>Scheduled</span>
            </article>
          ))}
        </div>

        <div className="grid gap-3 md:hidden">
          {scheduleRows.map((league) => (
            <article key={league} className="panel p-4">
              <div className="flex items-center justify-between border-b border-white/7 pb-3">
                <span className="text-xs font-medium text-violet-300">{league}</span>
                <span className="text-[11px] text-white/32">Day -- · Time --</span>
              </div>
              <div className="my-4 space-y-3"><TeamPlaceholder label="Team placeholder A" /><TeamPlaceholder label="Team placeholder B" /></div>
              <div className="flex items-end justify-between gap-3 text-[11px]"><span className="leading-5 text-white/31">Venue placeholder<br />Network --</span><span className="rounded-full border border-violet-400/20 bg-violet-500/[.08] px-2 py-1 text-violet-300">Scheduled</span></div>
            </article>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
