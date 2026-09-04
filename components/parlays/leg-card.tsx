'use client';

/**
 * One leg of a line.
 *
 * The order of the card is the order of the questions a reader actually asks:
 *
 *   What am I backing?        the selection, in the largest type on the card
 *   What kind of bet is it?   the market, named and defined
 *   Can I actually back it?   verified against a bookmaker, or not
 *   How likely is it?         the probability, labelled with what it measures
 *   What does it pay?         the price, when there is one
 *   What has to happen?       in plain words, always
 *
 * Everything past that — the model's scoreline, its disagreement with the
 * price, the evidence, its confidence — is real analysis and belongs on the
 * card, but it is not what someone reads first. It sits behind one tap, which
 * also keeps a five-leg line to a screen or two on a phone rather than five.
 */

import { probabilityMeaning } from '@/lib/markets/explain';
import { glossaryKeyForMarket } from '@/lib/markets/glossary';
import type { Selection } from '@/lib/projections/types';
import { qualityLabel } from '@/lib/projections/types';
import {
  DataQualityBadge,
  Expandable,
  GlossaryTerm,
  MarketBadge,
  ModelEdge,
  NoPrice,
  OddsDisplay,
  ProjectedScore,
  Reasoning,
  percent,
} from './market-ui';
import { LegStatusBadge } from './leg-status';
import type { LegStatus } from './leg-status';

