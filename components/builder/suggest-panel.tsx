'use client';

/**
 * The model's suggestion for a set of matches.
 *
 * Builder is a workspace over *real bookmaker markets*: a leg is a quoted
 * outcome from a named book, with a price and an expiry. That is deliberate,
 * and this panel does not weaken it. What it adds is the other half of the
 * question — not "what does this book offer" but "what does the model think is
 * worth backing here" — and it answers it exactly the way the Parlays engine
 * does, at a risk level, from matches the reader chooses.
 *
 * The two are kept visibly apart. Nothing here is a bookmaker quote and
 * nothing here enters the line by itself. Each suggestion opens that match's
 * real markets, where the corresponding outcome can be added as a proper leg
 * if a book is genuinely offering it — which is the only way a leg is ever
 * created.
 *
 * Three roles, and they stay separate:
 *
 *   which matches      the reader
 *   what to back       the model
 *   what qualifies     the risk profile
 */

import { useEffect, useState } from 'react';
import { Sparkles, ArrowRight, LoaderCircle } from 'lucide-react';
import type { Parlay, RiskLevel, Selection } from '@/lib/projections/types';
import { MIN_LEGS } from '@/lib/projections/config';
import { percent } from '@/lib/utils';
import { control } from './ui';

const RISKS: { id: RiskLevel; label: string; note: string }[] = [
  {
    id: 'low',
    label: 'Low',
    note: 'The shortest, least specific outcomes the model can stand behind.',
  },
  {
    id: 'medium',
    label: 'Medium',
    note: 'A balance between how likely each leg is and how specific it is.',
  },
  {
    id: 'high',
    label: 'High',
    note: 'More specific outcomes the model rates less likely individually.',
  },
];

interface ParlayResponse {
  parlay: Parlay | null;
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

function SuggestedLeg({
  leg,
  index,
  onOpen,
}: {
  leg: Selection;
  index: number;
  onOpen: (gameId: string) => void;
}) {
  return (
    <li className="rounded-xl border border-white/10 bg-white/[.02] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex items-center gap-2 text-[11px]">
            <span className="grid size-5 shrink-0 place-items-center rounded-md bg-violet-500/15 text-[10px] font-medium text-violet-300">
              {index + 1}
            </span>
            <span className="truncate text-white/45">{leg.fixture}</span>
          </span>
          <p className="mt-2 text-sm font-semibold text-white">{leg.label}</p>
          <p className="mt-0.5 text-[11px] text-white/40">{leg.market.label}</p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold tabular-nums leading-none text-violet-300">
            {percent(leg.probability)}
          </p>
          <p className="mt-1 text-[9px] uppercase tracking-wide text-white/28">Model</p>
        </div>
      </div>

      <p className="mt-2 rounded-lg border border-white/8 bg-white/[.02] px-2.5 py-2 text-[11px] leading-5 text-white/50">
        {leg.explanation}
      </p>

      {/*
        The only route from a suggestion to a leg.

        It opens the match's real markets rather than adding anything: a leg in
        this workspace is a bookmaker's quoted outcome, and a model projection
        is not one. If no book is offering this, there is no leg to add — which
        is a real answer, not a failure.
      */}
      <button
        type="button"
        onClick={() => onOpen(leg.game_id)}
        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[11px] font-medium text-violet-300 transition hover:bg-violet-500/12 focus-visible:outline-2 focus-visible:outline-violet-400"
      >
        Find this market
        <ArrowRight className="size-3" aria-hidden="true" />
      </button>
    </li>
  );
}

export function SuggestPanel({
  picked,
  risk,
  onRisk,
  onOpenMatch,
  onClear,
}: {
  picked: readonly string[];
  risk: RiskLevel;
  onRisk: (next: RiskLevel) => void;
  onOpenMatch: (gameId: string) => void;
  onClear: () => void;
}) {
  const enough = picked.length >= MIN_LEGS;
  const search = `risk=${risk}&games=${picked.join(',')}`;

  /*
   * The request is the state: every result carries the query it answers, so
   * "working" is derived by comparing against the current one rather than set
   * inside the fetch.
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

  return (
    <section className="panel p-4" aria-labelledby="suggest-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="suggest-heading" className="flex items-center gap-2 font-semibold">
            <Sparkles className="size-4 text-violet-300" aria-hidden="true" />
            Model suggestion
          </h2>
          <p className="mt-1 text-xs leading-5 text-white/50">
            Tick the matches above, pick a risk level, and the projection engine builds the
            strongest line it can from exactly those.
          </p>
        </div>

        {picked.length > 0 && (
          <button type="button" onClick={onClear} className={control}>
            Clear {picked.length}
          </button>
        )}
      </div>

      <fieldset className="mt-3 border-0 p-0">
        <legend className="text-[10px] uppercase tracking-wider text-white/40">Risk level</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {RISKS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={risk === option.id}
              onClick={() => onRisk(option.id)}
              className={`min-h-10 rounded-lg border px-3 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-violet-400 ${
                risk === option.id
                  ? 'border-violet-400/50 bg-violet-500/20 text-white'
                  : 'border-white/15 bg-[#15121e] text-white/60 hover:bg-white/5'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] leading-5 text-white/40">
          {RISKS.find((option) => option.id === risk)?.note}
        </p>
      </fieldset>

      <output aria-live="polite" className="mt-3 flex min-h-5 items-center gap-2 text-xs">
        {working && (
          <>
            <Spinner className="size-3.5 text-violet-300" />
            <span className="text-violet-200/80">Projecting the matches you chose…</span>
          </>
        )}
      </output>

      {!enough ? (
        <p className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-sm leading-6 text-white/55">
          {picked.length === 0
            ? `Tick at least ${MIN_LEGS} matches above.`
            : `A line needs at least ${MIN_LEGS} matches. Tick one more.`}
        </p>
      ) : current?.failed ? (
        <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 p-3 text-sm text-amber-100" role="alert">
          The projection could not be loaded.
        </p>
      ) : parlay ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-violet-400/20 bg-violet-500/[.08] p-3">
            <span className="text-xs uppercase tracking-wider text-violet-200/70">
              {parlay.risk} risk · {parlay.legs.length} legs
            </span>
            <span className="ml-auto text-sm font-semibold tabular-nums text-violet-200">
              {percent(parlay.combined_probability, 1)}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-white/35">
              Estimated hit rate
            </span>
          </div>

          {/*
            A match that has gone since it was ticked.

            Almost always because it has kicked off — Builder's list includes
            in-play matches, which the projection engine will not touch. A
            different fact from the one below, and it needs saying too: without
            it the reader picks three, gets two, and is told nothing.
          */}
          {chosen?.unavailable && chosen.unavailable.length > 0 && (
            <p className="mt-2 text-[11px] leading-5 text-white/45">
              {chosen.unavailable.length} of the {chosen.requested} matches you chose{' '}
              {chosen.unavailable.length === 1 ? 'is' : 'are'} not available to project — most
              likely already under way, since a projection is only ever made before kick-off.
            </p>
          )}

