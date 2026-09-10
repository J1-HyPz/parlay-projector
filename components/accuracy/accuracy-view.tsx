'use client';

/**
 * Model diagnostics.
 *
 * The accuracy service has computed every one of these breakdowns since it was
 * written, and until now nothing rendered any of them — the whole of what a
 * reader could see was a single ring on the homepage. A sport-level figure is
 * exactly where a miscalibrated competition hides: NCAA Football, the CFL and
 * the two Euro-American leagues all carry `sport: 'nfl'`, so all four were
 * averaged into the NFL's number, which is how NCAA Football's own
 * miscalibration stayed invisible for as long as it did.
 *
 * So the competition breakdown leads, and the sport breakdown sits under it
 * for contrast rather than above it as the headline.
 *
 * Nothing here is computed in the browser. Every figure arrives from
 * /api/accuracy, which is the single accuracy implementation in the
 * application — a second one here could disagree with the homepage, and then
 * neither could be trusted.
 */

import { useCallback, useEffect, useState } from 'react';
import { Activity, ArrowDownUp, Target, TrendingUp } from 'lucide-react';
import { SectionHeading } from '@/components/dashboard-ui';
import { Chip, ChipRow } from '@/components/ui/chip';
import { ErrorState } from '@/components/ui/states';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { MIN_REPORTABLE } from '@/lib/projections/metrics';
import { percent } from '@/lib/utils';
import { Breakdown } from './breakdown';
import type { BreakdownRow } from './breakdown';

const WINDOWS = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'all-time', label: 'All time' },
] as const;

type Window = (typeof WINDOWS)[number]['key'];

interface Overall {
  accuracy: number | null;
  correct: number;
  settled: number;
  pending: number;
  brier: number | null;
  mean_probability: number | null;
}

interface RiskCheck {
  ordered: boolean;
  checked: boolean;
  message: string | null;
}

interface Report {
  overall: Overall;
  by_league: BreakdownRow[];
  by_sport: BreakdownRow[];
  by_risk: BreakdownRow[];
  risk_ordering: RiskCheck;
  updated_at: string;
}

type State = 'loading' | 'ready' | 'error';

/**
 * The risk system, checked against its own claim.
 *
 * Absent entirely until the check could actually run. "Ordered" defaults to
 * true in the service so that an unknown cannot be read downstream as a
 * failure — which means rendering it unconditionally would print a pass the
 * data does not support. `checked` is the gate.
 */