export interface LegTracking {
  status: LegStatus;
  result: string | null;
  /**
   * What actually happened.
   *
   * A fixture ends on a score; a race ends in a classified position. Both
   * shapes travel here, and the card shows whichever it was given.
   */
  actual: {
    home_score: number;
    away_score: number;
    position?: number | null;
  } | null;
  final_pre_game: boolean;
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

/**
 * What happened to a settled leg.
 *
 * Shows the condition it was judged against beside the result, so a reader can
 * check the verdict rather than take it. The condition is the same string the
 * card showed before kick-off, and the same rule settlement used — there is
 * one source for it.
 */
function Outcome({
  selection,
  tracked,
}: {
  selection: Selection;
  tracked: LegTracking;
}) {
  if (tracked.status === 'pending') return null;

  const settled =
    tracked.status === 'won' ||
    tracked.status === 'lost' ||
    tracked.status === 'push' ||
    tracked.status === 'void';

  const verdict =
    tracked.status === 'won'
      ? { text: 'Selection hit', tone: 'text-emerald-300', mark: '✓' }
      : tracked.status === 'lost'
        ? { text: 'Selection missed', tone: 'text-white/40', mark: '✗' }
        : tracked.status === 'push'
          ? { text: 'Landed on the line — stake returned', tone: 'text-amber-200', mark: '=' }
          : tracked.status === 'void'
            ? { text: 'Not played, so it could not be judged', tone: 'text-amber-200', mark: '−' }
            : null;

  return (
    <div className="mt-3 rounded-xl border border-white/8 bg-white/[.02] p-3">
      <dl className="space-y-1.5 text-[11px]">
        {/* A race is classified in a position; a fixture ends on a score. */}
        {typeof tracked.actual?.position === 'number' ? (
          <div className="flex justify-between gap-3">
            <dt className="text-white/28">Classified</dt>
            <dd className="tabular-nums text-white/65">P{tracked.actual.position}</dd>
          </div>
        ) : (
          tracked.actual &&
          selection.projection && (
            <div className="flex justify-between gap-3">
              <dt className="text-white/28">{settled ? 'Final score' : 'Current score'}</dt>
              <dd className="tabular-nums text-white/65">
                {selection.projection.home_team} {tracked.actual.home_score} –{' '}
                {tracked.actual.away_score} {selection.projection.away_team}
              </dd>
            </div>
          )
        )}
        <div className="flex justify-between gap-3">
          <dt className="shrink-0 text-white/28">Required</dt>
          <dd className="text-right text-white/50">{selection.explanation}</dd>
        </div>
      </dl>

      {verdict && (
        <p className={`mt-2 flex items-center gap-1.5 text-[11px] font-medium ${verdict.tone}`}>
          <span aria-hidden="true">{verdict.mark}</span>
          {verdict.text}
        </p>
      )}
    </div>
  );
}

export function LegCard({
  selection,
  index,
  tracked,
}: {
  selection: Selection;
  index: number;
  tracked?: LegTracking;
}) {
  const { projection, race, market, reasoning } = selection;
  const started = tracked !== undefined && tracked.status !== 'pending';

  return (
    <article className="panel p-4">
      {/* Fixture */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="grid size-5 shrink-0 place-items-center rounded-md bg-violet-500/15 text-[10px] font-medium text-violet-300">
          {index + 1}
        </span>
        <span className="font-medium uppercase tracking-wider text-violet-300">
          {selection.league ?? selection.sport.toUpperCase()}
        </span>
        <span className="text-white/20">·</span>
        <span className="truncate text-white/40">{kickoff(selection.start_time)}</span>
        {tracked && (
          <span className="ml-auto">
            <LegStatusBadge status={tracked.status} />
          </span>
        )}
      </div>

      <a
        href={`/games/${selection.game_id}`}
        className="mt-2 block truncate text-sm text-white/60 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        {selection.fixture}
      </a>

      {/* The bet — the largest thing on the card, as it should be */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-white/7 pt-3">
        <div className="min-w-0 flex-1">
          <p className="text-lg font-semibold leading-tight text-white">{selection.label}</p>
          <p className="mt-1 text-[11px] text-white/40">
            <GlossaryTerm termKey={glossaryKeyForMarket(market.type, selection.sport)}>
              {market.label}
            </GlossaryTerm>
          </p>
        </div>

        <div className="flex shrink-0 items-start gap-4">
          <div className="text-right">
            <p className="text-2xl font-semibold tabular-nums leading-none text-violet-300">
              {percent(selection.probability)}
            </p>
            <p className="mt-1 text-[10px] text-white/28">
              {started ? 'Pre-game' : ''} {selection.probability_label.toLowerCase()}
            </p>
          </div>

          {market.price ? (
            <OddsDisplay
              decimal={market.price.decimal}
              fractional={market.price.fractional}
              american={market.price.american}
            />
          ) : (
            <NoPrice note="Not quoted" />
          )}
        </div>
      </div>

      <div className="mt-2.5">
        <MarketBadge market={market} />
      </div>

      {/* The thing the old card never said */}
      <div className="mt-3 rounded-xl border border-white/8 bg-white/[.02] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-wider text-white/28">
          What needs to happen
        </p>
        <p className="mt-1 text-[12px] leading-5 text-white/70">{selection.explanation}</p>
      </div>

      {tracked && <Outcome selection={selection} tracked={tracked} />}

      <Expandable label="Analysis">
        <div className="mt-3 space-y-3">
          {/* A race has no scoreline to project. What it has is an expected
              finishing order, and that is what the panel shows instead. */}
          {race ? (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-white/28">
                Projected finishing order
              </p>
              <ol className="mt-1.5 space-y-1">
                {race.entrants.slice(0, 5).map((entrant, place) => (
                  <li
                    key={entrant.driver}
                    className="flex items-baseline justify-between gap-3 text-[11px]"
                  >
                    <span className="min-w-0 truncate text-white/60">
                      <span className="mr-2 tabular-nums text-white/30">{place + 1}</span>
                      {entrant.driver}
                    </span>
                    <span className="shrink-0 tabular-nums text-white/45">
                      {Math.round(entrant.podium * 100)}% podium
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-1.5 text-[10px] text-white/28">
                {race.after_qualifying
                  ? 'Generated after qualifying, so the starting grid is known and used.'
                  : 'Generated before qualifying, so the starting grid is not yet known.'}
              </p>
            </div>
          ) : projection ? (
          <ProjectedScore
            homeTeam={projection.home_team}
            awayTeam={projection.away_team}
            homeScore={projection.expected_home_score}
            awayScore={projection.expected_away_score}
            typical={projection.typical_score}
            homeRange={projection.likely_home_range}
            awayRange={projection.likely_away_range}
          />
          ) : null}

          <div className="border-t border-white/7 pt-3">
            <p className="text-[10px] uppercase tracking-wider text-white/28">
              {selection.probability_label}
            </p>
            <p className="mt-1 text-[11px] leading-5 text-white/45">
              {probabilityMeaning(market.type, selection.sport)}
            </p>
          </div>

          {selection.edge ? (
            <div className="border-t border-white/7 pt-3">
              <p className="text-[10px] uppercase tracking-wider text-white/28">
                Model against the price
              </p>
              <div className="mt-1.5">
                <ModelEdge edge={selection.edge} model={selection.probability} />
              </div>
              {market.margin !== null && (
                <p className="mt-1.5 text-[10px] text-white/25">
                  The book&rsquo;s prices across this market total{' '}
                  {percent(1 + market.margin, 1)}; the excess is its{' '}
                  <GlossaryTerm termKey="margin">margin</GlossaryTerm>, removed before
                  comparing.
                </p>
              )}
            </div>
          ) : (
            <p className="border-t border-white/7 pt-3 text-[10px] leading-5 text-white/28">
              No bookmaker price was available for this selection, so there is nothing to
              compare the model against.
            </p>
          )}

          <div className="border-t border-white/7 pt-3">
            <Reasoning
              support={reasoning.support}
              risks={reasoning.risks}
              context={reasoning.context}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-white/7 pt-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[.03] px-2 py-0.5 text-[10px] text-white/45">
              <GlossaryTerm termKey="model_confidence">Confidence</GlossaryTerm>{' '}
              {percent(selection.confidence)}
            </span>
            <DataQualityBadge
              label={qualityLabel(selection.data_quality)}
              reasons={(race ?? projection)?.quality_reasons ?? []}
            />
          </div>

          {((race ?? projection)?.quality_reasons.length ?? 0) > 0 && (
            <ul className="space-y-1">
              {((race ?? projection)?.quality_reasons ?? []).slice(0, 3).map((reason) => (
                <li key={reason} className="text-[10px] leading-5 text-white/28">
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Expandable>
    </article>
  );
}
