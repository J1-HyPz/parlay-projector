'use client';

/**
 * The pieces a betting selection is made of.
 *
 * Each one presents exactly one idea, because the old interface presented
 * several at once and left the reader to separate them. A price is not a
 * probability. A model probability is not a market probability. "Available" is
 * not a claim about quality. Giving each its own component with its own label
 * is most of what makes the redesigned card readable.
 *
 * Visual weight follows importance, deliberately and consistently: the
 * selection, then the market, then what has to happen, then the probability,
 * then the price, and only then the model's internals. The previous version
 * gave a model version string the same prominence as the bet.
 *
 * Colour is never the only signal. Every state carries an icon and a word, so
 * verified against unverified, or won against lost, does not depend on
 * distinguishing green from amber.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  CircleAlert,
  CircleHelp,
  Info,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { GLOSSARY } from '@/lib/markets/glossary';
import type { MarketContext } from '@/lib/markets/types';
import type { CorrelationAssessment, EdgeAssessment, RiskLevel } from '@/lib/projections/types';

// Shared with the homepage, which renders the same probabilities. Imported as
// well as re-exported because this file uses them itself.
import { percent, signedPercent } from '@/lib/utils';

export { percent, signedPercent };

/**
 * How long ago a price was read.
 *
 * Shown on every verified market. A quote is only evidence of availability for
 * as long as it is current, and the reader is the one who should judge whether
 * four minutes is recent enough for them.
 */