function RiskOrdering({ check }: { check: RiskCheck }) {
  if (!check.checked) return null;

  return (
    <p
      className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 text-2xs leading-5 ${
        check.ordered
          ? 'border-line bg-surface-1 text-ink-subtle'
          : 'border-amber-400/20 bg-amber-500/[.06] text-status-warn'
      }`}
    >
      <ArrowDownUp aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {check.ordered
          ? 'Risk ordering holds: Low is settling above Medium, and Medium above High.'
          : (check.message ?? 'Risk levels are not settling in the order they claim.')}
      </span>
    </p>
  );
}

/**
 * The answer to one specific request.
 *
 * Stored with the window and attempt it belongs to rather than as a bare
 * report, so "still loading" is *derived* from whether the data on hand
 * answers the question currently being asked. The alternative — a `loading`
 * flag set at the top of the effect — is a setState in an effect body, which
 * costs a cascading render on every window change and which the React compiler
 * rejects outright.
 *
 * A null `report` here means the request failed. It is distinct from no result
 * at all, which means one is still in flight.
 */
interface Answer {
  window: Window;
  attempt: number;
  report: Report | null;
}

export function AccuracyView() {
  const [window, setWindow] = useState<Window>('all-time');
  const [answer, setAnswer] = useState<Answer | null>(null);
  /* Bumped by the retry button so the effect re-runs on an unchanged window. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(`/api/accuracy?window=${window}`, {
          signal: controller.signal,
          headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error(String(response.status));

        const body = (await response.json()) as Report;
        if (controller.signal.aborted) return;

        setAnswer({ window, attempt, report: body });
      } catch {
        if (!controller.signal.aborted) setAnswer({ window, attempt, report: null });
      }
    }

    void load();
    return () => controller.abort();
  }, [window, attempt]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  /*
   * Only an answer to the *current* question counts.
   *
   * Switching window while a request is in flight must not label the previous
   * window's figures with the new window's name, so a stale answer reads as
   * loading rather than as data.
   */
  const current =
    answer !== null && answer.window === window && answer.attempt === attempt ? answer : null;
  const state: State = current === null ? 'loading' : current.report === null ? 'error' : 'ready';
  const report = current?.report ?? null;

  const overall = report?.overall ?? null;
  const loading = state === 'loading';

  /*
   * `--` while loading or unavailable, never a zero.
   *
   * A zero is a claim that nothing came in; the absence of a figure is not.
   */
  const dash = (value: string | null) => (loading || value === null ? '--' : value);

  return (
    <div className="mt-6">
      <ChipRow label="Reporting window">
        {WINDOWS.map((entry) => (
          <Chip
            key={entry.key}
            active={window === entry.key}
            onClick={() => setWindow(entry.key)}
          >
            {entry.label}
          </Chip>
        ))}
      </ChipRow>

      {state === 'error' ? (
        <ErrorState className="mt-6" title="Accuracy diagnostics unavailable." onRetry={retry} />
      ) : (
        <>
          <StatGrid label="Accuracy overview">
            <StatCard
              label="Accuracy"
              icon={Target}
              value={dash(overall?.accuracy != null ? percent(overall.accuracy, 1) : null)}
              note={
                loading
                  ? undefined
                  : overall && overall.accuracy === null
                    ? `${overall.settled} settled, published from ${MIN_REPORTABLE}`
                    : `of ${overall?.settled ?? 0} settled`
              }
            />
            <StatCard
              label="Correct"
              icon={Activity}
              value={dash(overall ? String(overall.correct) : null)}
              note={loading ? undefined : `${overall?.pending ?? 0} still pending`}
            />
            <StatCard
              label="Brier score"
              icon={TrendingUp}
              value={dash(overall?.brier != null ? overall.brier.toFixed(3) : null)}
              note="Lower is better"
            />
            <StatCard
              label="Mean claimed"
              icon={ArrowDownUp}
              value={dash(
                overall?.mean_probability != null ? percent(overall.mean_probability, 1) : null,
              )}
              note="What the model said it would do"
            />
          </StatGrid>

          <section className="panel mt-6 p-4 sm:p-5" aria-busy={loading}>
            <SectionHeading title="By competition" />
            <p className="mb-3 text-2xs leading-5 text-ink-faint">
              The split a sport-level figure cannot show. Five competitions share the
              American-football sport id alone, so a single mispriced one is averaged into the
              healthier ones beside it unless it is broken out here.
            </p>
            {loading ? (
              <TableSkeleton />
            ) : (
              <Breakdown
                heading="Competition"
                rows={report?.by_league ?? []}
                empty="No settled predictions in this window."
              />
            )}
          </section>

          <section className="panel mt-4 p-4 sm:p-5" aria-busy={loading}>
            <SectionHeading title="By sport" />
            {loading ? (
              <TableSkeleton />
            ) : (
              <Breakdown
                heading="Sport"
                rows={report?.by_sport ?? []}
                empty="No settled predictions in this window."
              />
            )}
          </section>

          <section className="panel mt-4 p-4 sm:p-5" aria-busy={loading}>
            <SectionHeading title="By risk level" />
            {loading ? (
              <TableSkeleton />
            ) : (
              <>
                <Breakdown
                  heading="Risk"
                  rows={report?.by_risk ?? []}
                  empty="No settled predictions in this window."
                />
                {report && <RiskOrdering check={report.risk_ordering} />}
              </>
            )}
          </section>

          {report && (
            <p className="mt-4 px-1 text-2xs leading-5 text-ink-faint">
              Computed from stored predictions this application published before kick-off. Updated{' '}
              {new Date(report.updated_at).toLocaleString()}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="h-9 rounded-lg bg-surface-2 motion-safe:animate-pulse motion-reduce:animate-none"
        />
      ))}
    </div>
  );
}
