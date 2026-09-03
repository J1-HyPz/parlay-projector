'use client';

/**
 * Every market on one fixture, and a builder for combining them.
 *
 * Two things happen on this panel.
 *
 * *Browsing.* The markets the model has an opinion on, grouped the way a
 * betting interface groups them, each showing what the model thinks and
 * whether a bookmaker is actually quoting it. Model picks at the top: the
 * model's own ranking across the fixture, ordered by the same score the
 * optimiser uses rather than by raw probability, so a near-certainty built on
 * six games of history does not head the list.
 *
 * *Building.* Selections can be combined, and the combination is evaluated by
 * the server against the fixture's simulations. That matters: the legs come
 * from one game and are related, so the answer is counted rather than
 * multiplied. Both figures are shown, because seeing the difference is how the
 * idea of correlation becomes concrete rather than a badge.
 *
 * Nothing is placed anywhere. This reports what the model thinks and what the
 * published prices are.
 */

import { useCallback, useEffect, useState } from 'react';
import { Check, LayoutGrid, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { glossaryKeyForMarket } from '@/lib/markets/glossary';
import type { Selection } from '@/lib/projections/types';
import type { CorrelationAssessment, ParlayPrice } from '@/lib/projections/types';
import {
  CorrelationBadge,
  GlossaryTerm,
  MarketBadge,
  Note,
  percent,
  signedPercent,
} from '@/components/parlays/market-ui';

interface MarketGroup {
  market: string;
  label: string;
  selections: Selection[];
}

interface MarketsResponse {
  groups?: MarketGroup[];
  model_picks?: Selection[];
  pricing?: { source: string; fetched_at: string; markets: number } | null;
  reason?: string;
}

interface SlipResponse {
  slip: {
    legs: Selection[];
    dropped: number;
    unknown: string[];
    independent_probability: number;
    combined_probability: number;
    correlation: CorrelationAssessment;
    price: ParlayPrice | null;
    verified_legs: number;
  } | null;
  reason?: string;
}

type State = 'loading' | 'ready' | 'unavailable' | 'error';

function Spinner({ className = '' }: { className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      className={`motion-safe:animate-spin motion-reduce:animate-none ${className}`}
    />
  );
}

/**
 * One market, as a row that can be added to the slip.
 *
 * The whole row is the control, so it is comfortably tappable on a phone. The
 * price and the model's probability sit side by side and are labelled, because
 * they are the two numbers most easily confused for one another.
 */
function MarketRow({
  selection,
  selected,
  onToggle,
}: {
  selection: Selection;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={selected}
      className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50 ${
        selected
          ? 'border-violet-400/40 bg-violet-500/10'
          : 'border-white/8 bg-white/[.02] hover:bg-white/[.045]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`grid size-5 shrink-0 place-items-center rounded-md border ${
          selected
            ? 'border-violet-400/50 bg-violet-500/25 text-violet-200'
            : 'border-white/12 text-white/25'
        }`}
      >
        {selected ? <Check className="size-3" /> : <Plus className="size-3" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-white/85">
          {selection.label}
        </span>
        <span className="mt-0.5 block truncate text-[10px] text-white/32">
          {selection.explanation}
        </span>
      </span>

      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-semibold tabular-nums text-violet-300">
          {percent(selection.probability)}
        </span>
        <span className="block text-[10px] tabular-nums text-white/35">
          {selection.market.price ? selection.market.price.decimal.toFixed(2) : 'no price'}
        </span>
      </span>
    </button>
  );
}

export function MarketExplorer({ gameId }: { gameId: string }) {
  const [state, setState] = useState<State>('loading');
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  /*
   * The slip is stamped with the selection set it answers, so "still working
   * it out" is derived during render by comparing against the current set.
   * Setting a loading flag synchronously inside the effect would cost an extra
   * render pass on every tap, and the compiler rules against it.
   */
  const [slipResult, setSlipResult] = useState<{
    key: string;
    slip: SlipResponse['slip'];
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/markets`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        const body = (await response.json()) as MarketsResponse;
        if (controller.signal.aborted) return;

        // A fixture with too little history, or one already under way, is a
        // real outcome rather than a failure and reads differently.
        if (!response.ok || !body.groups) setState('unavailable');
        else {
          setData(body);
          setState('ready');
        }
      } catch {
        if (!controller.signal.aborted) setState('error');
      }
    }

    void load();
    return () => controller.abort();
  }, [gameId]);

  /*
   * The slip is evaluated on the server, because only the server holds the
   * fixture's simulations — and those are what make a same-game combination
   * measurable rather than a guess. Sending ten thousand simulated games to
   * the browser to multiply numbers badly would be worse in every respect.
   */
  const key = chosen.join('|');

  useEffect(() => {
    if (key === '') return;
    const controller = new AbortController();

    async function evaluate() {
      try {
        const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/markets`, {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ selections: key.split('|') }),
        });
        const body = (await response.json()) as SlipResponse;
        if (!controller.signal.aborted) setSlipResult({ key, slip: body.slip });
      } catch {
        // Leaves the previous assessment on screen rather than blanking it:
        // the chosen legs are still selected and still valid.
        if (!controller.signal.aborted) setSlipResult({ key, slip: null });
      }
    }

    void evaluate();
    return () => controller.abort();
  }, [gameId, key]);

  const slip = slipResult?.key === key ? slipResult.slip : null;
  const evaluating = chosen.length > 0 && slipResult?.key !== key;

  const toggle = useCallback((id: string) => {
    setChosen((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }, []);

  const clear = useCallback(() => setChosen([]), []);

  if (state === 'loading') {
    return (
      <section className="panel p-5" aria-busy="true" aria-label="Loading markets">
        <div className="h-40 rounded-xl bg-white/[.03] motion-safe:animate-pulse motion-reduce:animate-none" />
      </section>
    );
  }

  if (state !== 'ready' || !data?.groups) {
    return (
      <section className="panel p-5">
        <h2 className="text-sm font-semibold">Markets</h2>
        <p className="mt-2 text-[12px] leading-5 text-white/38">
          {state === 'error'
            ? 'Markets could not be loaded right now.'
            : 'No markets for this fixture. Either it is already under way, or there is not enough completed match history behind these sides to project it.'}
        </p>
      </section>
    );
  }

  return (
    <section className="panel p-5" aria-labelledby="markets-heading">
      <div className="flex flex-wrap items-center gap-2">
        <LayoutGrid className="size-4 text-violet-300" aria-hidden="true" />
        <h2 id="markets-heading" className="text-sm font-semibold">
          Markets
        </h2>
        <span className="ml-auto text-[10px] text-white/28">
          {data.pricing
            ? `${data.pricing.markets} priced by ${data.pricing.source}`
            : 'No bookmaker prices published'}
        </span>
      </div>

      {!data.pricing && (
        <p className="mt-2 text-[11px] leading-5 text-amber-200/70">
          Every line below is one the model derived itself. Nothing confirms a bookmaker offers
          them, so treat them as analysis rather than as bets you can place.
        </p>
      )}

      {/* Model picks */}
      {data.model_picks && data.model_picks.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] uppercase tracking-wider text-white/28">Model picks</p>
          <p className="mt-1 text-[10px] leading-4 text-white/28">
            Ranked by probability tempered by confidence, how much history stands behind it, and
            whether the line is one a bookmaker is offering — not by probability alone.
          </p>
          <div className="mt-2 space-y-2">
            {data.model_picks.map((selection) => (
              <MarketRow
                key={selection.id}
                selection={selection}
                selected={chosen.includes(selection.id)}
                onToggle={() => toggle(selection.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Every market, grouped */}
      {data.groups.map((group) => (
        <div key={group.market} className="mt-5">
          <p className="text-[10px] uppercase tracking-wider text-white/28">
            <GlossaryTerm
              termKey={glossaryKeyForMarket(group.market, group.selections[0]?.sport ?? '')}
            >
              {group.label}
            </GlossaryTerm>
          </p>
          <div className="mt-2 space-y-2">
            {group.selections.map((selection) => (
              <MarketRow
                key={selection.id}
                selection={selection}
                selected={chosen.includes(selection.id)}
                onToggle={() => toggle(selection.id)}
              />
            ))}
          </div>
          <div className="mt-2">
            <MarketBadge market={group.selections[0].market} />
          </div>
        </div>
      ))}

      {/* Builder */}
      <div className="mt-6 border-t border-white/7 pt-4">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold">
            <GlossaryTerm termKey="bet_builder">Build your own</GlossaryTerm>
          </h3>
          {evaluating && <Spinner className="size-3.5 text-violet-300/70" />}
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-white/40 transition hover:bg-white/[.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
            >
              <Trash2 className="size-3" aria-hidden="true" />
              Clear
            </button>
          )}
        </div>

        {chosen.length === 0 ? (
          <p className="mt-2 text-[11px] leading-5 text-white/32">
            Choose selections above to see what the model makes of them together.
          </p>
        ) : !slip ? (
          <p className="mt-2 text-[11px] leading-5 text-white/32">Working it out…</p>
        ) : (
          <div className="mt-3">
            <ul className="space-y-1.5">
              {slip.legs.map((leg) => (
                <li key={leg.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[12px] text-white/70">{leg.label}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-violet-300/80">
                    {percent(leg.probability)}
                  </span>
                </li>
              ))}
            </ul>

            {slip.dropped > 0 && (
              <p className="mt-2 text-[11px] text-amber-200/70">
                {slip.dropped} selection{slip.dropped === 1 ? ' was' : 's were'} left out as
                incompatible with one already chosen — two sides of the same market cannot both
                win.
              </p>
            )}

            <dl className="mt-3 space-y-2 border-t border-white/7 pt-3 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">
                  <GlossaryTerm termKey="model_probability">Combined probability</GlossaryTerm>
                </dt>
                <dd className="text-base font-semibold tabular-nums text-violet-300">
                  {percent(slip.combined_probability, 1)}
                </dd>
              </div>

              {slip.legs.length > 1 && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/38">If simply multiplied</dt>
                  <dd className="tabular-nums text-white/45">
                    {percent(slip.independent_probability, 1)}
                  </dd>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">Combined odds</dt>
                <dd className="tabular-nums text-white/70">
                  {slip.price ? slip.price.decimal.toFixed(2) : 'Not priced'}
                </dd>
              </div>

              {slip.price && (
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-white/38">
                    <GlossaryTerm termKey="model_edge">Model edge</GlossaryTerm>
                  </dt>
                  <dd className="tabular-nums text-white/70">{signedPercent(slip.price.edge)}</dd>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <dt className="text-white/38">Correlation</dt>
                <dd>
                  <CorrelationBadge correlation={slip.correlation} />
                </dd>
              </div>
            </dl>

            {slip.legs.length > 1 && (
              <p className="mt-2 text-[11px] leading-5 text-white/32">{slip.correlation.note}</p>
            )}
          </div>
        )}

        <div className="mt-3">
          <Note>
            Selections from one fixture affect each other, so the combined figure is counted
            across the simulations rather than multiplied. Nothing here places a bet.
          </Note>
        </div>
      </div>
    </section>
  );
}
