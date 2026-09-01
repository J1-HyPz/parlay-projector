import { CalendarDays } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { AccuracyPanel } from '@/components/home/accuracy-panel';
import { GamesToday } from '@/components/home/games-today';
import { HomeDataProvider } from '@/components/home/home-data';
import { NewsFeed } from '@/components/home/news-feed';
import { SummaryCards } from '@/components/home/summary-cards';

export default function Home() {
  return (
    <AppShell active="home">
      <PageHeader
        eyebrow="Dashboard"
        title="Home"
        subtitle="Today's fixtures, sports news and prediction accuracy at a glance."
        action={
          <button className="hidden min-h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[.025] px-3.5 text-xs text-white/55 transition hover:border-violet-400/30 hover:text-white sm:flex">
            <CalendarDays className="size-4 text-violet-300" /> Today
          </button>
        }
      />

      {/* One fetch of /api/home feeds every section below. */}
      <HomeDataProvider>
        <SummaryCards />

        <div className="mt-7 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            <GamesToday />
            <NewsFeed />
          </div>
          <AccuracyPanel />
        </div>
      </HomeDataProvider>
    </AppShell>
  );
}
