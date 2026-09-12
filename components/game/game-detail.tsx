'use client';

/**
 * Game detail orchestrator: loading, not-found, error and loaded states, plus
 * the responsive layout.
 *
 * Desktop is a two-column grid under a full-width header; mobile stacks the
 * same sections in the same order. Nothing scrolls horizontally.
 */

import { ArrowLeft, SearchX, TriangleAlert } from 'lucide-react';
import { useCallback } from 'react';
import {
  GameInformation,
  HeadToHead,
  MatchupOverview,
  RecentForm,
  RecentGames,
  TeamComparison,
} from './game-sections';
import { Availability } from './availability';
import { GameHeader } from './game-header';
import { useGameDetail } from './game-data';
import { MarketExplorer } from './market-explorer';
import { ProjectorAnalysis } from './projector-analysis';
import { RaceField, RaceWeekend } from './race-sections';
import { isFieldDetail } from '@/lib/games/types';

/**
 * Back control.
 *
 * Uses history when there is somewhere to go back to, so arriving from Home
 * returns to Home and arriving from Schedule returns to Schedule. Falls back to
 * Home for a direct visit or a refreshed page, where there is no history entry.
 */
function BackLink() {
  const goBack = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = '/';
    }
  }, []);

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex min-h-9 items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 text-xs text-ink-muted transition hover:border-violet-400/30 hover:text-ink-strong focus-ring"
    >
      <ArrowLeft className="size-4" /> Back
    </button>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading game">
      <section className="panel p-5 md:p-7">
        <div className="h-5 w-40 rounded-full bg-surface-3" />
        <div className="mt-7 flex items-center justify-between gap-6">
          {[0, 1].map((side) => (
            <div key={side} className="flex flex-1 flex-col items-center gap-3">
              <div className="size-16 rounded-full bg-surface-3 md:size-20" />
              <div className="h-3 w-24 rounded-full bg-surface-3" />
              <div className="h-2 w-12 rounded-full bg-surface-2" />
            </div>
          ))}
        </div>
        <div className="mt-7 flex justify-center gap-6 border-t border-line pt-5">
          <div className="h-2.5 w-28 rounded-full bg-surface-2" />
          <div className="h-2.5 w-20 rounded-full bg-surface-2" />
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {[0, 1].map((block) => (
            <section key={block} className="panel space-y-3 p-5">
              <div className="h-3 w-32 rounded-full bg-surface-3" />
              {[0, 1, 2, 3].map((line) => (
                <div key={line} className="h-2.5 w-full rounded-full bg-surface-2" />
              ))}
            </section>
          ))}
        </div>
        <section className="panel space-y-3 p-5">
          <div className="h-3 w-28 rounded-full bg-surface-3" />
          {[0, 1, 2].map((line) => (
            <div key={line} className="h-2.5 w-full rounded-full bg-surface-2" />
          ))}
        </section>
      </div>
    </div>
  );
}

function Notice({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof SearchX;
  title: string;
  body: string;
}) {
  return (
    <div className="panel flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span className="grid size-12 place-items-center rounded-2xl border border-violet-400/15 bg-violet-500/[.08] text-violet-300">
        <Icon className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="max-w-sm text-xs leading-6 text-ink-subtle">{body}</p>
      <a
        href="/"
        className="mt-2 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-xs font-medium text-ink-strong transition hover:bg-violet-500"
      >
        Back to Home
      </a>
    </div>
  );
}

export function GameDetail({ gameId }: { gameId: string }) {
  const { state, game } = useGameDetail(gameId);

  return (
    <div>
      <div className="mb-5">
        <BackLink />
      </div>

      {state === 'loading' && <Skeleton />}

      {state === 'not_found' && (
        <Notice
          icon={SearchX}
          title="Game not found"
          body="No game exists with that id. It may have been removed by the sports data provider, or the link may be incorrect."
        />
      )}

      {state === 'error' && (
        <Notice
          icon={TriangleAlert}
          title="Game information is temporarily unavailable"
          body="The sports data provider could not be reached. This is usually temporary — try again shortly."
        />
      )}

      {state === 'loaded' && game && (
        <div className="space-y-6">
          <GameHeader game={game} />

          {/*
            Two columns of two-sided sections, or the field.

            A race session has no league table, no head-to-head and no squad
            news; those sections stand down on their own, and putting the field
            where they would have been keeps the page from being a header above
            four empty panels.
          */}
          {isFieldDetail(game) ? (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <RaceField game={game} />
              </div>
              <div className="min-w-0 space-y-6">
                <GameInformation game={game} />
                <RaceWeekend game={game} />
              </div>
            </div>
          ) : (
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-6">
                <GameInformation game={game} />
                {/* Above the historical sections: who is playing is the most
                    time-sensitive thing on this page, and the only part of it
                    that can change between opening the page and kick-off. */}
                <Availability game={game} />
                <TeamComparison game={game} />
                <RecentGames game={game} />
              </div>

              <div className="min-w-0 space-y-6">
                <MatchupOverview game={game} />
                <RecentForm game={game} />
                <HeadToHead game={game} />
              </div>
            </div>
          )}

          <ProjectorAnalysis gameId={game.id} />

          {/* Every market on the fixture, and a builder for combining them.
              Only meaningful before kick-off, and the panel says so itself
              rather than being conditionally hidden here. */}
          <MarketExplorer gameId={game.id} />
        </div>
      )}
    </div>
  );
}
