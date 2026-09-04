'use client';

/**
 * The header, the slip and the summary panel.
 *
 * The header answers "what is this line and how good does the model think it
 * is" in one glance. The slip answers "what am I actually backing" in one
 * glance. The summary is where the fuller accounting goes.
 *
 * Two rules govern every figure here.
 *
 * A probability is always named. "Estimated hit rate" and "implied
 * probability" are different quantities from different sources and are never
 * printed under one word.
 *
 * A price figure appears only when every leg carries a real quote. A combined
 * price is the product of its legs, and a product with a guess in it is a
 * guess — so where a leg is unpriced the whole row says so rather than showing
 * a number that looks authoritative.
 */

import { ChevronDown } from 'lucide-react';
import { useId, useState } from 'react';
import { returnsOn } from '@/lib/markets/price';
import type { Parlay } from '@/lib/projections/types';
import { qualityLabel } from '@/lib/projections/types';
import {
  CorrelationBadge,
  DataQualityBadge,
  GlossaryTerm,
  Note,
  RiskBadge,
  percent,
  signedPercent,
} from './market-ui';

/** The example stake used to make a price legible. Never a suggestion. */
const EXAMPLE_STAKE = 10;

function Figure({
  label,
  value,
  tone = 'normal',
  term,
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'accent' | 'muted';
  term?: string;
}) {
  return (
    <div>
      <p
        className={`text-xl font-semibold tabular-nums leading-none ${
          tone === 'accent'
            ? 'text-violet-300'
            : tone === 'muted'
              ? 'text-white/30'
              : 'text-white/85'
        }`}
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] leading-4 text-white/32">
        {term ? <GlossaryTerm termKey={term}>{label}</GlossaryTerm> : label}
      </p>
    </div>
  );
}

/**
 * The top of the card.
 *
 * Risk, size, and the three numbers that matter, followed by the reason it was
 * classified where it was. The rationale is generated from the legs after they
 * are chosen — the category is a consequence of the selections, never an input
 * that reaches back and changes them.
 */
/** The sport and competition a line was built under. */
export interface HeaderScope {
  sport_label: string;
  league_label: string;
}

