import { Activity, Clock3, MapPin, Radio, Trophy, Tv } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader, StatCard, TeamPlaceholder } from '@/components/dashboard-ui';
import { FilterSelect, SportFilters } from '@/components/interactive-controls';

const liveRows = ['NFL', 'NBA', 'MLB', 'Football'];

export default function LivePage() {
  return (
    <AppShell active="live">
      <PageHeader eyebrow="Scoreboard" title="Live Games" subtitle="Games currently in progress. Scores and status will appear when live sports data is connected." />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Live games overview">
        <StatCard label="Live Now" icon={Radio} note="Games in progress" />
        <StatCard label="Sports Active" icon={Trophy} note="Currently represented" />
        <StatCard label="In Progress" icon={Activity} note="Across all leagues" />
        <StatCard label="Upcoming" icon={Clock3} note="Starting soon" />
      </section>

      <section className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between" aria-label="Live game filters">
        <SportFilters compact />
        <FilterSelect label="League" items={['All Leagues', 'Primary leagues']} />
      </section>

      <section className="mt-4 space-y-3" aria-labelledby="live-list-heading">
        <h2 id="live-list-heading" className="sr-only">Live game cards</h2>
        {liveRows.map((league, index) => (
          <article key={league} className="panel overflow-hidden">
            <div className="grid gap-4 p-4 md:grid-cols-[110px_minmax(230px,1fr)_minmax(170px,.8fr)_minmax(160px,.65fr)] md:items-center md:p-5">
              <div className="flex items-center justify-between md:block">
                <div className="flex items-center gap-2 md:block">
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-rose-300"><span className="size-1.5 rounded-full bg-rose-400" /> Live</span>
                  <span className="text-[11px] text-white/32 md:mt-2 md:block">{league} · League</span>
                </div>
                <div className="text-right text-[11px] text-white/42 md:mt-3 md:text-left"><span className="block">Period --</span><span className="text-white/27">Clock --:--</span></div>
              </div>

              <div className="space-y-3 border-y border-white/7 py-4 md:border-y-0 md:border-x md:px-5 md:py-0">
                <div className="flex items-center justify-between gap-4"><TeamPlaceholder label="Team placeholder A" /><span className="text-lg font-semibold text-white/70">--</span></div>
                <div className="flex items-center justify-between gap-4"><TeamPlaceholder label="Team placeholder B" /><span className="text-lg font-semibold text-white/70">--</span></div>
              </div>

              <div className="rounded-xl border border-white/7 bg-white/[.02] p-3">
                <p className="text-[10px] uppercase tracking-wider text-white/25">Game status</p>
                <p className="mt-1.5 text-xs text-white/54">Status detail placeholder</p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[.055]"><div className={`h-full rounded-full bg-violet-500/45 ${index % 2 === 0 ? 'w-1/3' : 'w-2/3'}`} /></div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px] text-white/32 md:grid-cols-1">
                <span className="flex items-center gap-2"><MapPin className="size-3.5 text-violet-300/70" /> Venue --</span>
                <span className="flex items-center gap-2"><Tv className="size-3.5 text-violet-300/70" /> Network --</span>
              </div>
            </div>
          </article>
        ))}
      </section>

      <button className="mt-4 min-h-11 w-full rounded-xl border border-white/8 bg-white/[.018] text-xs text-white/38 transition hover:border-violet-400/20 hover:text-white/65">Load more live games</button>
    </AppShell>
  );
}
