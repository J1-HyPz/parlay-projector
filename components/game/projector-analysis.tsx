'use client';

/**
 * Parlay Projector Analysis, on the game detail page.
 *
 * Reads the same projection endpoint the Parlays page uses, so a fixture's
 * numbers here and in a generated line are the same numbers — one model, one
 * cache, one answer.
 *
 * Two shapes arrive on it. A team fixture's projection has an expected score
 * and a scoreline it could finish on; a fight's or a tennis match's has a
 * winner probability and the two records it rests on, and nothing that looks
 * like a score, because the contest has none. The panel shows whichever it
 * was given and never dresses one up as the other.
 *
 * States "Projection unavailable" rather than filling the panel when the model
 * has too little to work with. That is a real outcome, not a failure.
 */

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { qualityLabel } from '@/lib/projections/types';
import type { BoutProjection, BoutRecord, GameProjection } from '@/lib/projections/types';
import type { ProjectionFactor } from '@/lib/projections/factors';
import { ProjectedScore } from '@/components/parlays/market-ui';

type State = 'loading' | 'ready' | 'unavailable' | 'error';

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-20 shrink-0 truncate text-2xs text-ink-subtle">{label}</span>
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full bg-violet-500"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-ink">
        {percent(value)}
      </span>
    </div>
  );
}

function Factors({ factors }: { factors: ProjectionFactor[] }) {
  if (factors.length === 0) return null;
  return (
    <ul className="space-y-1.5 border-t border-line pt-4">
      {factors.slice(0, 4).map((factor) => (
        <li key={factor.text} className="flex gap-2 text-2xs leading-5">
          <span
            aria-hidden="true"
            className={factor.direction === 'positive' ? 'text-status-good' : 'text-status-warn'}
          >
            {factor.direction === 'positive' ? '+' : '−'}
          </span>
          <span className="sr-only">
            {factor.direction === 'positive' ? 'Supporting factor:' : 'Risk factor:'}
          </span>
          <span className="text-ink-subtle">{factor.text}</span>
        </li>
      ))}
    </ul>
  );
}

function Footer({ modelVersion }: { modelVersion: string }) {
  return (
    <p className="border-t border-line pt-3 text-2xs leading-4 text-ink-faint">
      Statistical estimate from available data, model {modelVersion}. Sports outcomes are
      uncertain and projections may be incorrect.
    </p>
  );
}

/** `7-2` or `7-2-1`; a draw column only when there has been one. */
function recordText(record: BoutRecord): string {
  return `${record.wins}-${record.losses}${record.draws > 0 ? `-${record.draws}` : ''}`;
}

function lastContestText(record: BoutRecord): string | null {
  if (!record.last_contest) return null;
  const instant = new Date(record.last_contest);
  if (Number.isNaN(instant.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(instant);
}

/**
 * The record behind each rating.
 *
 * This is what a fight projection rests on and the whole of what it rests on,
 * so it is shown in place of the scoreline a team fixture would have here.
 */
export function BoutRecords({ bout }: { bout: BoutProjection }) {
  const noun = bout.sport === 'mma' ? 'fights' : 'matches';
  const sides = [
    { name: bout.home_team, record: bout.records.home },
    { name: bout.away_team, record: bout.records.away },
  ];

  return (
    <div>
      <p className="text-2xs uppercase tracking-wider text-ink-faint">
        Record in the rating window{bout.division ? ` · ${bout.division}` : ''}
      </p>
      <dl className="mt-1.5 grid gap-2 sm:grid-cols-2">
        {sides.map(({ name, record }) => {
          const last = lastContestText(record);
          return (
            <div key={name} className="rounded-xl border border-line bg-surface-1 px-3 py-2">
              <dt className="truncate text-xs font-medium text-ink">{name}</dt>
              <dd className="mt-0.5 text-2xs tabular-nums text-ink-subtle">
                {recordText(record)} across {record.contests} {noun} · rating {record.rating}
                {record.recent_form.length > 0 && ` · ${record.recent_form.join('')}`}
                {last && ` · last ${last}`}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function TeamPanel({ projection }: { projection: GameProjection }) {
  return (
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
      <div className="border-t border-line pt-4">
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

      <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Model line</dt>
          <dd className="mt-1 font-medium tabular-nums text-ink">
            {projection.model_spread > 0 ? '+' : ''}
            {projection.model_spread}
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Confidence</dt>
          <dd className="mt-1 font-medium tabular-nums text-ink">
            {percent(projection.confidence)}
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Data quality</dt>
          <dd className="mt-1 font-medium text-ink">{qualityLabel(projection.data_quality)}</dd>
        </div>
      </dl>

      <Factors factors={projection.factors} />
      <Footer modelVersion={projection.model_version} />
    </div>
  );
}

function BoutPanel({ bout }: { bout: BoutProjection }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Bar label={bout.home_team} value={bout.outcome.home} />
        <Bar label={bout.away_team} value={bout.outcome.away} />
      </div>

      {/* No scoreline: a fight has none to project. The records are what the
          number rests on, so they take the scoreline's place. */}
      <div className="border-t border-line pt-4">
        <BoutRecords bout={bout} />
      </div>

      <dl className="grid grid-cols-3 gap-3 border-t border-line pt-4 text-xs">
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Rating edge</dt>
          <dd className="mt-1 font-medium tabular-nums text-ink">
            {bout.rating_edge > 0 ? '+' : ''}
            {bout.rating_edge}
          </dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Confidence</dt>
          <dd className="mt-1 font-medium tabular-nums text-ink">{percent(bout.confidence)}</dd>
        </div>
        <div>
          <dt className="text-2xs uppercase tracking-wider text-ink-faint">Data quality</dt>
          <dd className="mt-1 font-medium text-ink">{qualityLabel(bout.data_quality)}</dd>
        </div>
      </dl>

      <Factors factors={bout.factors} />
      <Footer modelVersion={bout.model_version} />
    </div>
  );
}

export function ProjectorAnalysis({ gameId }: { gameId: string }) {
  const [state, setState] = useState<State>('loading');
  const [projection, setProjection] = useState<GameProjection | null>(null);
  const [bout, setBout] = useState<BoutProjection | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          `/api/projections/games/${encodeURIComponent(gameId)}`,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        );
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as {
          projection?: GameProjection | null;
          bout?: BoutProjection | null;
        };
        if (controller.signal.aborted) return;

        if (body.projection) {
          setProjection(body.projection);
          setState('ready');
        } else if (body.bout) {
          setBout(body.bout);
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
        <div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-busy="true" />
      )}

      {(state === 'unavailable' || state === 'error') && (
        <div className="rounded-xl border border-violet-400/10 bg-violet-500/[.045] p-4">
          <p className="text-xs font-medium text-ink-muted">Projection unavailable</p>
          <p className="mt-1.5 text-2xs leading-5 text-ink-faint">
            {state === 'error'
              ? 'The projection could not be loaded right now.'
              : 'There is not enough completed history for these sides to support a projection. Nothing is estimated until there is.'}
          </p>
        </div>
      )}

      {state === 'ready' && projection && <TeamPanel projection={projection} />}
      {state === 'ready' && bout && <BoutPanel bout={bout} />}
    </section>
  );
}
