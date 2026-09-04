'use client';

/**
 * Shared presentation for the hub sections.
 *
 * Game rows reuse the shared `Game` model, the shared status vocabulary, the
 * shared formatters in lib/schedule/filters, the existing /games/:id detail
 * route and the existing watchlist button — a game starred here behaves exactly
 * as it does on Schedule.
 */

import type { ReactNode } from 'react';
import { CircleAlert, Inbox } from 'lucide-react';
import { sidesOf } from '@/lib/home/types';
import { EventBody, eventLabel } from '@/components/sports/event-body';
import type { Game, NewsArticle } from '@/lib/home/types';
import { badgeLabel, formatKickoff, separatorFor } from '@/lib/schedule/filters';
import { STATUS_LABEL, statusTone } from '@/lib/schedule/status';
import { WatchButton } from '@/components/watchlist/watch-button';

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** Nothing to show, but nothing wrong. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.02] px-4 py-5 text-sm text-white/38">
      <Inbox className="size-4 shrink-0 text-white/25" />
      {children}
    </p>
  );
}

/** Something went wrong in this section only. The rest of the hub still works. */
export function ErrorState({ children }: { children: ReactNode }) {
  return (
    <output className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-4 py-5 text-sm text-amber-200/80">
      <CircleAlert className="size-4 shrink-0" />
      {children}
    </output>
  );
}

/** Keeps the page height stable while a section loads. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-xl bg-white/[.035]" />
      ))}
    </div>
  );
}

export function SectionHeader({
  title,
  id,
  action,
}: {
  title: string;
  id: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <h2 id={id} className="text-base font-semibold">
        {title}
      </h2>
      {action}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

function TeamSide({
  name,
  logo,
  score,
  emphasise,
}: {
  name: string;
  logo: string | null;
  score: number | null;
  emphasise: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {logo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" aria-hidden="true" className="size-5 shrink-0 object-contain" />
      ) : (
        <span aria-hidden="true" className="size-5 shrink-0 rounded-full bg-white/[.06]" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-white/72">{name}</span>
      {score !== null && (
        <span
          className={`shrink-0 tabular-nums text-sm ${
            emphasise ? 'font-semibold text-white' : 'text-white/60'
          }`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

/**
 * One fixture.
 *
 * The star is a sibling of the link, never nested inside it: a button within an
 * anchor is invalid and would fight the navigation.
 */
export function HubGameRow({ game, timezone }: { game: Game; timezone: string }) {
  // Null for a race, which has a field rather than two sides.
  const sides = sidesOf(game);
  const score = game.score ?? null;
  const started = game.status === 'live' || game.status === 'finished';

  // The provider's own phrasing -- "Q3 - 8:42", "74'", "Final/OT". Never
  // synthesised: a clock this application invented would be wrong.
  const detail = game.provider_status;

  return (
    <div className="relative">
      <a
        href={`/games/${game.id}`}
        aria-label={
          sides
            ? `${sides.away.name} ${separatorFor(game.sport)} ${sides.home.name}, view game details`
            : `${eventLabel(game)}, view details`
        }
        className="panel block p-3 pr-12 transition hover:border-violet-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 active:bg-white/[.06]"
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span className="shrink-0 rounded-md border border-white/8 bg-white/[.04] px-1.5 py-0.5 text-[9px] text-violet-300">
            {badgeLabel(game.league, game.sport)}
          </span>
          <span className="shrink-0 tabular-nums text-white/38">
            {formatKickoff(game.start_time, timezone)}
          </span>
          {game.round && <span className="truncate text-white/25">R{game.round}</span>}
          <span
            className={`ml-auto shrink-0 rounded-full border px-2 py-0.5 text-[10px] ${statusTone(game.status)}`}
          >
            {STATUS_LABEL[game.status]}
          </span>
        </div>

        {sides ? (
          <div className="mt-2.5 space-y-1.5">
            <TeamSide
              name={sides.away.name}
              logo={sides.away.logo}
              score={started ? (score?.away ?? null) : null}
              emphasise={game.status === 'live'}
            />
            <TeamSide
              name={sides.home.name}
              logo={sides.home.logo}
              score={started ? (score?.home ?? null) : null}
              emphasise={game.status === 'live'}
            />
          </div>
        ) : (
          <EventBody game={game} compact />
        )}

        {(detail ?? game.venue.name ?? game.broadcast) && (
          <p className="mt-2.5 truncate border-t border-white/7 pt-2 text-[11px] text-white/30">
            {[game.status === 'live' ? detail : null, game.venue.name, game.broadcast]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </a>
      <WatchButton game={game} className="absolute right-3 top-3" />
    </div>
  );
}

export function GameList({
  games,
  timezone,
  empty,
}: {
  games: readonly Game[];
  timezone: string;
  empty: string;
}) {
  if (games.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {games.map((game) => (
        <HubGameRow key={game.id} game={game} timezone={timezone} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

function publishedLabel(published: string | null): string | null {
  if (!published) return null;
  const instant = new Date(published);
  if (Number.isNaN(instant.getTime())) return null;

  const minutes = Math.round((Date.now() - instant.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / (60 * 24))}d ago`;
}

export function NewsList({ articles }: { articles: readonly NewsArticle[] }) {
  if (articles.length === 0) return <EmptyState>No recent stories.</EmptyState>;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {articles.map((article) => (
        <a
          key={article.id}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="panel flex gap-3 p-3 transition hover:border-violet-400/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
        >
          {article.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={article.image}
              alt=""
              aria-hidden="true"
              className="size-16 shrink-0 rounded-lg object-cover"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-sm text-white/75">{article.headline}</span>
            {article.summary && (
              <span className="mt-1 line-clamp-2 block text-[11px] text-white/35">
                {article.summary}
              </span>
            )}
            <span className="mt-1.5 block text-[11px] text-white/28">
              {[article.source, publishedLabel(article.published_at)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}
