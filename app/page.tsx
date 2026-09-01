import { Activity, CalendarDays, Clock3, Sparkles, Trophy } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader, PlaceholderLine, SectionHeading, StatCard } from '@/components/dashboard-ui';

const statCards = [
  { label: 'Games Today', icon: CalendarDays },
  { label: 'Sports Tracked', icon: Trophy },
  { label: 'Prediction Accuracy', icon: Activity },
  { label: 'Upcoming Games', icon: Clock3 },
];

export default function Home() {
  return (
    <AppShell active="home">
      <PageHeader
        eyebrow="Dashboard"
        title="Home"
        subtitle="Your sports insights at a glance. Live data and analytics will appear here in a future release."
        action={
          <button className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] px-3.5 text-xs text-white/55 transition hover:border-violet-400/30 hover:text-white sm:flex">
            <CalendarDays className="size-4 text-violet-300" /> This week
          </button>
        }
      />

      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Overview">
        {statCards.map((card) => <StatCard key={card.label} {...card} />)}
      </section>

      <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          <section>
            <SectionHeading title="Games Today" link="View schedule" />
            <div className="horizontal-cards">
              {['NFL', 'NBA', 'MLB', 'Football'].map((league) => (
                <article key={league} className="panel min-w-[245px] flex-1 p-4">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-medium text-violet-300">{league}</span>
                    <span className="text-white/32">Time --</span>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <div className="space-y-2"><PlaceholderLine className="w-24" /><PlaceholderLine className="w-16" /></div>
                    <span className="text-xs text-white/25">VS</span>
                    <div className="space-y-2 text-right"><PlaceholderLine className="ml-auto w-20" /><PlaceholderLine className="ml-auto w-14" /></div>
                  </div>
                  <div className="mt-5 flex items-center gap-2 border-t border-white/7 pt-3 text-[11px] text-white/30">
                    <span className="size-1.5 rounded-full bg-violet-400/60" /> Venue to be confirmed
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="mt-7">
            <SectionHeading title="News" link="Explore all" />
            <div className="grid gap-3 md:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <article key={item} className="panel overflow-hidden">
                  <div className="h-24 border-b border-white/7 bg-[radial-gradient(circle_at_25%_20%,rgba(139,92,246,.16),transparent_42%),linear-gradient(135deg,rgba(255,255,255,.035),rgba(255,255,255,.012))]" />
                  <div className="p-4">
                    <div className="mb-3 flex justify-between text-[10px] uppercase tracking-wider"><span className="text-violet-300">Sport</span><span className="text-white/28">-- ago</span></div>
                    <PlaceholderLine className="h-2.5 w-full" />
                    <PlaceholderLine className="mt-2 w-2/3" />
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="panel h-fit p-5 xl:sticky xl:top-24">
          <div className="flex items-center justify-between">
            <div><p className="text-sm font-semibold">Prediction Accuracy</p><p className="mt-1 text-xs text-white/36">Model outcomes overview</p></div>
            <Activity className="size-5 text-violet-300" />
          </div>
          <div className="my-7 flex items-center justify-center">
            <div className="accuracy-ring grid size-36 place-items-center rounded-full">
              <div className="grid size-[112px] place-items-center rounded-full bg-[#0d0b14] text-center">
                <span className="text-2xl font-semibold">--%</span>
                <span className="-mt-8 text-[10px] uppercase tracking-wider text-white/30">Accuracy</span>
              </div>
            </div>
          </div>
          <div className="space-y-4 border-t border-white/7 pt-5">
            {['Predicted outcomes', 'Verified results'].map((item) => (
              <div key={item}>
                <div className="flex items-center justify-between text-xs"><span className="text-white/43">{item}</span><span className="text-white/32">--</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.055]"><div className="h-full w-[28%] rounded-full bg-violet-500/35" /></div>
              </div>
            ))}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-violet-400/10 bg-violet-500/[.045] p-3 text-[11px] leading-5 text-white/36">
            <Sparkles className="size-4 shrink-0 text-violet-300" /> Analytics will activate when a prediction model is connected.
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
