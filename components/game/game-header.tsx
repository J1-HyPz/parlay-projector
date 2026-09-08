'use client';

/**
 * Game header: context strip, then the matchup.
 *
 * Scheduled games show `VS`; live and finished games show the score. A
 * scheduled game never renders a 0-0.
 */

import { CalendarDays, Clock3, MapPin } from 'lucide-react';
import type { GameDetail, TeamDetail } from '@/lib/games/types';
import { formatDate, formatTime, hasScore } from './game-data';
import { Crest } from '@/components/ui/crest';
import { StatusBadge } from '@/components/ui/status-badge';
import { WatchButton } from '@/components/watchlist/watch-button';
import { SlipButton } from '@/components/slip/slip-button';

export function GameStatusBadge({ game }: { game: GameDetail }) {
  return (
    <StatusBadge
      status={game.status}
      label={game.status === 'unknown' ? 'Status unavailable' : undefined}
    />
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
      <Crest name={team.name} logo={team.logo} size="xl" />

      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-ink-strong md:text-lg">{team.name}</p>
        {team.abbreviation && (
          <p className="mt-0.5 text-2xs uppercase tracking-wider text-ink-subtle">
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pr-1.5 text-2xs text-ink-subtle">
        <GameStatusBadge game={game} />
        <span className="font-medium uppercase tracking-wider text-violet-300">
          {game.sport.toUpperCase()}
        </span>
        {game.league && (
          <>
            <span aria-hidden="true" className="text-ink-faint">·</span>
            <span className="min-w-0 max-w-full truncate">{game.league}</span>
          </>
        )}
        {game.round && (
          <>
            <span aria-hidden="true" className="text-ink-faint">·</span>
            <span>Round {game.round}</span>
          </>
        )}
        {game.game_state && (
          <>
            <span aria-hidden="true" className="text-ink-faint">·</span>
            <span className="text-status-live">{game.game_state}</span>
          </>
        )}

        {/* Not nested in a link here, so it needs no wrapper of its own. */}
        <SlipButton game={game} className="ml-auto" />
        <WatchButton game={game} />
      </div>

      {/* Matchup */}
      <div className="mt-7 flex items-center justify-between gap-4 md:gap-8">
        <TeamIdentity team={game.away_team} align="left" />

        <div className="shrink-0 text-center">
          {showScore ? (
            <div className="flex items-center gap-3 text-3xl font-semibold tabular-nums text-ink-strong md:gap-5 md:text-4xl">
              <span>{game.score?.away ?? '--'}</span>
              <span className="text-lg text-ink-faint md:text-xl">-</span>
              <span>{game.score?.home ?? '--'}</span>
            </div>
          ) : (
            <span className="text-sm font-medium uppercase tracking-[.2em] text-ink-faint">VS</span>
          )}
          {!showScore && time && (
            <p className="mt-2 text-sm font-medium text-ink-muted">{time}</p>
          )}
        </div>

        <TeamIdentity team={game.home_team} align="right" />
      </div>

      <p className="mt-2 text-center text-2xs uppercase tracking-wider text-ink-faint">
        Away · Home
      </p>

      {/* When and where */}
      <div className="mt-7 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-line pt-5 text-xs text-ink-subtle">
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
