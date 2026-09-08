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
import { sidesOf } from '@/lib/home/types';
import { EventBody, eventHref, eventLabel } from '@/components/sports/event-body';
import type { Game } from '@/lib/home/types';
import { Crest } from '@/components/ui/crest';
import { StatusBadge } from '@/components/ui/status-badge';
import { Unavailable } from '@/components/ui/states';
import { WatchButton } from '@/components/watchlist/watch-button';
import { SlipButton } from '@/components/slip/slip-button';
import { formatTime, useHomeData, useSectionFailed } from './home-data';

function TeamRow({ name, logo, align }: { name: string; logo: string | null; align: 'left' | 'right' }) {
  return (
    <div
      className={`flex min-w-0 items-center gap-2 ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
    >
      <Crest name={name} logo={logo} size="sm" />
      <span className="truncate text-sm text-ink">{name}</span>
    </div>
  );
}

function GameCard({ game, timezone }: { game: Game; timezone: string }) {
  // A race has a field rather than two sides, so the middle of the card is
  // a different thing entirely. The chrome around it is the same.
  const sides = sidesOf(game);

  return (
    <div className="relative w-full shrink-0 snap-start sm:w-[260px] sm:flex-1">
      <a
        href={eventHref(game)}
        aria-label={
          sides
            ? `${sides.away.name} versus ${sides.home.name}, view game details`
            : `${eventLabel(game)}, view details`
        }
        className="panel group block cursor-pointer p-4 transition hover:border-violet-400/35 hover:bg-surface-2 focus-ring active:bg-surface-3"
      >
      <div className="flex items-center justify-between gap-2 pr-[92px] text-2xs">
        <span className="truncate font-medium text-violet-300">{game.league ?? game.sport.toUpperCase()}</span>
        <span className="shrink-0 text-ink-faint">
          {game.status === 'live' ? 'Live' : formatTime(game.start_time, timezone)}
        </span>
      </div>

      {sides ? (
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <TeamRow name={sides.home.name} logo={sides.home.logo} align="left" />
          </div>
          <span className="shrink-0 text-xs text-ink-faint">VS</span>
          <div className="min-w-0 flex-1">
            <TeamRow name={sides.away.name} logo={sides.away.logo} align="right" />
          </div>
        </div>
      ) : (
        <EventBody game={game} />
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-line pt-3 text-2xs text-ink-faint">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-violet-400/60" />
        <span className="truncate">{game.venue.name ?? 'Venue to be confirmed'}</span>
        <StatusBadge
          status={game.status}
          label={game.status === 'unknown' ? 'Status unavailable' : undefined}
          className="ml-auto"
        />
      </div>
      </a>
      <WatchButton game={game} className="absolute right-3 top-3" />
      <SlipButton game={game} className="absolute right-[56px] top-3" />
    </div>
  );
}

function SkeletonCard() {
  return (
    <article className="panel w-full shrink-0 sm:w-[260px] sm:flex-1 p-4">
      <div className="flex items-center justify-between text-2xs">
        <span className="font-medium text-violet-300">&nbsp;</span>
        <span className="text-ink-faint">Time --</span>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="space-y-2">
          <PlaceholderLine className="w-24" />
          <PlaceholderLine className="w-16" />
        </div>
        <span className="text-xs text-ink-faint">VS</span>
        <div className="space-y-2 text-right">
          <PlaceholderLine className="ml-auto w-20" />
          <PlaceholderLine className="ml-auto w-14" />
        </div>
      </div>
      <div className="mt-5 flex items-center gap-2 border-t border-line pt-3 text-2xs text-ink-faint">
        <span className="size-1.5 rounded-full bg-violet-400/60" /> Loading fixtures
      </div>
    </article>
  );
}

export function GamesToday() {
  const { state, data } = useHomeData();
  const failed = useSectionFailed('sports_data_unavailable');

  return (
    <section>
      <SectionHeading title="Games Today" href="/schedule" linkLabel="View schedule" />

      {state === 'loading' ? (
        <div className="horizontal-cards">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      ) : failed ? (
        <Unavailable>Sports data currently unavailable.</Unavailable>
      ) : data && data.games.length > 0 ? (
        <div className="horizontal-cards">
          {data.games.map((game) => (
            <GameCard key={game.id} game={game} timezone={data.timezone} />
          ))}
        </div>
      ) : (
        <Unavailable>No games scheduled today.</Unavailable>
      )}
    </section>
  );
}
