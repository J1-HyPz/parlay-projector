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
import { sidesOf } from '@/lib/home/types';
import { EventBody, eventLabel } from '@/components/sports/event-body';
import type { Game, NewsArticle } from '@/lib/home/types';
import { badgeLabel, formatKickoff, separatorFor } from '@/lib/schedule/filters';
import { Crest } from '@/components/ui/crest';
import { StatusBadge } from '@/components/ui/status-badge';
import { InlineEmpty } from '@/components/ui/states';
import { WatchButton } from '@/components/watchlist/watch-button';

/** Keeps the page height stable while a section loads. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-16 animate-pulse rounded-xl bg-surface-2" />
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
      <Crest name={name} logo={logo} size="xs" bare />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
      {score !== null && (
        <span
          className={`shrink-0 tabular-nums text-sm ${
            emphasise ? 'font-semibold text-ink-strong' : 'text-ink-muted'
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
        className="panel block p-3 pr-12 transition hover:border-violet-400/35 focus-ring active:bg-surface-3"
      >
        <div className="flex items-center gap-2 text-2xs">
          <span className="shrink-0 rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-2xs text-violet-300">
            {badgeLabel(game.league, game.sport)}
          </span>
          <span className="shrink-0 tabular-nums text-ink-subtle">
            {formatKickoff(game.start_time, timezone)}
          </span>
          {game.round && <span className="truncate text-ink-faint">R{game.round}</span>}
          <StatusBadge status={game.status} className="ml-auto" />
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
          <p className="mt-2.5 truncate border-t border-line pt-2 text-2xs text-ink-faint">
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
  if (games.length === 0) return <InlineEmpty>{empty}</InlineEmpty>;
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
  if (articles.length === 0) return <InlineEmpty>No recent stories.</InlineEmpty>;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {articles.map((article) => (
        <a
          key={article.id}
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="panel flex gap-3 p-3 transition hover:border-violet-400/35 focus-ring"
        >
          {article.image && (
            /* Remote publisher thumbnail; see components/home/news-feed.tsx.
               The box is fixed so a slow CDN cannot reflow the list. */
            // oxlint-disable-next-line next/no-img-element
            <img
              src={article.image}
              alt=""
              aria-hidden="true"
              loading="lazy"
              decoding="async"
              className="size-16 shrink-0 rounded-lg bg-surface-1 object-cover"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 block text-sm text-ink">{article.headline}</span>
            {article.summary && (
              <span className="mt-1 line-clamp-2 block text-2xs text-ink-faint">
                {article.summary}
              </span>
            )}
            <span className="mt-1.5 block text-2xs text-ink-faint">
              {[article.source, publishedLabel(article.published_at)].filter(Boolean).join(' · ')}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}
