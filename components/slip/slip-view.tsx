'use client';

/**
 * The Slips workspace.
 *
 * Active picks at the top, the line built from them beside, settled picks
 * below. Three roles stay separate throughout, and the page says so: the reader
 * chooses the matches, the model chooses the market on each, and the risk
 * profile decides what qualifies at all.
 *
 * The generated line is the same engine Parlays uses, given a narrowed pool.
 * Nothing here is a bookmaker quote unless the leg card says a bookmaker is
 * offering it, and nothing is padded to reach a leg count.
 */

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import type { Parlay, RiskLevel } from '@/lib/projections/types';
import type { SlipEntry } from '@/lib/slip/types';
import { MIN_LEGS } from '@/lib/projections/config';
import { percent } from '@/lib/utils';
import { sportLabel } from '@/lib/schedule/filters';
import type { SportId } from '@/lib/home/types';
import { LegCard } from '@/components/parlays/leg-card';
import type { LegTracking } from '@/components/parlays/leg-card';
import { ParlayHeader, ParlaySummary } from '@/components/parlays/parlay-summary';
import { useSlip } from './slip-context';

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

interface SlipResponse {
  active?: SlipEntry[];
  settled?: SlipEntry[];
  removed?: { label: string; reason: string }[];
}

interface ParlayResponse {
  parlay: Parlay | null;
  tracking?: Record<string, LegTracking>;
  error?: string;
  eligible?: number;
  games_available?: number;
  chosen?: { requested: number; used: number; unavailable?: string[] } | null;
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`motion-safe:animate-spin motion-reduce:animate-none ${className}`}
    />
  );
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

