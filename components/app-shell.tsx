import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  CalendarDays,
  House,
  ListChecks,
  Orbit,
  Radio,
  Sparkles,
  Star,
  Target,
  Trophy,
} from 'lucide-react';
import { SIDEBAR_HUBS } from '@/lib/sports/hubs';
import { WatchlistProvider } from '@/components/watchlist/watchlist-context';
import { SlipProvider } from '@/components/slip/slip-context';
import { SlipCount } from '@/components/slip/slip-count';

export type PageKey =
  | 'home'
  | 'schedule'
  | 'live'
  | 'parlays'
  | 'slips'
  | 'accuracy'
  | 'notifications'
  | 'sports';

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
  { key: 'slips', label: 'Slips', href: '/slips', icon: ListChecks },
  // Last in the row, because it reports on the model rather than driving it —
  // but in the primary navigation rather than buried, because a projection
  // application that hides its own scorecard is asking to be taken on trust.
  { key: 'accuracy', label: 'Accuracy', href: '/accuracy', icon: Target },
];

/**
 * Mobile gets one tab the desktop header does not.
 *
 * The sport shortcuts live in the sidebar, which is `lg:flex` — so on a phone
 * there was no way to reach a competition hub at all. This tab opens the
 * competition index instead. Desktop keeps the sidebar and does not need it.
 */
const mobileNavigation: typeof primaryNavigation = [
  /*
   * Accuracy is left out here rather than squeezed in. The bar is a fixed six
   * columns inside a fixed height, so a seventh item wraps to a second row and
   * breaks all seven rather than narrowing one. On a phone the page is reached
   * from the homepage accuracy panel, which links straight to it.
   */
  ...primaryNavigation.filter((item) => item.key !== 'accuracy'),
  { key: 'sports', label: 'Sports', href: '/sports', icon: Trophy },
];

export function AppShell({ active, activeHub, children }: AppShellProps) {
  return (
    <SlipProvider>
    <WatchlistProvider>
    <div className="min-h-screen bg-background text-foreground">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-violet-600 focus:px-4 focus:py-2 focus:text-xs focus:font-medium focus:text-white"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 flex h-16 items-center border-b border-line bg-[#09080f]/92 px-4 backdrop-blur-xl md:px-6">
        <a
          href="/"
          className="focus-ring flex min-w-0 items-center gap-3 rounded-xl py-1 pr-2"
          aria-label="Parlay Projector home"
        >
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
              className={`focus-ring relative flex h-full items-center rounded-lg px-1 text-sm transition-colors ${
                active === item.key ? 'text-ink-strong' : 'text-ink-muted hover:text-ink-strong'
              }`}
            >
              {item.label}
              {item.key === 'slips' && <SlipCount />}
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
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-line px-4 py-6 lg:flex">
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
              <span
                aria-hidden="true"
                className="grid size-6 shrink-0 place-items-center rounded-lg border border-line bg-surface-1 text-2xs font-semibold"
              >
                ●
              </span>
              All Sports
            </a>
            {SIDEBAR_HUBS.map(({ slug, label, emoji }) => (
              <a
                key={slug}
                href={`/sports/${slug}`}
                aria-current={activeHub === slug ? 'page' : undefined}
                className={`sidebar-item ${activeHub === slug ? 'border border-violet-400/15 bg-violet-500/[.11] text-violet-200' : ''}`}
              >
                <span aria-hidden="true" className="grid size-6 shrink-0 place-items-center rounded-lg border border-line bg-surface-1 text-2xs">{emoji}</span>
                <span className="truncate">{label}</span>
              </a>
            ))}
          </nav>

          <div className="mt-auto rounded-2xl border border-violet-400/15 bg-violet-500/[.055] p-4">
            <div className="flex items-center gap-2 text-violet-300/70"><Star className="size-3" /><span className="text-2xs uppercase tracking-[.17em]">Creator mark</span></div>
            <p className="mt-2 text-sm font-medium text-ink">by HyPz</p>
          </div>
        </aside>

        <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-6 sm:pt-7 md:px-7 lg:pb-12 xl:px-9">
          <div className="mx-auto max-w-[1320px]">{children}</div>
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-[74px] grid-cols-6 border-t border-line bg-[#09080f]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
        {mobileNavigation.map(({ key, label, href, icon: Icon }) => (
          <a
            key={key}
            href={href}
            aria-current={active === key ? 'page' : undefined}
            className={`focus-ring-inset flex min-w-0 flex-col items-center justify-center gap-1 text-2xs transition active:bg-surface-2 ${
              active === key ? 'text-violet-300' : 'text-ink-subtle'
            }`}
          >
            <Icon aria-hidden="true" className="size-[19px]" />
            <span className="flex items-center">
              {label}
              {key === 'slips' && <SlipCount />}
            </span>
          </a>
        ))}
      </nav>
    </div>
    </WatchlistProvider>
    </SlipProvider>
  );
}
