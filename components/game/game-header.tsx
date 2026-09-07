'use client';

/**
 * Game header: context strip, then the matchup.
 *
 * Scheduled games show `VS`; live and finished games show the score. A
 * scheduled game never renders a 0-0.
 */

import { CalendarDays, Clock3, MapPin } from 'lucide-react';
import type { GameDetail, TeamDetail } from '@/lib/games/types';
import { STATUS_LABEL, formatDate, formatTime, hasScore } from './game-data';
import { WatchButton } from '@/components/watchlist/watch-button';

export function GameStatusBadge({ game }: { game: GameDetail }) {
  const live = game.status === 'live';
  const tone = live
    ? 'border-rose-400/20 bg-rose-500/10 text-rose-300'
    : game.status === 'finished'
      ? 'border-white/10 bg-white/[.04] text-white/55'
      : 'border-violet-400/20 bg-violet-500/[.08] text-violet-300';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {live && <span className="size-1.5 rounded-full bg-rose-400" />}
      {STATUS_LABEL[game.status]}
    </span>
  );
}

export function TeamIdentity({
  team,
  align,
}: {
  team: TeamDetail;
  align: 'left' | 'right';
}) {
  // Full class names only: Tailwind cannot generate classes from interpolated
  // strings, so `md:items-${...}` would silently produce no CSS at all.
  const alignment =
    align === 'left' ? 'md:items-start md:text-left' : 'md:items-end md:text-right';

  return (
    <div
      className={`flex min-w-0 flex-1 flex-col items-center gap-3 text-center ${alignment}`}
    >
      {team.logo ? (
        // oxlint-disable-next-line nextjs/no-img-element -- remote team badge from the sports provider CDN; see components/home/games-today.tsx
        <img
          src={team.logo}
          alt=""
          loading="lazy"
          className="size-16 shrink-0 rounded-full border border-white/9 bg-white/[.04] object-contain p-1 md:size-20"
        />
      ) : (
        <span className="grid size-16 shrink-0 place-items-center rounded-full border border-white/9 bg-white/[.04] text-xs text-white/32 md:size-20">
          --
        </span>
      )}

      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-white/85 md:text-lg">{team.name}</p>
        {team.abbreviation && (
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-white/38">
            {team.abbreviation}
          </p>
        )}
      </div>
    </div>
  );
}

export function GameHeader({ game }: { game: GameDetail }) {
  const date = formatDate(game.start_time);
  const time = formatTime(game.start_time);
  const showScore = hasScore(game);

  return (
    <section className="panel p-5 md:p-7" aria-label="Game summary">
      {/* Context strip */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-white/45">
        <GameStatusBadge game={game} />
        <span className="font-medium uppercase tracking-wider text-violet-300">
          {game.sport.toUpperCase()}
        </span>
        {game.league && (
          <>
            <span className="text-white/20">·</span>
            <span className="truncate">{game.league}</span>
          </>
        )}
        {game.round && (
          <>
            <span className="text-white/20">·</span>
            <span>Round {game.round}</span>
          </>
        )}
        {game.game_state && (
          <>
            <span className="text-white/20">·</span>
            <span className="text-rose-300">{game.game_state}</span>
          </>
        )}

        {/* Not nested in a link here, so it needs no wrapper of its own. */}
        <WatchButton game={game} className="ml-auto" />
      </div>

      {/* Matchup */}
      <div className="mt-7 flex items-center justify-between gap-4 md:gap-8">
        <TeamIdentity team={game.away_team} align="left" />

        <div className="shrink-0 text-center">
          {showScore ? (
            <div className="flex items-center gap-3 text-3xl font-semibold tabular-nums text-white/85 md:gap-5 md:text-4xl">
              <span>{game.score?.away ?? '--'}</span>
              <span className="text-lg text-white/25 md:text-xl">-</span>
              <span>{game.score?.home ?? '--'}</span>
            </div>
          ) : (
            <span className="text-sm font-medium uppercase tracking-[.2em] text-white/30">VS</span>
          )}
          {!showScore && time && (
            <p className="mt-2 text-sm font-medium text-white/60">{time}</p>
          )}
        </div>

        <TeamIdentity team={game.home_team} align="right" />
      </div>

      <p className="mt-2 text-center text-[10px] uppercase tracking-wider text-white/25">
        Away · Home
      </p>

      {/* When and where */}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-white/7 pt-5 text-xs text-white/45">
        {date && (
          <span className="flex items-center gap-2">
            <CalendarDays className="size-3.5 text-violet-300/70" /> {date}
          </span>
        )}
        {time && (
          <span className="flex items-center gap-2">
            <Clock3 className="size-3.5 text-violet-300/70" /> {time}
          </span>
        )}
        {game.venue.name && (
          <span className="flex items-center gap-2">
            <MapPin className="size-3.5 text-violet-300/70" /> {game.venue.name}
            {game.venue.city ? `, ${game.venue.city}` : ''}
          </span>
        )}
      </div>
    </section>
  );
}