function PickRow({
  entry,
  onRemove,
  muted = false,
}: {
  entry: SlipEntry;
  onRemove?: (gameId: string) => void;
  muted?: boolean;
}) {
  return (
    <li
      className={`relative rounded-xl border p-3 ${
        muted ? 'border-white/7 bg-white/[.012]' : 'border-white/9 bg-white/[.02]'
      }`}
    >
      <a
        href={`/games/${entry.gameId}`}
        className="block pr-9 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
          <span
            className={`font-medium uppercase tracking-wider ${muted ? 'text-white/30' : 'text-violet-300/80'}`}
          >
            {sportLabel(entry.sport as SportId)}
          </span>
          {entry.league && (
            <>
              <span className="text-white/18">·</span>
              <span className="truncate text-white/38">{entry.league}</span>
            </>
          )}
          <span className="text-white/18">·</span>
          <span className="text-white/32">{kickoff(entry.startTime)}</span>
        </span>
        <span
          className={`mt-1 block truncate text-sm ${muted ? 'text-white/45' : 'text-white/78'}`}
        >
          {entry.label}
        </span>
      </a>

      {onRemove && (
        <button
          type="button"
          onClick={() => onRemove(entry.gameId)}
          aria-label={`Remove ${entry.label} from the slip`}
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-lg text-white/30 transition hover:bg-white/[.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
        >
          <X className="size-4" />
        </button>
      )}
    </li>
  );
}

export function SlipView() {
  const slip = useSlip();
  const [risk, setRisk] = useState<RiskLevel>('medium');
  const [variant, setVariant] = useState(0);

  /*
   * The slip's own sectioning comes from the server, which is the only place
   * that knows each match's current status. The provider holds every entry for
   * the buttons across the app; this holds the split for this page.
   */
  const [sections, setSections] = useState<SlipResponse | null>(null);

  const entryCount = slip?.entries.length ?? 0;

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/slip', {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as SlipResponse;
        if (!controller.signal.aborted) setSections(body);
      } catch {
        if (!controller.signal.aborted) setSections({ active: [], settled: [] });
      }
    }

    void load();
    return () => controller.abort();
  }, [entryCount]);

  const active = sections?.active ?? [];
  const settled = sections?.settled ?? [];
  const enough = active.length >= MIN_LEGS;

  const search = `risk=${risk}&variant=${variant}&games=${active
    .map((entry) => entry.gameId)
    .join(',')}`;

  /*
   * The request is the state: every result carries the query it answers, so
   * "working" is derived during render by comparing against the current one
   * rather than being set inside the fetch.
   */
  const [result, setResult] = useState<{
    search: string;
    body: ParlayResponse | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!enough) return;
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/parlays?${search}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as ParlayResponse;
        if (!controller.signal.aborted) setResult({ search, body, failed: false });
      } catch {
        if (!controller.signal.aborted) setResult({ search, body: null, failed: true });
      }
    }

    void load();
    return () => controller.abort();
  }, [search, enough]);

  const current = result?.search === search ? result : null;
  const working = enough && current === null;
  const parlay = current?.body?.parlay ?? null;
  const chosen = current?.body?.chosen ?? null;
  const available = current?.body?.games_available ?? null;

  const regenerate = useCallback(() => setVariant((value) => value + 1), []);

  if (!slip) return null;

  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
      {/* The picks */}
      <section className="min-w-0 space-y-4" aria-label="Your picks">
        <div className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Active picks
              <span className="ml-2 text-white/35">{active.length}</span>
            </h2>
            {slip.entries.length > 0 && (
              <button
                type="button"
                onClick={() => void slip.clear()}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-white/9 bg-white/[.02] px-2.5 text-xs text-white/50 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                Clear
              </button>
            )}
          </div>

          {slip.notice && (
            <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-500/[.06] px-2.5 py-2 text-[11px] leading-5 text-amber-200/80">
              {slip.notice}
            </p>
          )}

          {/*
            Matches this read dropped, so the slip does not appear to lose
            things between visits.
          */}
          {sections?.removed && sections.removed.length > 0 && (
            <p className="mt-2 text-[11px] leading-5 text-white/38">
              {sections.removed.length}{' '}
              {sections.removed.length === 1 ? 'pick has' : 'picks have'} been cleared:{' '}
              {sections.removed.map((item) => item.label).join(', ')}.
            </p>
          )}

          {active.length === 0 ? (
            <div className="mt-3 rounded-xl border border-white/8 bg-white/[.02] px-3 py-5 text-[13px] leading-6 text-white/45">
              <p className="font-medium text-white/60">No matches picked</p>
              <p className="mt-1.5">
                Add matches with the <span className="text-white/70">+</span> button on Home,
                Schedule, Live or any game page. Pick at least {MIN_LEGS} and the model builds
                the strongest line it can from them.
              </p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              {active.map((entry) => (
                <PickRow key={entry.gameId} entry={entry} onRemove={(id) => void slip.remove(id)} />
              ))}
            </ul>
          )}

          {active.length > 0 && active.length < MIN_LEGS && (
            <p className="mt-3 text-[11px] leading-5 text-amber-200/70">
              A line needs at least {MIN_LEGS} matches. Add one more.
            </p>
          )}
        </div>

        {/* Risk */}
        <div className="panel p-4">
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
            <p className="mt-2 text-[11px] leading-5 text-white/32">
              {RISKS.find((option) => option.id === risk)?.note}
            </p>
          </fieldset>
        </div>

        {/* Settled */}
        {settled.length > 0 && (
          <div className="panel p-4">
            <h2 className="text-sm font-semibold">
              Settled
              <span className="ml-2 text-white/35">{settled.length}</span>
            </h2>
            <p className="mt-1 text-[11px] leading-5 text-white/32">
              Cleared automatically once the day after the match has passed. The predictions
              themselves stay in the accuracy history.
            </p>
            <ul className="mt-3 space-y-2">
              {settled.map((entry) => (
                <PickRow key={entry.gameId} entry={entry} onRemove={(id) => void slip.remove(id)} muted />
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* The line */}
      <section className="min-w-0 space-y-3" aria-labelledby="slip-line-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="slip-line-heading" className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="size-4 text-violet-300" aria-hidden="true" />
            Suggested line
            {working && <Spinner className="size-4 text-violet-300/70" />}
          </h2>

          {parlay && (
            <button
              type="button"
              onClick={regenerate}
              className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-white/9 bg-white/[.02] px-4 text-xs text-white/60 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              Regenerate
            </button>
          )}
        </div>

        <output aria-live="polite" className="flex min-h-4 items-center gap-2 text-[11px]">
          {working && (
            <span className="text-violet-300/80">
              Projecting your {active.length} matches and simulating outcomes…
            </span>
          )}
        </output>

        {!enough ? (
          <div className="rounded-xl border border-white/8 bg-white/[.02] px-4 py-6 text-sm text-white/40">
            <p className="font-medium text-white/60">
              {active.length === 0 ? 'Nothing to build from yet' : 'One more match'}
            </p>
            <p className="mt-1.5 text-[13px] leading-6">
              {active.length === 0
                ? `Pick at least ${MIN_LEGS} matches and the model will build the strongest line it can from exactly those, at ${risk} risk.`
                : `A line needs at least ${MIN_LEGS} matches. Add one more and it will build.`}
            </p>
          </div>
        ) : current?.failed ? (
          <output className="block rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-4 py-5 text-sm text-amber-200/80">
            The line could not be built right now.
          </output>
        ) : (
          <>
            {/*
              A pick that could not be projected at all — kicked off since it
              was added, or never had enough history behind it.
            */}
            {chosen?.unavailable && chosen.unavailable.length > 0 && (
              <p className="rounded-xl border border-amber-400/20 bg-amber-500/[.06] px-3 py-2.5 text-[12px] leading-5 text-amber-200/80">
                {chosen.unavailable.length} of your {chosen.requested} picks could not be
                projected — most likely already under way, or without enough completed history
                behind it. The line uses the {chosen.used} that remain.
              </p>
            )}

            {/*
              A pick the risk level had nothing for. A different fact from the
              one above, and it calls for a different response.
            */}
            {parlay && chosen && available !== null && available < chosen.used && (
              <p className="rounded-xl border border-white/8 bg-white/[.02] px-3 py-2.5 text-[12px] leading-5 text-white/45">
                {chosen.used - available} of your picks{' '}
                {chosen.used - available === 1 ? 'offers' : 'offer'} no market that clears {risk}{' '}
                risk, so {chosen.used - available === 1 ? 'it is' : 'they are'} left out rather
                than filled with something weaker. A lower risk level would include{' '}
                {chosen.used - available === 1 ? 'it' : 'them'}.
              </p>
            )}

            {parlay ? (
              <>
                <ParlayHeader parlay={parlay} />
                {parlay.legs.map((selection, index) => (
                  <LegCard
                    key={selection.id}
                    selection={selection}
                    index={index}
                    tracked={current?.body?.tracking?.[selection.id]}
                  />
                ))}
                <div className="pt-1">
                  <ParlaySummary parlay={parlay} />
                </div>
              </>
            ) : (
              !working && (
                <div className="rounded-xl border border-white/8 bg-white/[.02] px-4 py-6 text-sm text-white/40">
                  <p className="font-medium text-white/60">No line at {risk} risk</p>
                  <p className="mt-1.5 text-[13px] leading-6">
                    {available === 0
                      ? 'None of your picks has a market the model can stand behind at this level.'
                      : `Only ${available ?? 0} of your picks ${
                          available === 1 ? 'clears' : 'clear'
                        } ${risk} risk, and a line needs at least ${MIN_LEGS}.`}{' '}
                    Nothing is padded to make one. Try a lower risk level, or add another match.
                  </p>
                  {typeof current?.body?.eligible === 'number' && current.body.eligible > 0 && (
                    <p className="mt-2 text-[11px] leading-5 text-white/30">
                      {current.body.eligible} model-backed selection
                      {current.body.eligible === 1 ? '' : 's'} across your picks in total.
                    </p>
                  )}
                </div>
              )
            )}

            {parlay && (
              <p className="border-t border-white/7 pt-3 text-[11px] leading-5 text-white/30">
                You chose the matches; the model chose what to back on each, within {risk} risk.
                Estimated hit rate is {percent(parlay.combined_probability, 1)} — an estimate from
                past results, not a promise.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
