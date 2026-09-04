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
 *
 * The sport and competition selectors come from the league catalogue over
 * `/api/leagues`, not from a list held here. The list held here had been wrong
 * for months — six sports, no tennis, no Formula 1 — because nothing connected
 * it to the registry. Now adding a competition to the registry is the whole
 * change; this file learns about it on its own.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Layers3, LoaderCircle, RefreshCw, Shield, Sparkles, Target } from 'lucide-react';
import type { Parlay, RiskLevel } from '@/lib/projections/types';
import type { SportOption } from '@/lib/leagues/catalogue';
import { ALL_COMPETITIONS, ALL_SPORTS } from '@/lib/leagues/catalogue';
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

/** The filter a response was built under, echoed back for the heading. */
interface ScopeBlock {
  sport: string;
  league: string | null;
  sport_label: string;
  league_label: string;
}

interface ParlayResponse {
  parlay: Parlay | null;
  tracking?: Record<string, LegTracking>;
  error?: string;
  eligible?: number;
  games_available?: number;
  /** Legs this filter can actually support, so impossible counts are greyed out. */
  max_legs?: number;
  scope?: ScopeBlock;
  priced_games?: number;
  model_version?: string;
  date?: string | null;
  dates?: string[];
  days?: DayAvailability[];
}

/** The sports and competitions the engine can build from. */
interface CatalogueResponse {
  sports?: SportOption[];
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
  'mt-1 block min-h-10 w-full rounded-xl border border-white/9 bg-white/[.02] px-3 text-xs text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50';

/**
 * Which competition a sport should start on.
 *
 * A sport with one tracked competition selects it outright — offering "all"
 * and a single identical choice beneath it is a decision that isn't one. A
 * sport with several starts on all of them.
 */
function defaultCompetition(option: SportOption | undefined): string {
  if (!option || option.competitions.length !== 1) return ALL_COMPETITIONS;
  return option.competitions[0].id;
}

/**
 * Competition options for one sport, grouped where the catalogue knows a
 * region.
 *
 * Only football carries regions, and only football has enough competitions for
 * a flat list to be hard to read. Everything else renders ungrouped rather
 * than having headings invented for it.
 */
function groupCompetitions(option: SportOption): { label: string | null; items: SportOption['competitions'] }[] {
  const groups: { label: string | null; items: SportOption['competitions'] }[] = [];

  for (const competition of option.competitions) {
    const label = competition.group;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(competition);
    else groups.push({ label, items: [competition] });
  }

  return groups;
}

export function ParlayView() {
  const [risk, setRisk] = useState<RiskLevel>('low');
  const [sport, setSport] = useState<string>(ALL_SPORTS);
  const [league, setLeague] = useState<string>(ALL_COMPETITIONS);
  const [markets, setMarkets] = useState('any');
  const [type, setType] = useState('multi');
  const [legs, setLegs] = useState(3);
  const [variant, setVariant] = useState(0);
  const [day, setDay] = useState<string>(ALL_DAYS);

  /*
   * The catalogue, loaded once.
   *
   * Static registry data, so it is fetched a single time and kept — it cannot
   * change while the page is open, and re-reading it on every control change
   * would be a request for nothing.
   */
  const [catalogue, setCatalogue] = useState<SportOption[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/leagues', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as CatalogueResponse;
        if (!controller.signal.aborted) setCatalogue(body.sports ?? []);
      } catch {
        // The selector falls back to "All sports", which still generates a
        // line. A catalogue outage narrows the choices; it does not break the
        // page.
        if (!controller.signal.aborted) setCatalogue([]);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const sportOption = useMemo(
    () => catalogue?.find((entry) => entry.id === sport),
    [catalogue, sport],
  );

  const query = new URLSearchParams({
    risk,
    sport,
    league,
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

  /*
   * Changing sport clears the competition.
   *
   * Leaving "Premier League" selected under Basketball would be a filter that
   * describes nothing, and the request behind it is a 400. The new sport
   * starts on everything it tracks, or on its single competition where it has
   * only one.
   */
  const chooseSport = useCallback(
    (next: string) => {
      setSport(next);
      setLeague(defaultCompetition(catalogue?.find((entry) => entry.id === next)));
      reset();
    },
    [catalogue, reset],
  );

  /*
   * How many legs the current filter can support.
   *
   * A multi-game line takes one selection per fixture, so a filter with three
   * qualifying fixtures cannot make four legs however it is asked. The counts
   * above that are shown greyed with the reason rather than accepted and
   * quietly under-delivered.
   *
   * Held from the last response for the current request only; while a new one
   * is in flight the previous ceiling still applies, which stops the row
   * flickering between every keystroke of a filter change.
   */
  const maxLegs = data?.max_legs ?? MAX_LEGS;
  const eligibleGames = data?.games_available ?? null;

  /*
   * Which count to show as chosen.
   *
   * A request for five that only three fixtures can support produces three
   * legs, so three is what the row highlights. The request itself is left at
   * five: widen the competition again and the five-leg line comes back without
   * having to ask for it a second time.
   */
  const shownLegs = Math.min(legs, maxLegs);

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

        {/*
          Sport, then competition.

          Two controls rather than one list of every competition in the
          application: the second only ever offers what belongs to the first,
          so picking Basketball cannot leave the Premier League on screen. On a
          phone they stack; there is no two-column dropdown.
        */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Sport">
            <select
              value={sport}
              onChange={(event) => chooseSport(event.target.value)}
              className={SELECT_CLASS}
            >
              <option value={ALL_SPORTS} className="bg-[#0e0c15]">
                All sports
              </option>
              {(catalogue ?? []).map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  // A sport with no model is shown and disabled rather than
                  // removed: someone who knows the application tracks it
                  // should be told what is missing, not left guessing.
                  disabled={!option.supported}
                  className="bg-[#0e0c15]"
                >
                  {option.label}
                  {option.supported ? '' : ' — projections unavailable'}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Competition">
            <select
              value={league}
              onChange={(event) => {
                setLeague(event.target.value);
                reset();
              }}
              // Across every sport at once, a single list of all twenty-one
              // competitions would be a worse control than no control.
              disabled={sport === ALL_SPORTS || !sportOption}
              className={`${SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {sport === ALL_SPORTS || !sportOption ? (
                <option value={ALL_COMPETITIONS} className="bg-[#0e0c15]">
                  All competitions
                </option>
              ) : (
                <>
                  {sportOption.all_label && (
                    <option value={ALL_COMPETITIONS} className="bg-[#0e0c15]">
                      {sportOption.all_label}
                    </option>
                  )}
                  {groupCompetitions(sportOption).map((group) =>
                    group.label === null ? (
                      group.items.map((competition) => (
                        <option
                          key={competition.id}
                          value={competition.id}
                          className="bg-[#0e0c15]"
                        >
                          {competition.label}
                        </option>
                      ))
                    ) : (
                      <optgroup key={group.label} label={group.label} className="bg-[#0e0c15]">
                        {group.items.map((competition) => (
                          <option
                            key={competition.id}
                            value={competition.id}
                            className="bg-[#0e0c15]"
                          >
                            {competition.label}
                          </option>
                        ))}
                      </optgroup>
                    ),
                  )}
                </>
              )}
            </select>
          </Field>
        </div>

        {/*
          Sports the engine cannot build from.

          Named rather than removed. A reader who knows the application tracks
          tennis should be told what is missing, not left to conclude the page
          has quietly lost it — and the option above is disabled, so nobody can
          choose one and then be failed by it.
        */}
        {(catalogue ?? []).some((option) => !option.supported) && (
          <p className="text-[11px] leading-5 text-white/32">
            {(catalogue ?? [])
              .filter((option) => !option.supported)
              .map((option) => `${option.label}: ${option.unavailable}`)
              .join(' ')}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
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
          Selections.

          Buttons rather than a dropdown, because a count that cannot be
          produced needs to say so before it is chosen. One leg per fixture is
          the rule for a multi-game line, so three qualifying fixtures means
          four legs is not a shorter line — it is not a line at all.
        */}
        <fieldset className="border-0 p-0">
          <legend className="text-[10px] uppercase tracking-wider text-white/28">
            Selections
          </legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {Array.from({ length: MAX_LEGS - MIN_LEGS + 1 }, (_, i) => MIN_LEGS + i).map(
              (count) => {
                const unreachable = count > maxLegs;
                return (
                  <button
                    key={count}
                    type="button"
                    aria-pressed={shownLegs === count}
                    disabled={unreachable}
                    title={
                      unreachable
                        ? `Only ${maxLegs} eligible ${maxLegs === 1 ? 'event' : 'events'} for this selection.`
                        : undefined
                    }
                    onClick={() => {
                      setLegs(count);
                      reset();
                    }}
                    className={`min-h-10 min-w-11 rounded-xl border px-4 text-xs font-medium tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
                      unreachable
                        ? 'cursor-not-allowed border-white/6 bg-white/[.01] text-white/18'
                        : shownLegs === count
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'border-white/9 bg-white/[.02] text-white/48 hover:bg-white/[.05] hover:text-white'
                    }`}
                  >
                    {count}
                  </button>
                );
              },
            )}
          </div>

          {/*
            What the filter currently supports.

            A count of fixtures the risk profile would actually accept, not of
            fixtures on the card — the two differ, and the useful one is this.
          */}
          {eligibleGames !== null && (
            <p className="mt-2 text-[11px] leading-5 text-white/32">
              {eligibleGames === 0
                ? 'No eligible events for this selection.'
                : `${eligibleGames} eligible ${eligibleGames === 1 ? 'event' : 'events'}${
                    typeof data?.eligible === 'number'
                      ? `, ${data.eligible} model-backed selection${data.eligible === 1 ? '' : 's'}`
                      : ''
                  }.`}
              {legs > maxLegs &&
                ` A ${legs}-leg line is not possible here, so this one has ${maxLegs}. Nothing is padded to fill the difference.`}
            </p>
          )}
        </fieldset>

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
                  : `Projecting ${
                      sport === ALL_SPORTS
                        ? 'upcoming events'
                        : `${(sportOption?.label ?? sport).toLowerCase()} events`
                    }, checking bookmaker lines and simulating outcomes…`}
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
              <p className="font-medium text-white/60">
                No line available
                {current?.body?.scope && current.body.scope.sport !== ALL_SPORTS
                  ? ` for ${current.body.scope.league_label}`
                  : ''}
              </p>
              <p className="mt-1.5 text-[13px] leading-6">
                {data?.games_available === 0
                  ? day === ALL_DAYS
                    ? 'No upcoming event in this selection has enough completed history to project.'
                    : 'No event on this day in this selection has enough completed history to project.'
                  : `Only ${data?.eligible ?? 0} selection${data?.eligible === 1 ? '' : 's'} met the ${risk} risk thresholds${day === ALL_DAYS ? '' : ' on this day'}, across ${data?.games_available ?? 0} eligible ${data?.games_available === 1 ? 'event' : 'events'}. Nothing is padded to fill the requested number.`}
              </p>

              {/*
                What to widen, in the order that costs the reader least.

                Never done for them: a filter is a choice, and silently
                reaching into another competition to fill a line would answer a
                question nobody asked.
              */}
              {current?.body?.scope && current.body.scope.sport !== ALL_SPORTS && (
                <p className="mt-2 text-[13px] leading-6 text-white/32">
                  Try{' '}
                  {current.body.scope.league !== null
                    ? 'every competition in this sport, a lower risk level, or fewer selections.'
                    : 'another sport, a lower risk level, or fewer selections.'}{' '}
                  This selection is used exactly as chosen — no leg is taken from outside it.
                </p>
              )}
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
              <ParlayHeader parlay={parlay} scope={current?.body?.scope} />
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
