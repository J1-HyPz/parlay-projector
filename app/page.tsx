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
          <a href="/schedule" className="button-quiet hidden sm:inline-flex">
            Full schedule
          </a>
        }
      />

      {/* One fetch of /api/home feeds every section below. */}
      <HomeDataProvider>
        <SummaryCards />

        <div className="mt-7 grid gap-5 md:gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
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
