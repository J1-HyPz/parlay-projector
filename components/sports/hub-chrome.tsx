'use client';

/**
 * Hub header, section navigation and the two competition selectors.
 *
 * All presentation. The competition catalogue stays in lib/leagues/registry and
 * the hub configuration in lib/sports/hubs; nothing about a competition is
 * restated here.
 */

import { GraduationCap, Radio } from 'lucide-react';
import type { HubConfig, HubDivision } from '@/lib/sports/hubs';
import { FOOTBALL_GROUPS, HUBS } from '@/lib/sports/hubs';

export type HubSection =
  | 'overview'
  | 'scores'
  | 'standings'
  | 'news'
  | 'teams'
  | 'transactions';

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function HubHeader({
  hub,
  season,
  collegiate,
  liveCount,
}: {
  hub: HubConfig;
  season: string | null;
  collegiate: boolean;
  liveCount: number;
}) {
  const { terminology } = hub;

  return (
    <header className="border-b border-white/8 pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span aria-hidden="true" className="text-2xl">
          {hub.emoji}
        </span>
        <h1 className="text-2xl font-semibold md:text-3xl">{hub.label}</h1>

        {liveCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-400/25 bg-rose-500/12 px-2.5 py-1 text-[11px] font-medium text-rose-300">
            <Radio className="size-3" aria-hidden="true" />
            {liveCount} live
          </span>
        )}

        {collegiate && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[11px] text-white/45">
            <GraduationCap className="size-3" aria-hidden="true" />
            Collegiate
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-white/40">
        {season ? `${season} season · ` : ''}
        {[terminology.games, terminology.standings, 'News', terminology.teams, terminology.transactions].join(' · ')}
      </p>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Section navigation
// ---------------------------------------------------------------------------

export function HubNavigation({
  hub,
  active,
  onSelect,
}: {
  hub: HubConfig;
  active: HubSection;
  onSelect: (section: HubSection) => void;
}) {
  const sections: { id: HubSection; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'scores', label: 'Scores' },
    { id: 'standings', label: hub.terminology.standings },
    { id: 'news', label: 'News' },
    { id: 'teams', label: hub.terminology.teams },
    { id: 'transactions', label: hub.terminology.transactions },
  ];

  return (
    <nav className="horizontal-cards mt-4" aria-label="Hub sections">
      {sections.map((section) => (
        <button
          key={section.id}
          type="button"
          aria-current={active === section.id ? 'page' : undefined}
          onClick={() => onSelect(section.id)}
          className={`min-h-9 shrink-0 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
            active === section.id
              ? 'border-violet-500 bg-violet-600 text-white hover:bg-violet-500'
              : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
          }`}
        >
          {section.label}
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Men's / Women's for the combined NCAA basketball hub.
 *
 * A genuine filter, unlike the football switcher below, which navigates: the
 * two divisions live on one page.
 */
export function DivisionSelector({
  divisions,
  active,
  onSelect,
}: {
  divisions: readonly HubDivision[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="horizontal-cards border-0 p-0">
      <legend className="sr-only">NCAA division</legend>
      {divisions.map((division) => (
        <button
          key={division.id}
          type="button"
          aria-pressed={active === division.id}
          onClick={() => onSelect(division.id)}
          className={`min-h-8 shrink-0 rounded-lg border px-3 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
            active === division.id
              ? 'border-violet-500 bg-violet-600 text-white'
              : 'border-white/9 bg-white/[.02] text-white/48 hover:text-white'
          }`}
        >
          {division.label}
        </button>
      ))}
    </fieldset>
  );
}

/**
 * Football competition switcher.
 *
 * Only the Premier League and the Champions League have permanent sidebar
 * shortcuts — seventeen would be an unusable navigation column — so every
 * football hub carries this to reach the other seven.
 *
 * Plain anchors, deliberately: the router shim intercepts <Link> and has no
 * fallback when it cannot resolve a route. See the game-card regression in
 * components/schedule.
 */
export function CompetitionSelector({ activeSlug }: { activeSlug: string }) {
  const labels = new Map(HUBS.map((hub) => [hub.slug, hub.label]));

  return (
    <section className="panel mt-4 p-4" aria-labelledby="competition-selector">
      <h2 id="competition-selector" className="text-xs font-medium uppercase tracking-wider text-white/32">
        Football competitions
      </h2>

      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        {FOOTBALL_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="text-[11px] uppercase tracking-wider text-violet-300/70">
              {group.label}
            </p>
            <ul className="mt-2 space-y-1">
              {group.slugs.map((slug) => (
                <li key={slug}>
                  <a
                    href={`/sports/${slug}`}
                    aria-current={slug === activeSlug ? 'page' : undefined}
                    className={`block truncate rounded-lg px-2 py-1.5 text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      slug === activeSlug
                        ? 'bg-violet-500/12 text-violet-200'
                        : 'text-white/48 hover:bg-white/[.04] hover:text-white'
                    }`}
                  >
                    {labels.get(slug) ?? slug}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
