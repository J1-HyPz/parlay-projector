import { Activity, CalendarDays, Layers3, PoundSterling, Shield, Sparkles, Target, TrendingUp } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader, PlaceholderLine } from '@/components/dashboard-ui';
import { RiskSelector, SportFilters } from '@/components/interactive-controls';

const suggestions = [
  { title: 'Low Risk', subtitle: 'Higher confidence profile', legs: 3 },
  { title: 'Medium Risk', subtitle: 'Balanced projection profile', legs: 4 },
  { title: 'High Risk', subtitle: 'Larger return potential', legs: 5 },
];

export default function ParlaysPage() {
  return (
    <AppShell active="parlays">
      <PageHeader
        eyebrow="Projection workspace"
        title="Parlays"
        subtitle="Build and explore projected multi-sport combinations. All values are placeholders in this visual prototype."
        action={<span className="hidden items-center gap-2 rounded-xl border border-violet-400/15 bg-violet-500/[.07] px-3 py-2 text-xs text-violet-200 sm:flex"><Activity className="size-4" /> Model accuracy --%</span>}
      />

      <section className="mt-6" aria-labelledby="risk-heading">
        <div className="mb-3 flex items-end justify-between gap-4"><div><h2 id="risk-heading" className="text-base font-semibold">Risk level</h2><p className="mt-1 text-xs text-white/34">Choose a projection profile.</p></div></div>
        <RiskSelector />
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="min-w-0">
          <div className="mb-4"><SportFilters compact /></div>
          <section className="space-y-3" aria-labelledby="suggestions-heading">
            <h2 id="suggestions-heading" className="text-base font-semibold">Suggested combinations</h2>
            {suggestions.map((suggestion) => (
              <article key={suggestion.title} className="panel overflow-hidden">
                <div className="grid md:grid-cols-[160px_minmax(0,1fr)_160px]">
                  <div className="border-b border-white/7 p-4 md:border-b-0 md:border-r md:p-5">
                    <span className="grid size-10 place-items-center rounded-xl border border-violet-400/18 bg-violet-500/[.08] text-violet-300"><Shield className="size-5" /></span>
                    <h3 className="mt-4 text-sm font-semibold">{suggestion.title}</h3>
                    <p className="mt-1 text-[11px] leading-5 text-white/35">{suggestion.subtitle}</p>
                    <div className="mt-5 border-t border-white/7 pt-4"><span className="text-[10px] uppercase tracking-wider text-white/26">Projected return</span><p className="mt-1 text-xl font-semibold text-white/55">£--</p></div>
                  </div>

                  <div className="p-3 md:p-4">
                    <div className="mb-2 flex items-center justify-between px-2 text-[10px] uppercase tracking-wider text-white/25"><span>{suggestion.legs} game structure</span><span>Confidence</span></div>
                    <div className="overflow-hidden rounded-xl border border-white/7 bg-black/10">
                      {Array.from({ length: Math.min(suggestion.legs, 4) }).map((_, row) => (
                        <div key={row} className="grid min-h-[52px] grid-cols-[34px_minmax(100px,1fr)_110px_62px] items-center gap-2 border-b border-white/[.055] px-3 last:border-b-0">
                          <span className="grid size-6 place-items-center rounded-md border border-white/8 bg-white/[.035] text-[8px] text-violet-300">{['NFL', 'NBA', 'MLB', 'NHL'][row]}</span>
                          <div className="min-w-0"><PlaceholderLine className="w-24" /><PlaceholderLine className="mt-1.5 w-16" /></div>
                          <span className="truncate text-[10px] text-white/28">Prediction placeholder</span>
                          <span className="text-right text-xs text-white/40">--%</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-t border-white/7 p-4 md:flex-col md:justify-center md:border-l md:border-t-0">
                    <div className="text-center"><div className="mini-ring grid size-20 place-items-center rounded-full"><div className="grid size-16 place-items-center rounded-full bg-[#0e0c15] text-lg font-semibold text-white/60">--%</div></div><p className="mt-2 text-[10px] text-white/28">Win confidence</p></div>
                    <button className="min-h-10 rounded-xl bg-violet-600 px-4 text-xs font-medium text-white transition hover:bg-violet-500">Add to builder</button>
                  </div>
                </div>
              </article>
            ))}
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:h-fit">
          <section className="panel p-5" aria-labelledby="stake-heading">
            <div className="flex items-center justify-between"><div><h2 id="stake-heading" className="text-sm font-semibold">Projection summary</h2><p className="mt-1 text-xs text-white/34">Starting amount and outputs</p></div><PoundSterling className="size-5 text-violet-300" /></div>
            <div className="mt-5 block text-[10px] font-medium uppercase tracking-wider text-white/28">Starting Amount
              <div className="mt-2 flex h-12 items-center rounded-xl border border-white/9 bg-white/[.025] px-3 text-sm text-white/55"><span className="mr-2 text-white/30">£</span>--</div>
            </div>
            <div className="mt-4 space-y-3 border-t border-white/7 pt-4">
              {[['Estimated Return', '£--'], ['Confidence', '--%'], ['Number of Games', '--']].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-xs"><span className="text-white/38">{label}</span><span className="font-medium text-white/65">{value}</span></div>
              ))}
            </div>
            <button className="mt-5 min-h-11 w-full rounded-xl bg-violet-600 text-sm font-medium text-white transition hover:bg-violet-500">Preview projection</button>
          </section>

          <section className="panel p-5" aria-labelledby="analytics-heading">
            <div className="flex items-center justify-between"><h2 id="analytics-heading" className="text-sm font-semibold">Prediction analytics</h2><Sparkles className="size-4 text-violet-300" /></div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                ['Model Accuracy', '--%', Target],
                ['Historical Accuracy', '--%', TrendingUp],
                ['Suggested Statistic', '--', Layers3],
                ['Projected Date', '--', CalendarDays],
              ].map(([label, value, Icon]) => (
                <div key={label as string} className="rounded-xl border border-white/7 bg-white/[.018] p-3"><Icon className="size-3.5 text-violet-300/75" /><p className="mt-3 text-[10px] leading-4 text-white/30">{label as string}</p><p className="mt-1 text-sm font-semibold text-white/55">{value as string}</p></div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </AppShell>
  );
}
