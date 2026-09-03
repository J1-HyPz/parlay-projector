'use client';

/**
 * Parlay Projector Analysis, on the game detail page.
 *
 * Reads the same projection endpoint the Parlays page uses, so a fixture's
 * numbers here and in a generated line are the same numbers — one model, one
 * cache, one answer.
 *
 * States "Projection unavailable" rather than filling the panel when the model
 * has too little to work with. That is a real outcome, not a failure.
 */

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { qualityLabel } from '@/lib/projections/types';
import type { GameProjection } from '@/lib/projections/types';
import { ProjectedScore } from '@/components/parlays/market-ui';

type State = 'loading' | 'ready' | 'unavailable' | 'error';

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 truncate text-[11px] text-white/45">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[.06]">
        <span
          className="block h-full rounded-full bg-violet-500"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-white/70">
        {percent(value)}
      </span>
    </div>
  );
}

export function ProjectorAnalysis({ gameId }: { gameId: string }) {
  const [state, setState] = useState<State>('loading');
  const [projection, setProjection] = useState<GameProjection | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `/api/projections/games/${encodeURIComponent(gameId)}`,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        );
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as { projection?: GameProjection | null };
        if (controller.signal.aborted) return;

        if (body.projection) {
          setProjection(body.projection);
          setState('ready');
        } else {
          setState('unavailable');
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }

    void load();
    return () => controller.abort();
  }, [gameId]);

  return (
    <section className="panel p-5" aria-label="Parlay Projector Analysis">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-violet-300" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Parlay Projector Analysis</h2>
      </div>

      {state === 'loading' && (
        <div className="h-40 animate-pulse rounded-xl bg-white/[.035]" aria-busy="true" />
      )}

      {(state === 'unavailable' || state === 'error') && (
        <div className="rounded-xl border border-violet-400/10 bg-violet-500/[.045] p-4">
          <p className="text-xs font-medium text-white/60">Projection unavailable</p>
          <p className="mt-1.5 text-[11px] leading-5 text-white/36">
            {state === 'error'
              ? 'The projection could not be loaded right now.'
              : 'There is not enough completed match history for these teams to support a projection. Nothing is estimated until there is.'}
          </p>
        </div>
      )}

      {state === 'ready' && projection && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Bar label={projection.home_team} value={projection.outcome.home} />
            {projection.outcome.draw !== undefined && (
              <Bar label="Draw" value={projection.outcome.draw} />
            )}
            <Bar label={projection.away_team} value={projection.outcome.away} />
          </div>

          {/* Named sides and a scoreline a game could finish on. An
              unlabelled "4.5 - 4.6" says neither who is who nor anything a
              real result could look like. */}
          <div className="border-t border-white/7 pt-4">
            <ProjectedScore
              homeTeam={projection.home_team}
              awayTeam={projection.away_team}
              homeScore={projection.expected_home_score}
              awayScore={projection.expected_away_score}
              typical={projection.typical_score}
              homeRange={projection.likely_home_range}
              awayRange={projection.likely_away_range}
            />
          </div>

          <dl className="grid grid-cols-3 gap-3 border-t border-white/7 pt-4 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/28">Model line</dt>
              <dd className="mt-1 font-medium tabular-nums text-white/70">
                {projection.model_spread > 0 ? '+' : ''}
                {projection.model_spread}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/28">Confidence</dt>
              <dd className="mt-1 font-medium tabular-nums text-white/70">
                {percent(projection.confidence)}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-white/28">Data quality</dt>
              <dd className="mt-1 font-medium text-white/70">
                {qualityLabel(projection.data_quality)}
              </dd>
            </div>
          </dl>

          {projection.factors.length > 0 && (
            <ul className="space-y-1.5 border-t border-white/7 pt-4">
              {projection.factors.slice(0, 4).map((factor) => (
                <li key={factor.text} className="flex gap-2 text-[11px] leading-5">
                  <span
                    aria-hidden="true"
                    className={
                      factor.direction === 'positive' ? 'text-emerald-300' : 'text-amber-300'
                    }
                  >
                    {factor.direction === 'positive' ? '+' : '−'}
                  </span>
                  <span className="sr-only">
                    {factor.direction === 'positive' ? 'Supporting factor:' : 'Risk factor:'}
                  </span>
                  <span className="text-white/45">{factor.text}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="border-t border-white/7 pt-3 text-[10px] leading-4 text-white/25">
            Statistical estimate from available data, model {projection.model_version}. Sports
            outcomes are uncertain and projections may be incorrect.
          </p>
        </div>
      )}
    </section>
  );
}
