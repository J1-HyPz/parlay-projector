/**
 * One accuracy breakdown, as a table.
 *
 * Shared by every split on the page — competition, sport, risk — so they
 * cannot drift into disagreeing about what a row means or when a rate is
 * allowed to appear.
 *
 * Two rules from lib/projections/metrics.ts are enforced here rather than
 * restated loosely:
 *
 *   A rate never appears without its sample size, and never at all below
 *   MIN_REPORTABLE. The service already withholds it — this renders the
 *   withholding as an em dash and explains it once under the table, instead
 *   of leaving a blank cell to read as a fault.
 *
 *   Accuracy never appears alone. Brier sits beside it in every row, because a
 *   model that only backs heavy favourites posts a healthy percentage while
 *   being badly calibrated.
 */

import { MIN_REPORTABLE } from '@/lib/projections/metrics';
import { percent } from '@/lib/utils';

/** The shape `groupBy` returns, narrowed to what a row displays. */
export interface BreakdownRow {
  key: string;
  label: string;
  accuracy: number | null;
  correct: number;
  incorrect: number;
  settled: number;
  pending: number;
  brier: number | null;
  mean_probability: number | null;
  sample: 'small' | 'developing' | 'meaningful';
}

/**
 * How much weight the row carries.
 *
 * Deliberately worded as a claim about the evidence rather than about the
 * model: "small" describes the sample, not the competition.
 */
const SAMPLE_TONE: Record<BreakdownRow['sample'], string> = {
  small: 'text-ink-faint',
  developing: 'text-ink-subtle',
  meaningful: 'text-ink',
};

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 text-xs tabular-nums ${className}`}>{children}</td>;
}

export function Breakdown({
  rows,
  /** What the first column names, e.g. "Competition". */
  heading,
  /** Shown in place of the table when there is nothing to split. */
  empty,
}: {
  rows: readonly BreakdownRow[];
  heading: string;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="px-1 py-3 text-xs leading-5 text-ink-subtle">{empty}</p>;
  }

  const withheld = rows.some((row) => row.accuracy === null && row.settled > 0);

  return (
    <div>
      {/* Wide content scrolls inside its own container; the page never does. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="px-3 py-2 text-2xs font-medium uppercase tracking-wider text-ink-faint">
                {heading}
              </th>
              <th scope="col" className="px-3 py-2 text-right text-2xs font-medium uppercase tracking-wider text-ink-faint">
                Settled
              </th>
              <th scope="col" className="px-3 py-2 text-right text-2xs font-medium uppercase tracking-wider text-ink-faint">
                Correct
              </th>
              <th scope="col" className="px-3 py-2 text-right text-2xs font-medium uppercase tracking-wider text-ink-faint">
                Accuracy
              </th>
              <th scope="col" className="px-3 py-2 text-right text-2xs font-medium uppercase tracking-wider text-ink-faint">
                <abbr title="Brier score: mean squared error of the stated probability. Lower is better.">
                  Brier
                </abbr>
              </th>
              <th scope="col" className="px-3 py-2 text-right text-2xs font-medium uppercase tracking-wider text-ink-faint">
                Claimed
              </th>
              {/*
                Last and quietest: it is the only column about the future.

                It earns its place because without it a competition with
                predictions running but none settled yet renders as a row of
                six dashes, which reads as a fault rather than as "no evidence
                has arrived here yet".
              */}
              <th scope="col" className="px-3 py-2 text-right text-2xs font-medium uppercase tracking-wider text-ink-faint">
                Pending
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-b border-line/60 last:border-0">
                <th
                  scope="row"
                  className={`px-3 py-2.5 text-xs font-medium ${SAMPLE_TONE[row.sample]}`}
                >
                  {row.label}
                </th>
                <Cell className="text-right text-ink-subtle">{row.settled}</Cell>
                <Cell className="text-right text-ink-subtle">{row.correct}</Cell>
                <Cell className="text-right font-semibold text-ink-strong">
                  {row.accuracy === null ? (
                    <>
                      <span aria-hidden="true">—</span>
                      {/*
                        The dash is a decision, and a screen reader cannot see
                        the note under the table that explains it.

                        Two different reasons produce it and they are not the
                        same claim: nothing has settled here at all, or some has
                        but not enough to publish a rate from. Kept short
                        because it is announced once per row.
                      */}
                      <span className="sr-only">
                        {row.settled === 0 ? 'Nothing settled yet' : 'Not published, sample too small'}
                      </span>
                    </>
                  ) : (
                    percent(row.accuracy, 1)
                  )}
                </Cell>
                <Cell className="text-right text-ink-subtle">
                  {row.brier === null ? <span aria-hidden="true">—</span> : row.brier.toFixed(3)}
                </Cell>
                {/*
                  What the model said it would do, beside what it did.

                  A row where "Claimed" sits well above "Accuracy" is the
                  overconfidence this page exists to make visible — and unlike
                  the rate, a mean probability is meaningful at any sample size,
                  so it is shown wherever one exists.
                */}
                <Cell className="text-right text-ink-faint">
                  {row.mean_probability === null ? (
                    <span aria-hidden="true">—</span>
                  ) : (
                    percent(row.mean_probability, 1)
                  )}
                </Cell>
                <Cell className="text-right text-ink-faint">{row.pending}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {withheld && (
        <p className="mt-3 px-1 text-2xs leading-5 text-ink-faint">
          A rate is published from {MIN_REPORTABLE} settled predictions; thinner rows show their
          counts only. Brier and claimed probability are shown throughout — both say something
          at a sample size a percentage does not.
        </p>
      )}
    </div>
  );
}
