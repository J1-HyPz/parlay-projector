'use client';

/**
 * The Parlays workspace.
 *
 * Controls at the top, the generated line on the left, the slip and summary on
 * the right. The request is the state: every result is stamped with the query
 * it answers, so "loading" is derived during render by comparing against the
 * current query rather than being set inside the fetch — which is what makes
 * every control feel immediate instead of dead.
 *
 * What changed in the redesign is what the line *says*. Each leg now
 * distinguishes the bet from the prediction, names the market, states in plain
 * words what has to happen, and says whether a bookmaker is actually offering
 * it. The old card printed a label and a percentage and left the rest to be
 * inferred.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Layers3, LoaderCircle, RefreshCw, Shield, Sparkles, Target } from 'lucide-react';
import type { Parlay, RiskLevel } from '@/lib/projections/types';
import { MAX_LEGS, MIN_LEGS } from '@/lib/projections/config';
import { formatDayTab } from '@/lib/schedule/filters';
import { LegCard } from './leg-card';
import type { LegTracking } from './leg-card';
import { BetSlip, ParlayHeader, ParlaySummary } from './parlay-summary';
import { Note } from './market-ui';

const RISKS: { id: RiskLevel; label: string; note: string }[] = [
  {
    id: 'low',
    label: 'Low',
    note: 'The shortest, least specific outcomes the model can stand behind. Fewer legs, higher individual chances.',
  },
  {
    id: 'medium',
    label: 'Medium',
    note: 'A balance between how likely each leg is and how specific an outcome it needs.',
  },
  {
    id: 'high',
    label: 'High',
    note: 'More specific outcomes the model rates less likely individually. Longer odds, and it comes in less often.',
  },
];

const SPORTS: { id: string; label: string }[] = [
  { id: 'all', label: 'All sports' },
  { id: 'nfl', label: 'American football' },
  { id: 'nba', label: 'Basketball' },
  { id: 'mlb', label: 'Baseball' },
  { id: 'nhl', label: 'Ice hockey' },
  { id: 'football', label: 'Football' },
];

const MARKETS: { id: string; label: string }[] = [
  { id: 'any', label: 'Any market' },
  { id: 'available', label: 'Confirmed available only' },
  { id: 'main', label: 'Main lines only' },
];

const TYPES: { id: string; label: string; note: string }[] = [
  {
    id: 'multi',
    label: 'Multi game',
    note: 'One selection per fixture, so the legs do not depend on one another.',
  },
  {
    id: 'same',
    label: 'Same game',
    note: 'Several selections from one fixture, combined by measuring how often they came in together.',
  },
];

/** What one day of the window can support, at the current risk level. */
interface DayAvailability {
  date: string;
  games: number;
  eligible: number;
  buildable: boolean;
}

interface ParlayResponse {
  parlay: Parlay | null;
  tracking?: Record<string, LegTracking>;
  error?: string;
  eligible?: number;
  games_available?: number;
  priced_games?: number;
  model_version?: string;
  date?: string | null;
  dates?: string[];
  days?: DayAvailability[];
}

const ALL_DAYS = 'all';

/** Keeps the selector's shape while the first response is in flight. */
const PLACEHOLDER_DAYS = Array.from({ length: 8 }, (_, index) => `placeholder-${index}`);

/**
 * Spinner used wherever work is in flight.
 *
 * Honours `prefers-reduced-motion`: the icon still marks the spot for anyone
 * who has asked the system not to animate, it simply stops turning.
 */
