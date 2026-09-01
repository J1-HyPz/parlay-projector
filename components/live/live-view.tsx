'use client';

/**
 * Live scoreboard.
 *
 * Preserves the existing page: summary cards, sport chips and a league filter
 * above a list of game cards. Desktop is a wide card, mobile stacks the same
 * information. Cards link to `/games/:id` with the provider event id, so a live
 * game opens the same detail page as Home and Schedule.
 */

import { Activity, Radio, RefreshCw, Trophy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SportId } from '@/lib/home/types';
import type { LiveGame } from '@/lib/live/types';
import { ALL_LEAGUES, SPORT_TABS, separatorFor, sportLabel } from '@/lib/schedule/filters';
import { formatUpdatedAt, useLive } from './live-data';

function StatCard({
  label,
  icon: Icon,
  value,
  note,
}: {
  label: string;
  icon: LucideIcon;
  value: string;
  note: string;
}) {
  return (
    <article className="panel flex min-h-28 items-center justify-between p-4">
      <div>
        <p className="text-xs text-white/42">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-white/75">{value}</p>
        <p className="mt-1 text-[10px] text-white/27">{note}</p>
      </div>
      <span className="grid size-10 place-items-center rounded-xl border border-violet-400/15 bg-violet-500/[.08] text-violet-300">
        <Icon className="size-[18px]" />
      </span>
    </article>
  );
}

/**
 * Live badge.
 *
 * Uses the application's purple accent, and the pulse is disabled under
 * `prefers-reduced-motion` via Tailwind's `motion-reduce` variant.
 */
function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-violet-400/25 bg-violet-500/12 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
      <span className="size-1.5 rounded-full bg-violet-400 motion-safe:animate-pulse motion-reduce:animate-none" />
      Live
    </span>
  );
}

/** A score that has not arrived yet shows `--`, never 0 or NaN. */
function Score({ value }: { value: number | null }) {
  return (
    <span className="text-xl font-semibold tabular-nums text-white/85 md:text-2xl">
      {value === null ? '--' : value}
    </span>
  );
}