          {/*
            A chosen match the risk level had nothing for. Said plainly, with
            the way to include it, rather than leaving a shorter line to be
            noticed and puzzled over.
          */}
          {chosen && available !== null && available < chosen.used && (
            <p className="mt-2 text-[11px] leading-5 text-white/45">
              {chosen.used - available} of the {chosen.used} matches you chose{' '}
              {chosen.used - available === 1 ? 'has' : 'have'} nothing that clears {risk} risk, so{' '}
              {chosen.used - available === 1 ? 'it is' : 'they are'} left out rather than filled
              with something weaker. A lower risk level would include{' '}
              {chosen.used - available === 1 ? 'it' : 'them'}.
            </p>
          )}

          <ul className="mt-3 space-y-2">
            {parlay.legs.map((leg, index) => (
              <SuggestedLeg key={leg.id} leg={leg} index={index} onOpen={onOpenMatch} />
            ))}
          </ul>

          {/*
            The distinction this whole workspace rests on, restated where it
            could otherwise be forgotten.
          */}
          <p className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/40">
            These are model projections, not bookmaker quotes. Nothing here is a leg until you
            open the match and add an outcome a book is actually offering.
          </p>
        </>
      ) : (
        <div className="rounded-xl border border-white/10 bg-white/[.02] p-3 text-sm leading-6 text-white/55">
          <p>
            No line could be built from these matches at {risk} risk. Nothing is padded to make
            one.
          </p>
          {chosen?.unavailable && chosen.unavailable.length > 0 && (
            <p className="mt-1.5 text-[11px] leading-5 text-white/40">
              {chosen.unavailable.length} of them{' '}
              {chosen.unavailable.length === 1 ? 'is' : 'are'} not available to project — most
              likely already under way.
            </p>
          )}
          <p className="mt-1.5 text-[11px] leading-5 text-white/40">
            Try a lower risk level, or choose different matches.
          </p>
        </div>
      )}
    </section>
  );
}
