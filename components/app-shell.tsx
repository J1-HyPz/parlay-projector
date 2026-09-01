import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bell,
  CalendarDays,
  CircleUserRound,
  House,
  Newspaper,
  Orbit,
  Radio,
  Search,
  Sparkles,
  Star,
  UsersRound,
} from 'lucide-react';

export type PageKey = 'home' | 'schedule' | 'live' | 'parlays' | 'profile';

const primaryNavigation: { key: PageKey; label: string; href: string; icon: LucideIcon }[] = [
  { key: 'home', label: 'Home', href: '/', icon: House },
  { key: 'schedule', label: 'Schedule', href: '/schedule', icon: CalendarDays },
  { key: 'live', label: 'Live', href: '/live', icon: Radio },
  { key: 'parlays', label: 'Parlays', href: '/parlays', icon: Sparkles },
];

const sports = ['All Sports', 'NFL', 'NBA', 'MLB', 'NHL', 'Football', 'Tennis'];

const quickLinks: { label: string; icon: LucideIcon }[] = [
  { label: 'My Teams', icon: UsersRound },
  { label: 'Alerts', icon: Bell },
  { label: 'News', icon: Newspaper },
  { label: 'Calendar', icon: CalendarDays },
];

export function AppShell({ active, children }: { active: PageKey; children: ReactNode }) {
  return (
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
          <button className="icon-button" aria-label="Search placeholder"><Search className="size-[18px]" /></button>
          <button className="icon-button relative" aria-label="Notifications placeholder">
            <Bell className="size-[18px]" />
            <span className="absolute right-2 top-2 size-1.5 rounded-full bg-violet-400" />
          </button>
          <a href="/profile" className={`icon-button hidden sm:grid ${active === 'profile' ? 'text-violet-300' : ''}`} aria-label="Profile">
            <CircleUserRound className="size-[19px]" />
          </a>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col border-r border-white/8 px-4 py-6 lg:flex">
          <p className="section-label">Sports</p>
          <nav className="mt-3 space-y-1" aria-label="Sports">
            {sports.map((sport, index) => (
              <button key={sport} className={`sidebar-item ${index === 0 ? 'sidebar-item-active' : ''}`}>
                <span className="grid size-6 place-items-center rounded-lg border border-white/8 bg-white/[.03] text-[9px] font-semibold">{index === 0 ? '●' : sport.slice(0, 2)}</span>
                {sport}
              </button>
            ))}
          </nav>

          <div className="my-6 h-px bg-white/7" />
          <p className="section-label">Quick links</p>
          <nav className="mt-3 space-y-1" aria-label="Quick links">
            {quickLinks.map(({ label, icon: Icon }) => (
              <button key={label} className="sidebar-item">
                <Icon className="size-4 text-white/32" /> {label}
              </button>
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

      <nav className="fixed inset-x-0 bottom-0 z-50 grid h-[74px] grid-cols-5 border-t border-white/10 bg-[#09080f]/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Mobile navigation">
        {[...primaryNavigation, { key: 'profile' as const, label: 'Profile', href: '/profile', icon: CircleUserRound }].map(({ key, label, href, icon: Icon }) => (
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
  );
}
