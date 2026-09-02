'use client';

/**
 * The Parlays workspace.
 *
 * Controls at the top, generated line on the left, summary on the right — the
 * page's existing shape, now driven by the projection engine rather than
 * placeholders.
 *
 * Two things are deliberately absent. There is no stake field and no projected
 * monetary return: this application has no bookmaker data, so any return figure
 * would be invented. And nothing is described as safe or guaranteed — "low
 * risk" is a relative analytical category, and the page says so.
 */

import { useCallback, useEffect, useState } from 'react';
import { Info, Layers3, RefreshCw, Shield, Sparkles, Target } from 'lucide-react';
import type { Parlay, RiskLevel, Selection } from '@/lib/projections/types';
import { qualityLabel } from '@/lib/projections/types';
import { MAX_LEGS, MIN_LEGS } from '@/lib/projections/config';

const RISKS: { id: RiskLevel; label: string; note: string }[] = [
  { id: 'low', label: 'Low', note: 'Highest probability, lowest variance' },
  { id: 'medium', label: 'Medium', note: 'Balanced probability and specificity' },
  { id: 'high', label: 'High', note: 'Lower probability, more specific outcomes' },
];

const SPORTS: { id: string; label: string }[] = [
  { id: 'all', label: 'All sports' },
  { id: 'nfl', label: 'American football' },
  { id: 'nba', label: 'Basketball' },
  { id: 'mlb', label: 'Baseball' },
  { id: 'nhl', label: 'Ice hockey' },
  { id: 'football', label: 'Football' },
];

interface ParlayResponse {
  parlay: Parlay | null;
  error?: string;
  eligible?: number;
  games_available?: number;
  model_version?: string;
}

function percent(value: number, places = 0): string {
  return `${(value * 100).toFixed(places)}%`;
}

