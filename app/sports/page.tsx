/**
 * GET /sports
 *
 * The competition index.
 *
 * Exists because the sidebar shortcuts are desktop-only (`lg:flex`), which left
 * the hubs unreachable on a phone. The mobile navigation's Sports tab opens
 * this page.
 *
 * Deliberately lists every competition rather than mirroring the sidebar: the
 * sidebar is curated down to nine because a navigation column has no room, and
 * a full page does. Grouping comes from the league catalogue.
 */

import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/dashboard-ui';
import { hubGroups } from '@/lib/sports/hubs';

export const dynamic = 'force-dynamic';

export default function SportsIndexPage() {
  const groups = hubGroups();

  return (
    <AppShell active="sports">
      <PageHeader
        eyebrow="Competitions"
        title="Sports"
        subtitle="Scores, standings, news, teams and transactions for every competition."
      />

      <div className="mt-6 space-y-8">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`group-${group.id}`}>
            <h2
              id={`group-${group.id}`}
              className="flex items-center gap-2 text-sm font-semibold text-white/70"
            >
              <span aria-hidden="true">{group.emoji}</span>
              {group.label}
            </h2>

            {/*
              Plain anchors: the router shim intercepts <Link> and has no
              fallback when it cannot resolve a route. See the game-card
              regression in components/schedule.
            */}
            <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.hubs.map((hub) => (
                <li key={hub.slug}>
                  <a
                    href={`/sports/${hub.slug}`}
                    className="panel flex min-h-14 items-center gap-3 p-3 transition hover:border-violet-400/35 active:bg-white/[.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
                  >
                    <span
                      aria-hidden="true"
                      className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[.03] text-base"
                    >
                      {hub.emoji}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white/75">{hub.label}</span>
                      <span className="block truncate text-[11px] text-white/30">
                        {[hub.terminology.games, hub.terminology.standings, hub.terminology.teams].join(
                          ' · ',
                        )}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