function TeamRow({ team, score }: { team: LiveGame['home_team']; score: number | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        {team.logo ? (
          // oxlint-disable-next-line nextjs/no-img-element -- remote team badge from the sports provider CDN; see components/home/games-today.tsx
          <img
            src={team.logo}
            alt=""
            loading="lazy"
            className="size-8 shrink-0 rounded-full border border-white/9 bg-white/[.04] object-contain"
          />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-full border border-white/9 bg-white/[.04] text-[9px] text-white/40">
            {team.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="truncate text-sm text-white/72">{team.name}</span>
      </div>
      <Score value={score} />
    </div>
  );
}

function GameCard({ game }: { game: LiveGame }) {
  return (
    <a
      href={`/games/${game.id}`}
      aria-label={`${game.away_team.name} ${separatorFor(game.sport)} ${game.home_team.name}, live, view game details`}
      className="panel block p-4 transition hover:border-violet-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 active:bg-white/[.06] md:p-5"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <LiveBadge />
        <span className="truncate text-[11px] font-medium uppercase tracking-wider text-violet-300">
          {sportLabel(game.sport)}
        </span>
        {game.league && (
          <>
            <span className="text-white/20">·</span>
            <span className="truncate text-[11px] text-white/45">{game.league}</span>
          </>
        )}
        {game.game_state.display && (
          <span className="ml-auto shrink-0 text-[11px] font-medium text-white/60">
            {game.game_state.display}
          </span>
        )}
      </div>

      <div className="mt-4 space-y-3 border-t border-white/7 pt-4">
        <TeamRow team={game.away_team} score={game.score.away} />
        <TeamRow team={game.home_team} score={game.score.home} />
      </div>

      {(game.venue.name ?? game.venue.city) && (
        <p className="mt-4 truncate border-t border-white/7 pt-3 text-[11px] text-white/31">
          {[game.venue.name, game.venue.city].filter(Boolean).join(' · ')}
        </p>
      )}
    </a>
  );
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading live scores">
      {[0, 1, 2].map((card) => (
        <div key={card} className="panel p-4 md:p-5">
          <div className="flex items-center gap-3">
            <div className="h-5 w-14 rounded-md bg-white/[.06]" />
            <div className="h-3 w-16 rounded-full bg-white/[.05]" />
            <div className="ml-auto h-3 w-20 rounded-full bg-white/[.045]" />
          </div>
          <div className="mt-4 space-y-3 border-t border-white/7 pt-4">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="size-8 rounded-full bg-white/[.06]" />
                  <div className="h-3 w-36 rounded-full bg-white/[.05]" />
                </div>
                <div className="h-5 w-8 rounded bg-white/[.06]" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function LiveView() {
  const { state, data, stale, refresh } = useLive();
  const [sport, setSport] = useState<SportId>('all');
  const [league, setLeague] = useState<string>(ALL_LEAGUES);

  const games = useMemo(() => data?.games ?? [], [data]);
  const timezone = data?.timezone ?? 'Europe/London';

  const leagues = useMemo(() => {
    const found = new Set<string>();
    for (const game of games) if (game.league) found.add(game.league);
    return [ALL_LEAGUES, ...[...found].sort((a, b) => a.localeCompare(b))];
  }, [games]);

  const filtered = useMemo(
    () =>
      games.filter((game) => {
        if (sport !== 'all' && game.sport !== sport) return false;
        if (league !== ALL_LEAGUES && game.league !== league) return false;
        return true;
      }),
    [games, sport, league],
  );

  const summary = useMemo(
    () => ({
      live: games.length,
      sports: new Set(games.map((game) => game.sport)).size,
      leagues: new Set(games.map((game) => game.league).filter(Boolean)).size,
    }),
    [games],
  );

  const updatedAt = formatUpdatedAt(data?.updated_at, timezone);
  const ready = state === 'loaded';

  return (
    <>
      <section className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Live overview">
        <StatCard
          label="Live Now"
          icon={Radio}
          value={ready ? String(summary.live) : '--'}
          note="Games in progress"
        />
        <StatCard
          label="Sports Active"
          icon={Trophy}
          value={ready ? String(summary.sports) : '--'}
          note="Currently represented"
        />
        <StatCard
          label="Leagues Active"
          icon={Activity}
          value={ready ? String(summary.leagues) : '--'}
          note="With live games"
        />
        <StatCard
          label="Last Updated"
          icon={RefreshCw}
          value={updatedAt ?? '--'}
          note={`Refreshes every ${Math.round((data?.refresh_interval_ms ?? 30_000) / 1000)}s`}
        />
      </section>

      <section
        className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        aria-label="Live filters"
      >
        <div className="horizontal-cards" aria-label="Sport filters">
          {SPORT_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={sport === tab.id}
              onClick={() => setSport(tab.id)}
              className={`min-h-9 shrink-0 rounded-xl border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                sport === tab.id
                  ? 'border-violet-500 bg-violet-600 text-white hover:bg-violet-500'
                  : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <select
          aria-label="League"
          value={league}
          onChange={(event) => setLeague(event.target.value)}
          className="h-10 min-w-28 max-w-[220px] rounded-xl border border-white/9 bg-[#0f0d17] px-3 text-xs text-white/55 outline-none focus:border-violet-400/40"
        >
          {leagues.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </section>

      {stale && updatedAt && (
        <p className="mt-4 rounded-xl border border-amber-400/15 bg-amber-500/[.06] px-3 py-2 text-[11px] text-amber-200/80">
          Unable to refresh. Showing scores from {updatedAt}.
        </p>
      )}

      {/*
        `aria-live="polite"` on the count only. Announcing every card on a
        30-second cycle would spam a screen reader; the summary is enough to
        signal that something changed.
      */}
      <p className="sr-only" aria-live="polite">
        {ready ? `${filtered.length} games live` : ''}
      </p>

      <section className="mt-4" aria-labelledby="live-list-heading">
        <h2 id="live-list-heading" className="sr-only">
          Live games
        </h2>

        {state === 'loading' ? (
          <Skeleton />
        ) : state === 'error' ? (
          <div className="panel flex min-h-[160px] flex-col items-center justify-center gap-3 p-6 text-center">
            <p className="text-xs text-white/38">Live scores are temporarily unavailable.</p>
            <button
              type="button"
              onClick={refresh}
              className="min-h-9 rounded-xl border border-white/9 bg-white/[.025] px-3 text-xs text-white/55 transition hover:border-violet-400/30 hover:text-white"
            >
              Try again
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="panel flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-xs text-white/45">
              {games.length === 0
                ? 'No games are live right now.'
                : `No live ${sport === 'all' ? '' : `${sportLabel(sport)} `}games match this filter.`}
            </p>
            <a href="/schedule" className="text-xs text-violet-300 hover:text-violet-200">
              Check the Schedule for upcoming games
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