function kickoff(startTime: string | null): string {
  if (!startTime) return 'Time to be confirmed';
  const instant = new Date(startTime);
  if (Number.isNaN(instant.getTime())) return 'Time to be confirmed';
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

/** One leg: what is projected, how likely, the score behind it, and why. */
function Leg({ selection, index }: { selection: Selection; index: number }) {
  const { projection } = selection;
  const supporting = selection.factors.filter((f) => f.direction === 'positive').slice(0, 3);
  const risks = selection.factors.filter((f) => f.direction === 'negative').slice(0, 2);

  return (
    <article className="panel p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-violet-500/15 text-[10px] font-medium text-violet-300">
          {index + 1}
        </span>
        <span className="font-medium uppercase tracking-wider text-violet-300">
          {selection.league ?? selection.sport.toUpperCase()}
        </span>
        <span className="text-white/20">·</span>
        <span className="truncate text-white/40">{kickoff(selection.start_time)}</span>
      </div>

      <a
        href={`/games/${selection.game_id}`}
        className="mt-2 block truncate text-sm text-white/60 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        {selection.fixture}
      </a>

      <div className="mt-3 flex flex-wrap items-end justify-between gap-3 border-t border-white/7 pt-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-white/28">Selection</p>
          <p className="mt-1 text-base font-semibold text-white/85">{selection.label}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-white/28">
            Estimated probability
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-violet-300">
            {percent(selection.probability)}
          </p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
        <div>
          <dt className="text-white/28">Projected score</dt>
          <dd className="mt-0.5 tabular-nums text-white/60">
            {projection.expected_home_score.toFixed(1)} – {projection.expected_away_score.toFixed(1)}
          </dd>
        </div>
        <div>
          <dt className="text-white/28">Model confidence</dt>
          <dd className="mt-0.5 tabular-nums text-white/60">{percent(selection.confidence)}</dd>
        </div>
        <div>
          <dt className="text-white/28">Data quality</dt>
          <dd className="mt-0.5 text-white/60">{qualityLabel(selection.data_quality)}</dd>
        </div>
      </dl>

      {supporting.length > 0 && (
        <div className="mt-3 border-t border-white/7 pt-3">
          <p className="text-[10px] uppercase tracking-wider text-white/28">Why</p>
          <ul className="mt-1.5 space-y-1">
            {supporting.map((factor) => (
              <li key={factor.text} className="flex gap-2 text-[11px] leading-5 text-white/45">
                <span aria-hidden="true" className="text-emerald-300">
                  +
                </span>
                <span className="sr-only">Supporting factor:</span>
                {factor.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      {risks.length > 0 && (
        <div className="mt-2">
          <p className="text-[10px] uppercase tracking-wider text-white/28">Risk factors</p>
          <ul className="mt-1.5 space-y-1">
            {risks.map((factor) => (
              <li key={factor.text} className="flex gap-2 text-[11px] leading-5 text-white/45">
                <span aria-hidden="true" className="text-amber-300">
                  −
                </span>
                <span className="sr-only">Risk factor:</span>
                {factor.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

export function ParlayView() {
  const [risk, setRisk] = useState<RiskLevel>('low');
  const [sport, setSport] = useState('all');
  const [legs, setLegs] = useState(3);
  const [variant, setVariant] = useState(0);

  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [data, setData] = useState<ParlayResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const query = new URLSearchParams({
          risk,
          sport,
          legs: String(legs),
          variant: String(variant),
        });
        const response = await fetch(`/api/parlays?${query}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as ParlayResponse;
        if (controller.signal.aborted) return;

        setData(body);
        setState(body.parlay ? 'ready' : 'empty');
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }

    void load();
    return () => controller.abort();
  }, [risk, sport, legs, variant]);

  // Regenerate steps the variant only. Probabilities are model output and are
  // never touched — a different combination, not different numbers.
  const regenerate = useCallback(() => setVariant((current) => current + 1), []);

  const parlay = data?.parlay ?? null;

  return (
    <>
      {/* Controls */}
      <section className="mt-6 space-y-4" aria-label="Projection controls">
        <fieldset className="border-0 p-0">
          <legend className="text-[10px] uppercase tracking-wider text-white/28">
            Risk level
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {RISKS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={risk === option.id}
                onClick={() => {
                  setRisk(option.id);
                  setVariant(0);
                }}
                className={`min-h-10 rounded-xl border px-4 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                  risk === option.id
                    ? 'border-violet-500 bg-violet-600 text-white'
                    : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/32">
            {RISKS.find((option) => option.id === risk)?.note}
          </p>
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <label className="text-[10px] uppercase tracking-wider text-white/28">
            Sport
            <select
              value={sport}
              onChange={(event) => {
                setSport(event.target.value);
                setVariant(0);
              }}
              className="mt-1 block min-h-10 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
            >
              {SPORTS.map((option) => (
                <option key={option.id} value={option.id} className="bg-[#0e0c15]">
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[10px] uppercase tracking-wider text-white/28">
            Selections
            <select
              value={legs}
              onChange={(event) => setLegs(Number(event.target.value))}
              className="mt-1 block min-h-10 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
            >
              {Array.from({ length: MAX_LEGS - MIN_LEGS + 1 }, (_, i) => MIN_LEGS + i).map(
                (count) => (
                  <option key={count} value={count} className="bg-[#0e0c15]">
                    {count}
                  </option>
                ),
              )}
            </select>
          </label>

          <button
            type="button"
            onClick={regenerate}
            className="mt-auto inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/9 bg-white/[.02] px-4 text-xs text-white/60 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Regenerate
          </button>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Generated line */}
        <section className="min-w-0 space-y-3" aria-labelledby="line-heading">
          <h2 id="line-heading" className="text-base font-semibold">
            Generated line
          </h2>

          {state === 'loading' && (
            <div className="space-y-3" aria-busy="true">
              {[0, 1, 2].map((row) => (
                <div key={row} className="h-52 animate-pulse rounded-2xl bg-white/[.035]" />
              ))}
            </div>
          )}

          {state === 'error' && (
            <output className="block rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-4 py-5 text-sm text-amber-200/80">
              Projections could not be loaded right now.
            </output>
          )}

          {state === 'empty' && (
            <div className="rounded-xl border border-white/8 bg-white/[.02] px-4 py-6 text-sm text-white/40">
              <p className="font-medium text-white/60">No line available</p>
              <p className="mt-1.5 text-[13px] leading-6">
                {data?.games_available === 0
                  ? 'No upcoming fixtures currently have enough completed match history to project.'
                  : `Only ${data?.eligible ?? 0} selection${data?.eligible === 1 ? '' : 's'} met the ${risk} risk thresholds, across ${data?.games_available ?? 0} eligible game${data?.games_available === 1 ? '' : 's'}. Nothing is padded to fill the requested number.`}
              </p>
            </div>
          )}

          {state === 'ready' &&
            parlay?.legs.map((selection, index) => (
              <Leg key={selection.id} selection={selection} index={index} />
            ))}
        </section>

        {/* Summary */}
        <aside className="min-w-0 xl:sticky xl:top-24 xl:h-fit">
          <section className="panel p-5" aria-labelledby="summary-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="summary-heading" className="text-sm font-semibold">
                Summary
              </h2>
              <Shield className="size-4 text-violet-300" aria-hidden="true" />
            </div>

            <dl className="mt-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">Risk level</dt>
                <dd className="font-medium uppercase text-white/70">{risk}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">Selections</dt>
                <dd className="font-medium tabular-nums text-white/70">
                  {parlay?.legs.length ?? '--'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/7 pt-3">
                <dt className="text-white/38">Estimated combined probability</dt>
                <dd className="text-lg font-semibold tabular-nums text-violet-300">
                  {parlay ? percent(parlay.combined_probability, 1) : '--'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">Average model confidence</dt>
                <dd className="font-medium tabular-nums text-white/70">
                  {parlay ? percent(parlay.average_confidence) : '--'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">Data quality</dt>
                <dd className="font-medium text-white/70">
                  {parlay ? qualityLabel(parlay.average_data_quality) : '--'}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-white/7 pt-3">
                <dt className="text-white/38">Model</dt>
                <dd className="font-medium text-white/70">
                  {parlay?.model_version ?? data?.model_version ?? '--'}
                </dd>
              </div>
            </dl>

            <p className="mt-4 flex gap-2 border-t border-white/7 pt-4 text-[11px] leading-5 text-white/30">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Combined probability multiplies the individual estimates. Selections come from
                different games to keep them close to independent, but sports outcomes are
                uncertain and projections may be incorrect.
              </span>
            </p>
          </section>

          <section className="panel mt-4 p-5" aria-labelledby="how-heading">
            <div className="flex items-center gap-2">
              <Sparkles className="size-4 text-violet-300" aria-hidden="true" />
              <h2 id="how-heading" className="text-sm font-semibold">
                How this works
              </h2>
            </div>
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-white/38">
              <li className="flex gap-2">
                <Target className="mt-0.5 size-3.5 shrink-0 text-white/25" aria-hidden="true" />
                Team ratings are built from completed results — scoring rates adjusted for
                opposition, recent form, rest and an Elo rating.
              </li>
              <li className="flex gap-2">
                <Layers3 className="mt-0.5 size-3.5 shrink-0 text-white/25" aria-hidden="true" />
                Each fixture is simulated thousands of times, and every probability on this
                page is read off the same set of simulations.
              </li>
              <li className="flex gap-2">
                <Shield className="mt-0.5 size-3.5 shrink-0 text-white/25" aria-hidden="true" />
                One selection per game, so the legs stay independent. Fixtures without enough
                history are not projected at all.
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}