function Spinner({ className = '' }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`motion-safe:animate-spin motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * Placeholder for one leg.
 *
 * Shaped like a real leg card so the layout does not jump when the real thing
 * arrives, and so it reads as "this is being worked out" rather than as an
 * empty box.
 */
function LoadingLeg({ index }: { index: number }) {
  return (
    <article
      className="panel p-4 motion-safe:animate-pulse motion-reduce:animate-none"
      // Staggered, so the column looks like it is filling in rather than
      // flashing as one block.
      style={{ animationDelay: `${index * 120}ms` }}
    >
      <div className="flex items-center gap-2">
        <span className="size-5 rounded-md bg-white/[.07]" />
        <span className="h-3 w-16 rounded bg-white/[.06]" />
        <span className="h-3 w-24 rounded bg-white/[.04]" />
      </div>

      <span className="mt-3 block h-4 w-48 rounded bg-white/[.05]" />

      <div className="mt-3 flex items-end justify-between gap-3 border-t border-white/7 pt-3">
        <span className="block h-6 w-40 rounded bg-white/[.07]" />
        <span className="block h-7 w-16 rounded bg-violet-500/15" />
      </div>

      <span className="mt-3 block h-4 w-52 rounded-full bg-white/[.04]" />
      <span className="mt-3 block h-10 rounded-xl bg-white/[.03]" />
    </article>
  );
}

/** A labelled control in the toolbar. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="text-[10px] uppercase tracking-wider text-white/28">
      {label}
      {children}
    </label>
  );
}

const SELECT_CLASS =
  'mt-1 block min-h-10 rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50';

export function ParlayView() {
  const [risk, setRisk] = useState<RiskLevel>('low');
  const [sport, setSport] = useState('all');
  const [markets, setMarkets] = useState('any');
  const [type, setType] = useState('multi');
  const [legs, setLegs] = useState(3);
  const [variant, setVariant] = useState(0);
  const [day, setDay] = useState<string>(ALL_DAYS);

  const query = new URLSearchParams({
    risk,
    sport,
    markets,
    type,
    legs: String(legs),
    variant: String(variant),
  });
  if (day !== ALL_DAYS) query.set('date', day);
  const search = query.toString();

  const [result, setResult] = useState<{
    search: string;
    body: ParlayResponse | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/parlays?${search}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as ParlayResponse;
        if (controller.signal.aborted) return;
        setResult({ search, body, failed: false });
      } catch {
        if (!controller.signal.aborted) setResult({ search, body: null, failed: true });
      }
    }

    void load();
    return () => controller.abort();
  }, [search]);

  const current = result?.search === search ? result : null;
  const state: 'loading' | 'ready' | 'empty' | 'error' =
    current === null
      ? 'loading'
      : current.failed
        ? 'error'
        : current.body?.parlay
          ? 'ready'
          : 'empty';

  /*
   * The day tabs keep their previous counts while a new request is in flight.
   * They are a property of the fixtures rather than of the risk level, so
   * blanking them on every click would make the whole row flicker for nothing.
   */
  const data = current?.body ?? result?.body ?? null;

  // Regenerate steps the variant only. Probabilities are model output and are
  // never touched — a different combination, not different numbers.
  const regenerate = useCallback(() => setVariant((value) => value + 1), []);

  /*
   * The line itself is only shown for the request currently on screen, so the
   * summary never quotes a figure from a line that is being replaced.
   */
  const parlay = current?.body?.parlay ?? null;

  const reset = useCallback(() => setVariant(0), []);

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
                  reset();
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
          <p className="mt-2 text-[11px] leading-5 text-white/32">
            {RISKS.find((option) => option.id === risk)?.note}
          </p>
        </fieldset>

        <fieldset className="border-0 p-0">
          <legend className="text-[10px] uppercase tracking-wider text-white/28">
            Parlay type
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {TYPES.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={type === option.id}
                onClick={() => {
                  setType(option.id);
                  reset();
                }}
                className={`min-h-10 rounded-xl border px-4 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                  type === option.id
                    ? 'border-violet-500 bg-violet-600 text-white'
                    : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-5 text-white/32">
            {TYPES.find((option) => option.id === type)?.note}
          </p>
        </fieldset>

        {/*
          Day selector, mirroring Schedule's eight-day window.

          The counts come from the model, not the fixture list: a day showing
          four has four fixtures this risk level would actually accept.
        */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-white/28">Day</p>
          <div className="horizontal-cards mt-2 rounded-2xl border border-white/[.085] bg-white/[.02] p-1.5">
            <button
              type="button"
              aria-pressed={day === ALL_DAYS}
              onClick={() => {
                setDay(ALL_DAYS);
                reset();
              }}
              className={`min-h-[54px] min-w-[84px] shrink-0 rounded-xl px-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                day === ALL_DAYS
                  ? 'border border-violet-400/35 bg-violet-500/15 text-white'
                  : 'text-white/42 hover:bg-white/[.035] hover:text-white'
              }`}
            >
              <span className="block text-xs font-semibold uppercase tracking-wide">All</span>
              <span
                className={`mt-1 block text-[10px] ${day === ALL_DAYS ? 'text-violet-300' : 'text-white/28'}`}
              >
                {data?.days
                  ? `${data.days.reduce((sum, entry) => sum + entry.eligible, 0)} games`
                  : '--'}
              </span>
            </button>

            {(data?.dates ?? PLACEHOLDER_DAYS).map((date, index) => {
              const real = Boolean(data?.dates);
              const availability = data?.days?.find((entry) => entry.date === date);
              const { weekday, label } = real
                ? formatDayTab(date)
                : { weekday: '--', label: '--' };
              const isActive = real && date === day;
              // Fewer than two qualifying fixtures cannot make a line, so the
              // day is shown as information rather than offered as a choice.
              const disabled = !real || !availability?.buildable;

              return (
                <button
                  key={date}
                  type="button"
                  disabled={disabled}
                  aria-pressed={isActive}
                  title={
                    real && !availability?.buildable
                      ? 'Not enough qualifying fixtures on this day'
                      : undefined
                  }
                  onClick={() => {
                    setDay(date);
                    reset();
                  }}
                  className={`min-h-[54px] min-w-[92px] flex-1 rounded-xl px-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                    isActive
                      ? 'border border-violet-400/35 bg-violet-500/15 text-white'
                      : disabled
                        ? 'cursor-not-allowed text-white/18'
                        : 'text-white/42 hover:bg-white/[.035] hover:text-white'
                  }`}
                >
                  <span className="block text-xs font-semibold uppercase tracking-wide">
                    {index === 0 && real ? 'TODAY' : weekday}
                  </span>
                  <span
                    className={`mt-1 block text-[10px] ${isActive ? 'text-violet-300' : 'text-white/28'}`}
                  >
                    {label}
                    {real && availability ? ` · ${availability.eligible}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Field label="Sport">
            <select
              value={sport}
              onChange={(event) => {
                setSport(event.target.value);
                reset();
              }}
              className={SELECT_CLASS}
            >
              {SPORTS.map((option) => (
                <option key={option.id} value={option.id} className="bg-[#0e0c15]">
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Markets">
            <select
              value={markets}
              onChange={(event) => {
                setMarkets(event.target.value);
                reset();
              }}
              className={SELECT_CLASS}
            >
              {MARKETS.map((option) => (
                <option key={option.id} value={option.id} className="bg-[#0e0c15]">
                  {option.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Selections">
            <select
              value={legs}
              onChange={(event) => setLegs(Number(event.target.value))}
              className={SELECT_CLASS}
            >
              {Array.from({ length: MAX_LEGS - MIN_LEGS + 1 }, (_, i) => MIN_LEGS + i).map(
                (count) => (
                  <option key={count} value={count} className="bg-[#0e0c15]">
                    {count}
                  </option>
                ),
              )}
            </select>
          </Field>

          <button
            type="button"
            onClick={regenerate}
            disabled={state === 'loading'}
            className="mt-auto inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/9 bg-white/[.02] px-4 text-xs text-white/60 transition hover:bg-white/[.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-white/[.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
          >
            {state === 'loading' ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            Regenerate
          </button>
        </div>

        {/*
          The work takes a couple of seconds, so it says so. `aria-live` is
          polite and the element is always present, so a screen reader is not
          surprised by a region appearing and vanishing.
        */}
        <output aria-live="polite" className="flex min-h-4 items-center gap-2 text-[11px]">
          {state === 'loading' && (
            <>
              <Spinner className="size-3 text-violet-300" />
              <span className="text-violet-300/80">
                {type === 'same'
                  ? 'Simulating the fixture and measuring how often the legs come in together…'
                  : 'Projecting fixtures, checking bookmaker lines and simulating outcomes…'}
              </span>
            </>
          )}
        </output>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* Generated line */}
        <section className="min-w-0 space-y-3" aria-labelledby="line-heading">
          <h2 id="line-heading" className="flex items-center gap-2 text-base font-semibold">
            Generated line
            {state === 'loading' && <Spinner className="size-4 text-violet-300/70" />}
          </h2>

          {state === 'loading' && (
            <div className="space-y-3" aria-busy="true" aria-label="Projecting fixtures">
              <div className="panel h-36 motion-safe:animate-pulse motion-reduce:animate-none" />
              {Array.from({ length: legs }, (_, row) => (
                <LoadingLeg key={row} index={row} />
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
                  ? day === ALL_DAYS
                    ? 'No upcoming fixture currently has enough completed match history to project.'
                    : 'No fixture on this day has enough completed match history to project.'
                  : `Only ${data?.eligible ?? 0} selection${data?.eligible === 1 ? '' : 's'} met the ${risk} risk thresholds${day === ALL_DAYS ? '' : ' on this day'}, across ${data?.games_available ?? 0} eligible ${data?.games_available === 1 ? 'game' : 'games'}. Nothing is padded to fill the requested number.`}
              </p>
              {markets === 'available' && (
                <p className="mt-2 text-[13px] leading-6 text-amber-200/70">
                  You have asked for confirmed markets only. Bookmaker prices are not published
                  for every competition — try &ldquo;Any market&rdquo; to include the model&rsquo;s
                  own lines, which are labelled as unverified.
                </p>
              )}
              {type === 'same' && (
                <p className="mt-2 text-[13px] leading-6 text-white/32">
                  A same-game line needs several selections from one fixture to clear the risk
                  thresholds together. Lower the risk level or ask for fewer selections.
                </p>
              )}
            </div>
          )}

          {state === 'ready' && parlay && (
            <>
              <ParlayHeader parlay={parlay} />
              <BetSlip parlay={parlay} />
              {parlay.legs.map((selection, index) => (
                <LegCard
                  key={selection.id}
                  selection={selection}
                  index={index}
                  tracked={data?.tracking?.[selection.id]}
                />
              ))}
            </>
          )}
        </section>

        {/* Summary */}
        <aside className="min-w-0 space-y-4 xl:sticky xl:top-24 xl:h-fit">
          {state === 'ready' && parlay ? (
            <ParlaySummary parlay={parlay} />
          ) : (
            <section className="panel p-5" aria-label="Parlay summary">
              <h2 className="text-sm font-semibold">Parlay summary</h2>
              <p className="mt-3 text-[11px] leading-5 text-white/32">
                {state === 'loading'
                  ? 'Working out the line.'
                  : 'Choose a risk level and a day to generate a line.'}
              </p>
            </section>
          )}

          <section className="panel p-5" aria-labelledby="how-heading">
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
                Each fixture is simulated thousands of times, and every probability on this page
                is read off the same set of simulations.
              </li>
              <li className="flex gap-2">
                <Shield className="mt-0.5 size-3.5 shrink-0 text-white/25" aria-hidden="true" />
                Where a bookmaker&rsquo;s lines are published, the model is run against those
                exact lines. Where they are not, its own lines are shown and marked unverified.
              </li>
            </ul>

            {typeof data?.priced_games === 'number' && (
              <p className="mt-3 border-t border-white/7 pt-3 text-[10px] leading-4 text-white/28">
                {data.priced_games === 0
                  ? 'No bookmaker prices were published for any fixture in this window, so every line here is a model projection.'
                  : `Bookmaker prices were published for ${data.priced_games} fixture${data.priced_games === 1 ? '' : 's'} in this window.`}
              </p>
            )}
          </section>

          <div className="px-1">
            <Note>
              Player markets are not offered. This application has no player statistics, no
              lineups and no injury data, and no prices for them — so there is nothing to model
              and nothing to check against.
            </Note>
          </div>
        </aside>
      </div>
    </>
  );
}
