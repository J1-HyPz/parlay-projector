import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, CalendarDays, House, Orbit, Radio, Sparkles, Star } from 'lucide-react';
import { SIDEBAR_HUBS } from '@/lib/sports/hubs';
import { WatchlistProvider } from '@/components/watchlist/watchlist-context';

export type PageKey = 'home' | 'schedule' | 'live' | 'parlays' | 'notifications' | 'sports';

/**
 * Which competition hub is open, if any.
 *
 * A separate prop rather than seventeen more members of PageKey: the primary
 * navigation and the sport shortcuts are different axes, and only the shortcuts
 * need per-competition highlighting.
 */
export interface AppShellProps {
  active: PageKey;
  /** Hub slug currently open, for sidebar highlighting. */
  activeHub?: string;
  children: ReactNode;
}

const primaryNavigation: { key: PageKey; label: string; href: string; icon: LucideIcon }[] = [
  { key: 'home', label: 'Home', href: '/', icon: House },
  { key: 'schedule', label: 'Schedule', href: '/schedule', icon: CalendarDays },
  { key: 'live', label: 'Live', href: '/live', icon: Radio },
  { key: 'parlays', label: 'Parlays', href: '/parlays', icon: Sparkles },
];

export function AppShell({ active, activeHub, children }: AppShellProps) {
  return (
    <WatchlistProvider>
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 flex h-16 items-center border-b border-white/8 bg-[#09080f]/92 px-4 backdrop-blur-xl md:px-6">
        <a href="/" className="flex min-w-0 items-center gap-3" aria-label="Parlay Projector home">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-violet-400/25 bg-violet-500/12 text-violet-300 shadow-[0_0_30px_rgba(124,58,237,.16)]">
            <Orbit className="size-5" aria-hidden="true" />
          </span>
          <span className="truncate text-base font-semibold tracking-[-0.03em] sm:text-lg">Parlay Projector</span>
        </a>

        <nav className="mx-auto hidden h-full items-center gap-8 lg:flex" aria-label="Primary navigation">
          {primaryNavigation.map((item) => (
            <a
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? 'page' : undefined}
              className={`relative flex h-full items-center text-sm transition-colors ${
                active === item.key ? 'text-white' : 'text-white/48 hover:text-white'
              }`}
            >
              {item.label}
              {active === item.key && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-violet-500" />}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <a
            href="/notifications"
            className={`icon-button relative ${active === 'notifications' ? 'text-violet-300' : ''}`}
            aria-label="Notifications"
          >
            <Bell className="size-[18px]" />
          </a>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-white/8 px-4 py-6 lg:flex">
          <p className="section-label">Sports</p>
          {/*
            These navigate to a competition hub; the Schedule and Live chips
            filter those pages. Two different jobs, deliberately separated.

            Plain anchors: the router shim intercepts <Link> and has no fallback
            when it cannot resolve a route. See the game-card regression in
            components/schedule.
          */}
          <nav className="mt-3 space-y-1" aria-label="Sports">
            <a href="/schedule" className="sidebar-item">
              <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[.03] text-[9px] font-semibold">●</span>
              All Sports
            </a>
            {SIDEBAR_HUBS.map(({ slug, label, emoji }) => (
              <a
                key={slug}
                href={`/sports/${slug}`}
                aria-current={activeHub === slug ? 'page' : undefined}
                className={`sidebar-item ${activeHub === slug ? 'border border-violet-400/15 bg-violet-500/[.11] text-violet-200' : ''}`}
              >
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-lg border border-white/8 bg-white/[.03] text-[11px]">{emoji}</span>
                <span className="truncate">{label}</span>
              </a>
            ))}
          </nav>

          <div className="mt-auto rounded-2xl border border-violet-400/15 bg-violet-500/[.055] p-4">
            <div className="flex items-center gap-2 text-violet-300/70"><Star className="size-3" /><span className="text-[10px] uppercase tracking-[.17em]">Creator mark</span></div>
            <p className="mt-2 text-sm font-medium text-white/65">by HyPz</p>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 pb-28 pt-7 md:px-7 md:pb-10 xl:px-9">
          <div className="mx-auto max-w-[1320px]">{children}</div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-[74px] grid-cols-4 border-t border-white/10 bg-[#09080f]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
        {primaryNavigation.map(({ key, label, href, icon: Icon }) => (
          <a
            key={key}
            href={href}
            aria-current={active === key ? 'page' : undefined}
            className={`flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] transition ${active === key ? 'text-violet-300' : 'text-white/38'}`}
          >
            <Icon className="size-[19px]" />
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </div>
    </WatchlistProvider>
  );
}