export function ParlayHeader({ parlay, scope }: { parlay: Parlay; scope?: HeaderScope }) {
  return (
    <section className="panel p-5" aria-label="Line summary">
      <div className="flex flex-wrap items-center gap-2">
        <RiskBadge risk={parlay.risk} />
        <span className="rounded-full border border-white/10 bg-white/[.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/50">
          {parlay.legs.length} leg {parlay.kind === 'same_game' ? 'same game' : 'parlay'}
        </span>
        <CorrelationBadge correlation={parlay.correlation} />
        <span className="ml-auto text-[10px] text-white/28">
          {parlay.verified_legs} of {parlay.legs.length} available
        </span>
      </div>

      {/*
        What this was built from.

        Stated on the line itself rather than only in the controls above it, so
        a line read on its own — or scrolled back to — still says which sport
        and competition produced it.
      */}
      {scope && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/45">
          <span className="font-medium text-white/60">{scope.sport_label}</span>
          {scope.league_label !== scope.sport_label && (
            <>
              <span className="text-white/20">·</span>
              <span>{scope.league_label}</span>
            </>
          )}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Figure
          label="Estimated hit rate"
          value={percent(parlay.combined_probability, 1)}
          tone="accent"
          term="model_probability"
        />
        <Figure
          label="Model confidence"
          value={percent(parlay.average_confidence)}
          term="model_confidence"
        />
        {parlay.price ? (
          <>
            <Figure
              label="Combined odds"
              value={parlay.price.decimal.toFixed(2)}
              term="decimal_odds"
            />
            <Figure
              label="Model edge"
              value={signedPercent(parlay.price.edge)}
              tone={parlay.price.edge > 0 ? 'accent' : 'normal'}
              term="model_edge"
            />
          </>
        ) : (
          <div className="col-span-2">
            <p className="text-sm font-medium text-white/40">Not priced</p>
            <p className="mt-1 text-[10px] leading-4 text-white/28">
              At least one leg is a model projection with no bookmaker quote, so there is no
              combined price to give.
            </p>
          </div>
        )}
      </div>

      <p className="mt-4 border-t border-white/7 pt-3 text-[11px] leading-5 text-white/45">
        {parlay.risk_rationale}
      </p>

      {parlay.kind === 'same_game' && (
        <p className="mt-2 text-[11px] leading-5 text-amber-200/70">{parlay.correlation.note}</p>
      )}
    </section>
  );
}

/**
 * The slip: every selection, nothing else.
 *
 * Modelled on the clarity of a real betting slip rather than its appearance.
 * The value of one is that it shows exactly what is being backed with nothing
 * competing for attention, which is a useful thing to be able to get back to
 * after reading three screens of analysis.
 */
export function BetSlip({ parlay }: { parlay: Parlay }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <section className="panel overflow-hidden" aria-label="Slip">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition hover:bg-white/[.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white/85">
            {parlay.legs.length} leg slip
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-white/38">
            {parlay.legs.map((leg) => leg.label).join(' · ')}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-white/35 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <div id={id} hidden={!open} className="border-t border-white/7 px-4 pb-4 pt-3">
        <ul className="space-y-2.5">
          {parlay.legs.map((leg) => (
            <li key={leg.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className={
                      leg.market.availability === 'verified'
                        ? 'text-emerald-300'
                        : 'text-amber-300'
                    }
                  >
                    {leg.market.availability === 'verified' ? '✓' : '!'}
                  </span>
                  <span className="truncate text-[13px] font-medium text-white/80">
                    {leg.label}
                  </span>
                </span>
                <span className="mt-0.5 block pl-5 text-[10px] text-white/32">
                  {leg.market.label} · {leg.fixture}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[12px] font-medium tabular-nums text-white/70">
                  {leg.market.price ? leg.market.price.decimal.toFixed(2) : '—'}
                </span>
                <span className="block text-[10px] tabular-nums text-violet-300/70">
                  {percent(leg.probability)}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1.5 border-t border-white/7 pt-3 text-[11px]">
          <div className="flex justify-between gap-3">
            <dt className="text-white/38">Combined odds</dt>
            <dd className="tabular-nums text-white/70">
              {parlay.price ? parlay.price.decimal.toFixed(2) : 'Not priced'}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-white/38">Estimated model probability</dt>
            <dd className="tabular-nums text-violet-300">
              {percent(parlay.combined_probability, 1)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-white/38">Model confidence</dt>
            <dd className="tabular-nums text-white/70">{percent(parlay.average_confidence)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/**
 * The full accounting.
 *
 * Where the model and the market are set beside one another, and where the
 * arithmetic on a quoted price lives. The returns figure is only ever shown
 * when every leg is genuinely quoted, and it is described as what the odds
 * mean rather than as an outcome.
 */
export function ParlaySummary({ parlay }: { parlay: Parlay }) {
  const rows: { label: string; value: string; term?: string; accent?: boolean }[] = [
    { label: 'Legs', value: String(parlay.legs.length) },
    {
      label: 'Model probability',
      value: percent(parlay.combined_probability, 1),
      term: 'model_probability',
      accent: true,
    },
  ];

  if (parlay.kind === 'same_game') {
    rows.push({
      label: 'If treated as independent',
      value: percent(parlay.independent_probability, 1),
      term: 'correlation',
    });
  }

  if (parlay.price) {
    rows.push(
      { label: 'Combined odds', value: parlay.price.decimal.toFixed(2), term: 'decimal_odds' },
      { label: 'Fractional', value: parlay.price.fractional, term: 'fractional_odds' },
      {
        label: 'Implied by the price',
        value: percent(parlay.price.implied, 1),
        term: 'implied_probability',
      },
      { label: 'Model edge', value: signedPercent(parlay.price.edge), term: 'model_edge' },
    );
  }

  return (
    <section className="panel p-5" aria-labelledby="summary-heading">
      <h2 id="summary-heading" className="text-sm font-semibold">
        Parlay summary
      </h2>

      <dl className="mt-4 space-y-3 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-white/38">
              {row.term ? <GlossaryTerm termKey={row.term}>{row.label}</GlossaryTerm> : row.label}
            </dt>
            <dd
              className={`font-medium tabular-nums ${
                row.accent ? 'text-lg text-violet-300' : 'text-white/70'
              }`}
            >
              {row.value}
            </dd>
          </div>
        ))}

        <div className="flex items-center justify-between gap-3 border-t border-white/7 pt-3">
          <dt className="text-white/38">Correlation</dt>
          <dd>
            <CorrelationBadge correlation={parlay.correlation} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/38">Data quality</dt>
          <dd>
            <DataQualityBadge label={qualityLabel(parlay.average_data_quality)} />
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/38">Markets confirmed</dt>
          <dd className="font-medium tabular-nums text-white/70">
            {parlay.verified_legs} / {parlay.legs.length}
          </dd>
        </div>
      </dl>

      {parlay.price && (
        <div className="mt-4 rounded-xl border border-white/8 bg-white/[.02] p-3">
          <p className="text-[10px] uppercase tracking-wider text-white/28">
            What the price means
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-white/85">
            £{returnsOn(EXAMPLE_STAKE, parlay.price.decimal).toFixed(2)} returned on £
            {EXAMPLE_STAKE}
          </p>
          <p className="mt-1 text-[10px] leading-4 text-white/28">
            Stake included, at {parlay.price.sources.join(' and ')}&rsquo;s quoted odds. An
            illustration of the price, not a suggestion — every leg has to come in.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-2 border-t border-white/7 pt-4">
        <Note>
          {parlay.kind === 'same_game'
            ? 'These legs come from one fixture, so the combined figure is measured across the simulations rather than multiplied — multiplying related selections would misstate it.'
            : 'Each leg comes from a different fixture, so the combined figure multiplies the individual estimates.'}
        </Note>
        <Note tone="warning">
          Probabilities are estimates from past results. Sports outcomes are uncertain and the
          model can be wrong — a model edge means it disagrees with the price, not that it is
          right.
        </Note>
      </div>
    </section>
  );
}
