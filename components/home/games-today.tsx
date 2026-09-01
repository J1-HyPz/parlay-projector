'use client';

/**
 * Games Today.
 *
 * Sports information only — teams, kick-off, venue, status. No odds, spreads,
 * totals or bookmaker data appear here by design.
 *
 * Keeps the original card layout; the skeleton doubles as the loading state.
 */

import { SectionHeading, PlaceholderLine } from '@/components/dashboard-ui';
import type { Game } from '@/lib/home/types';
import { formatTime, useHomeData, useSectionFailed } from './home-data';

const STATUS_LABEL: Record<Game['status'], string> = {
  scheduled: 'Scheduled',
  live: 'Live',
  finished: 'Finished',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
  unknown: 'Status unavailable',
};

function TeamRow({ name, logo, align }: { name: string; logo: string | null; align: 'left' | 'right' }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          loading="lazy"
          className="size-7 shrink-0 rounded-full border border-white/9 bg-white/[.04] object-contain"
        />
      ) : (
        <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/9 bg-white/[.04] text-[9px] text-white/32">
          --
        </span>
      )}
      <span className="truncate text-sm text-white/68">{name}</span>
    </div>
  );
}

function GameCard({ game, timezone }: { game: Game; timezone: string }) {
  return (
    <article className="panel min-w-[245px] flex-1 p-4">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate font-medium text-violet-300">{game.league ?? game.sport.toUpperCase()}</span>
        <span className="shrink-0 text-white/32">
          {game.status === 'live' ? 'Live' : formatTime(game.start_time, timezone)}
        </span>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <TeamRow name={game.home_team.name} logo={game.home_team.logo} align="left" />
        </div>
        <span className="shrink-0 text-xs text-white/25">VS</span>
        <div className="min-w-0 flex-1">
          <TeamRow name={game.away_team.name} logo={game.away_team.logo} align="right" />
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-white/7 pt-3 text-[11px] text-white/30">
        <span className="size-1.5 shrink-0 rounded-full bg-violet-400/60" />
        <span className="truncate">{game.venue.name ?? 'Venue to be confirmed'}</span>
        <span className="ml-auto shrink-0 text-white/25">{STATUS_LABEL[game.status]}</span>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="panel min-w-[245px] flex-1 p-4">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-violet-300">&nbsp;</span>
        <span className="text-white/32">Time --</span>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <PlaceholderLine className="w-24" />
          <PlaceholderLine className="w-16" />
        </div>
        <span className="text-xs text-white/25">VS</span>
        <div className="space-y-2 text-right">
          <PlaceholderLine className="ml-auto w-20" />
          <PlaceholderLine className="ml-auto w-14" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 border-t border-white/7 pt-3 text-[11px] text-white/30">
        <span className="size-1.5 rounded-full bg-violet-400/60" /> Loading fixtures
      </div>
    </article>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="panel flex min-h-[132px] w-full items-center justify-center p-4 text-center text-xs text-white/36">
      {children}
    </div>
  );
}

export function GamesToday() {
  const { state, data } = useHomeData();
  const failed = useSectionFailed('sports_data_unavailable');

  return (
    <section>
      <SectionHeading title="Games Today" link="View schedule" />

      {state === 'loading' ? (
        <div className="horizontal-cards">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : failed ? (
        <Notice>Sports data currently unavailable.</Notice>
      ) : data && data.games.length > 0 ? (
        <div className="horizontal-cards">
          {data.games.map((game) => (
            <GameCard key={game.id} game={game} timezone={data.timezone} />
          ))}
        </div>
      ) : (
        <Notice>No games scheduled today.</Notice>
      )}
    </section>
  );
}