export function ago(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;

  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

// ---------------------------------------------------------------------------
// Terminology
// ---------------------------------------------------------------------------

/**
 * A term the reader can tap for a definition.
 *
 * Opens on click rather than hover alone, because hover does not exist on a
 * phone and this interface is used on one. Escape closes it, focus is
 * preserved, and the definition is associated with the trigger so a screen
 * reader announces it rather than leaving a bare dotted underline.
 */
export function GlossaryTerm({
  termKey,
  children,
}: {
  termKey: string;
  children: ReactNode;
}) {
  const entry = GLOSSARY[termKey];
  const [open, setOpen] = useState(false);
  const id = useId();
  const container = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  // An unknown key still renders its text, so a missing definition degrades to
  // plain words rather than to nothing.
  if (!entry) return <>{children}</>;

  return (
    <span ref={container} className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((current) => !current)}
        /*
         * `py-1 -my-1` widens the tap target without moving anything: the
         * padding extends the hit area and the negative margin takes the space
         * back out of the layout. A bare 17px-tall control is below the 24px
         * minimum and genuinely hard to hit on a phone.
         */
        className="inline-flex items-center gap-1 border-b border-dotted border-white/30 py-1 -my-1 text-left transition hover:border-violet-300/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        {children}
        <CircleHelp className="size-3 shrink-0 opacity-50" aria-hidden="true" />
      </button>

      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1.5 block w-64 rounded-xl border border-white/12 bg-[#14111d] p-3 text-left shadow-[0_20px_60px_rgba(0,0,0,.5)]"
        >
          <span className="block text-[11px] font-semibold text-white/85">{entry.term}</span>
          <span className="mt-1 block text-[11px] leading-5 font-normal text-white/55">
            {entry.definition}
          </span>
          {entry.example && (
            <span className="mt-1.5 block text-[11px] leading-5 font-normal text-violet-300/70">
              {entry.example}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Market availability
// ---------------------------------------------------------------------------

/**
 * Whether this is a bet that can actually be placed.
 *
 * The single most important addition to the interface. A model-derived line is
 * legitimate analysis and is shown as such — but it is never allowed to look
 * like a market somebody is offering, which is exactly what the previous
 * version did when it recommended a handicap no book had quoted.
 */
export function MarketBadge({ market }: { market: MarketContext }) {
  if (market.availability === 'verified') {
    const when = ago(market.fetchedAt);
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
        <BadgeCheck className="size-3 shrink-0" aria-hidden="true" />
        Available at {market.source}
        {when && <span className="font-normal text-emerald-300/60">· {when}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/25 bg-amber-500/[.08] px-2 py-0.5 text-[10px] font-medium text-amber-200">
      <CircleAlert className="size-3 shrink-0" aria-hidden="true" />
      Model projection — availability not verified
    </span>
  );
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * A quoted price.
 *
 * Decimal is given the weight because it is the notation the arithmetic works
 * in and the one a combined price is built from. The other two sit underneath
 * for readers fluent in them, rather than being hidden behind a setting.
 */
export function OddsDisplay({
  decimal,
  fractional,
  american,
  size = 'normal',
}: {
  decimal: number;
  fractional: string;
  american: number;
  size?: 'normal' | 'large';
}) {
  return (
    <span className="block text-right">
      <span
        className={`block font-semibold tabular-nums text-white/85 ${
          size === 'large' ? 'text-2xl' : 'text-base'
        }`}
      >
        {decimal.toFixed(2)}
      </span>
      <span className="mt-0.5 block text-[10px] tabular-nums text-white/32">
        {fractional} · {american > 0 ? `+${american}` : american}
      </span>
    </span>
  );
}

/** Stands where a price would be, when there is not one. */
export function NoPrice({ note }: { note?: string }) {
  return (
    <span className="block text-right">
      <span className="block text-base font-semibold text-white/25">—</span>
      <span className="mt-0.5 block text-[10px] text-white/28">{note ?? 'No price'}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Model against market
// ---------------------------------------------------------------------------

/**
 * The gap between the model's probability and the price's.
 *
 * Labelled "Model edge" and nothing stronger. A positive number means the two
 * disagree in the model's favour, which is not the same as an advantage — and
 * the tooltip on the term says so rather than leaving the impression that it
 * is.
 */
export function ModelEdge({ edge, model }: { edge: EdgeAssessment; model: number }) {
  // Compared against the de-vigged figure where both sides of the market were
  // readable, because the raw implied number charges the model for the
  // bookmaker's margin before it starts.
  const comparison = edge.fair ?? edge.implied;
  const value = edge.fair_edge ?? edge.edge;
  const Icon = value > 0.02 ? TrendingUp : value < -0.02 ? TrendingDown : Minus;
  const tone =
    value > 0.02 ? 'text-emerald-300' : value < -0.02 ? 'text-rose-300/80' : 'text-white/45';

  return (
    <div className="grid grid-cols-3 gap-2 text-[11px]">
      <div>
        <dt className="text-white/28">Model</dt>
        <dd className="mt-0.5 tabular-nums text-white/70">{percent(model)}</dd>
      </div>
      <div>
        <dt className="text-white/28">
          <GlossaryTerm termKey={edge.fair === null ? 'implied_probability' : 'fair_probability'}>
            {edge.fair === null ? 'Implied' : 'Market'}
          </GlossaryTerm>
        </dt>
        <dd className="mt-0.5 tabular-nums text-white/70">{percent(comparison)}</dd>
      </div>
      <div>
        <dt className="text-white/28">
          <GlossaryTerm termKey="model_edge">Edge</GlossaryTerm>
        </dt>
        <dd className={`mt-0.5 flex items-center gap-1 tabular-nums ${tone}`}>
          <Icon className="size-3 shrink-0" aria-hidden="true" />
          {signedPercent(value)}
        </dd>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality, risk, correlation
// ---------------------------------------------------------------------------

const QUALITY_TONE: Record<string, string> = {
  High: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
  Medium: 'border-amber-400/25 bg-amber-500/[.08] text-amber-200',
  Low: 'border-rose-400/25 bg-rose-500/10 text-rose-300',
  Insufficient: 'border-white/10 bg-white/[.03] text-white/40',
};

/**
 * Data quality, with the reason it is not higher.
 *
 * A bare rating is not actionable — "Medium" says something is missing without
 * saying what, and leaves a reader unable to judge whether the gap matters to
 * them. The reasons are the useful part.
 */
export function DataQualityBadge({
  label,
  reasons = [],
}: {
  label: string;
  reasons?: string[];
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        QUALITY_TONE[label] ?? QUALITY_TONE.Insufficient
      }`}
      title={reasons.length > 0 ? reasons.join(' ') : undefined}
    >
      {label} data
    </span>
  );
}

const RISK_TONE: Record<RiskLevel, string> = {
  low: 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300',
  medium: 'border-amber-400/25 bg-amber-500/[.08] text-amber-200',
  high: 'border-rose-400/25 bg-rose-500/10 text-rose-300',
};

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${RISK_TONE[risk]}`}
    >
      {risk} risk
    </span>
  );
}

const CORRELATION_TONE: Record<string, string> = {
  low: 'border-white/10 bg-white/[.03] text-white/45',
  moderate: 'border-amber-400/25 bg-amber-500/[.08] text-amber-200',
  high: 'border-rose-400/25 bg-rose-500/10 text-rose-300',
};

export function CorrelationBadge({ correlation }: { correlation: CorrelationAssessment }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${
        CORRELATION_TONE[correlation.level] ?? CORRELATION_TONE.low
      }`}
    >
      {correlation.level} correlation
    </span>
  );
}

// ---------------------------------------------------------------------------
// Projected score
// ---------------------------------------------------------------------------

/**
 * The model's scoreline, with the teams named.
 *
 * The old card printed "4.5 – 4.6" with no labels, which is unreadable twice
 * over: there is no telling which number belongs to which side, and a
 * fractional score is not a result any game can finish on. Both are fixed —
 * the sides are named, and a scoreline the game could actually produce is
 * shown alongside the average it came from.
 */
export function ProjectedScore({
  homeTeam,
  awayTeam,
  homeScore,
  awayScore,
  typical,
  homeRange,
  awayRange,
}: {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  typical?: { home: number; away: number } | null;
  homeRange?: [number, number] | null;
  awayRange?: [number, number] | null;
}) {
  const rows = [
    { team: awayTeam, score: awayScore, range: awayRange, typical: typical?.away },
    { team: homeTeam, score: homeScore, range: homeRange, typical: typical?.home },
  ];

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-white/28">Model score</p>
      <dl className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <div key={row.team} className="flex items-baseline justify-between gap-3">
            <dt className="min-w-0 truncate text-[12px] text-white/60">{row.team}</dt>
            <dd className="shrink-0 text-right">
              <span className="text-sm font-semibold tabular-nums text-white/85">
                {row.score.toFixed(1)}
              </span>
              {row.range && (
                <span className="ml-2 text-[10px] tabular-nums text-white/30">
                  usually {row.range[0]}–{row.range[1]}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {typical && (
        <p className="mt-1.5 text-[10px] text-white/28">
          A typical simulated result: {awayTeam.split(' ').slice(-1)[0]} {typical.away} –{' '}
          {typical.home} {homeTeam.split(' ').slice(-1)[0]}. The figures above are averages
          across every simulation, not scorelines.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

interface Factor {
  text: string;
}

/**
 * Why the model likes it, what could go wrong, and what is merely context.
 *
 * Three buckets rather than two. Forcing every fact into for-or-against is
 * what produced the miscategorisation this redesign set out to fix: a note
 * that two sides are evenly matched is real information about a total and is
 * an argument for neither side of it.
 */
export function Reasoning({
  support,
  risks,
  context,
}: {
  support: Factor[];
  risks: Factor[];
  context: Factor[];
}) {
  const blocks: { title: string; tone: string; mark: string; items: Factor[]; sr: string }[] = [
    {
      title: 'Why we like it',
      tone: 'text-emerald-300',
      mark: '✓',
      items: support.slice(0, 3),
      sr: 'Supporting factor:',
    },
    {
      title: 'Risks',
      tone: 'text-amber-300',
      mark: '!',
      items: risks.slice(0, 3),
      sr: 'Risk factor:',
    },
    {
      title: 'Match context',
      tone: 'text-white/30',
      mark: '·',
      items: context.slice(0, 2),
      sr: 'Context:',
    },
  ];

  return (
    <>
      {blocks
        .filter((block) => block.items.length > 0)
        .map((block) => (
          <div key={block.title} className="mt-3">
            <p className="text-[10px] uppercase tracking-wider text-white/28">{block.title}</p>
            <ul className="mt-1.5 space-y-1">
              {block.items.map((factor) => (
                <li
                  key={factor.text}
                  className="flex gap-2 text-[11px] leading-5 text-white/45"
                >
                  <span aria-hidden="true" className={`shrink-0 ${block.tone}`}>
                    {block.mark}
                  </span>
                  <span className="sr-only">{block.sr}</span>
                  {factor.text}
                </li>
              ))}
            </ul>
          </div>
        ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/**
 * A section that starts closed.
 *
 * The card shows the selection, the market, what has to happen, the
 * probability and the price by default; everything else lives behind one of
 * these. On a phone a card that showed all of it would be most of a screen per
 * leg.
 */
export function Expandable({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const toggle = useCallback(() => setOpen((current) => !current), []);

  return (
    <div className="mt-3 border-t border-white/7 pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        // Padded to a comfortable target: this is the primary way to open a
        // leg's analysis on a phone, and it was 17px tall.
        className="flex w-full items-center justify-between gap-2 py-2 text-left text-[11px] text-white/40 transition hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        {label}
        <ChevronDown
          className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

/** A short explanatory note, used for caveats that must not be missed. */
export function Note({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'warning' }) {
  return (
    <p
      className={`flex gap-2 text-[11px] leading-5 ${
        tone === 'warning' ? 'text-amber-200/70' : 'text-white/30'
      }`}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
