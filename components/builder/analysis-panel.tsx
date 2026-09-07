'use client';
import { analyseStructure } from '@/lib/builder/analysis';
import type { BuilderLine, LegEvidence } from '@/lib/builder/types';
import { action, displayTime } from './ui';

export function AnalysisPanel({
  line,
  evidence,
  loading,
  error,
  now,
  onReview,
  onRemove,
  onRefresh,
}: {
  line: BuilderLine;
  evidence: LegEvidence[];
  loading: boolean;
  error: string | null;
  now: number;
  onReview: (id: string) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const structure = analyseStructure(line, now);
  const money = (n: number | null) =>
    n === null ? 'unavailable' : `${line.currency} ${n.toFixed(2)}`;
  return (
    <section
      className="panel p-4 sm:p-5"
      aria-busy={loading}
      aria-label="Complete line analysis"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Complete line analysis</h2>
        <button className={action} onClick={onRefresh}>
          Refresh prices
        </button>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/65">
        {structure.largest}
      </p>
      <p className="mt-3 text-sm leading-6 text-white/65">
        {structure.uncertainty}
      </p>
      <h3 className="mt-5 text-sm font-semibold">
        Correlation and concentration
      </h3>
      {structure.risks.length ? (
        <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-white/65">
          {structure.risks.map((risk) => (
            <li key={risk}>{risk}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-white/60">
          There are no multiple-leg concentrations to compare.
        </p>
      )}
      <h3 className="mt-5 text-sm font-semibold">Selection evidence</h3>
      {loading && (
        <output className="my-3 text-sm text-violet-200">
          Loading available team information…
        </output>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-amber-200">
          {error}
        </p>
      )}
      <div className="mt-3 space-y-3">
        {line.legs.map(({ selection: s }) => {
          const data = evidence.find((e) => e.gameId === s.event.id);
          return (
            <details
              key={s.id}
              className="rounded-xl border border-white/10 p-3"
              open
            >
              <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2 focus-visible:outline-violet-400">
                {s.event.name} · {s.marketName}: {s.outcome}
                {s.line === null ? '' : ` ${s.line}`}
              </summary>
              <p className="mt-2 text-xs text-white/50">
                {s.bookmaker.name} · {s.decimal ?? 'Unpriced'} decimal ·{' '}
                {s.settlement.label}
              </p>
              {data ? (
                <>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-sm leading-6 text-white/65">
                    {data.facts.map((fact) => (
                      <li key={fact}>{fact}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-white/45">
                    Evidence retrieved {displayTime(data.fetchedAt)}
                  </p>
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-sm leading-6 text-amber-200/80">
                    {data.gaps.map((gap) => (
                      <li key={gap}>{gap}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-3 text-sm text-amber-200">
                  Team evidence for this match has not been loaded. Analyse the
                  updated line to retrieve it.
                </p>
              )}
              <p className="mt-3 text-xs leading-5 text-white/50">
                Team records provide historical context. They do not establish
                the chance of this exact outcome, a player prop, or positive
                expected value.
              </p>
              <button
                className={`${action} mt-3`}
                onClick={() => onReview(s.id)}
              >
                Review supported alternatives
              </button>
            </details>
          );
        })}
      </div>
      {line.legs.length > 1 && (
        <>
          <h3 className="mt-6 text-sm font-semibold">Compare a shorter line</h3>
          <p className="mt-2 text-sm leading-6 text-white/65">
            Removing a leg reduces the number of outcomes required. Compare the
            effect at the same total stake; no selection changes until you
            accept.
          </p>
          <div className="mt-3 space-y-2">
            {structure.comparisons.map((comparison) => (
              <div
                key={comparison.id}
                className="rounded-xl border border-white/10 p-3"
              >
                <p className="text-sm">Remove {comparison.name}</p>
                <p className="mt-2 text-xs leading-5 text-white/60">
                  {comparison.remaining} remaining ·{' '}
                  {comparison.result.decimal?.toFixed(2) ?? 'Unavailable'}{' '}
                  decimal · Estimated return{' '}
                  {money(comparison.result.totalReturn)} · Net profit{' '}
                  {money(comparison.result.profit)}
                </p>
                {comparison.result.issues.length > 0 && (
                  <p className="mt-1 text-xs text-amber-200">
                    {comparison.result.issues.join(' ')}
                  </p>
                )}
                <button
                  className={`${action} mt-2`}
                  onClick={() => onRemove(comparison.id)}
                >
                  Accept removal
                </button>
              </div>
            ))}
          </div>
          <details className="mt-5 rounded-xl border border-white/10 p-3">
            <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-2 focus-visible:outline-violet-400">
              Compare as singles
            </summary>
            <p className="mt-3 text-sm leading-6 text-white/65">
              The same {line.currency} {line.stake} total stake is split across
              the selections. Each single settles independently of the others;
              returns from winning singles remain even if another loses.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-white/65">
              {structure.singles.map((single, i) => (
                <li key={single.id}>
                  Leg {i + 1}: stake {money(single.stake)} · return if it wins{' '}
                  {money(single.result.totalReturn)}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-violet-200">
              Return if every single wins: {money(structure.allSinglesReturn)}.
              This is a scenario, not an expected return.
            </p>
          </details>
        </>
      )}
    </section>
  );
}
