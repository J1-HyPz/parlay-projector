'use client';

/**
 * The four overview cards. Values stay `--` until data arrives, or when a
 * section is unavailable; nothing here is ever a placeholder number.
 *
 * The card itself is now shared -- see components/ui/stat-card.tsx, and the
 * note there about why these are two-across on a phone rather than four
 * stacked.
 */

import { Activity, CalendarDays, Clock3, Trophy } from 'lucide-react';
import { percent } from '@/lib/utils';
import { MIN_REPORTABLE } from '@/lib/projections/metrics';
import { StatCard, StatGrid } from '@/components/ui/stat-card';
import { useHomeData } from './home-data';

export function SummaryCards() {
  const { state, data } = useHomeData();
  const summary = data?.summary;
  const ready = state === 'loaded' && summary !== undefined;

  const number = (value: number | undefined) => (ready && value !== undefined ? String(value) : '--');

  const accuracy = ready && summary.accuracy !== null ? percent(summary.accuracy, 1) : '--%';

  /*
   * Why the rate is missing, when it is.
   *
   * A percentage is withheld below MIN_REPORTABLE settled predictions, because
   * a rate from a handful of results is noise. But the card used to show
   * `--%` beside "12 settled", which reads as a broken widget rather than a
   * deliberate one -- there plainly *is* history, so why is there no number?
   *
   * Saying how far off the threshold is answers that, and costs no new data:
   * both figures are already here.
   */
  const accuracyNote = (() => {
    if (!ready) return undefined;
    if (summary.predictions_settled === 0) return 'No settled predictions yet';
    if (summary.accuracy === null) {
      return `${summary.predictions_settled} of ${MIN_REPORTABLE} settled needed for a rate`;
    }
    return `${summary.predictions_settled} settled`;
  })();

  // Games still to start today, derived from what the API already returned.
  const upcoming =
    state === 'loaded' && data
      ? String(data.games.filter((game) => game.status === 'scheduled').length)
      : '--';

  return (
    <StatGrid label="Overview">
      <StatCard label="Games Today" icon={CalendarDays} value={number(summary?.games_today)} />
      <StatCard label="Sports Tracked" icon={Trophy} value={number(summary?.sports_active)} />
      <StatCard label="Prediction Accuracy" icon={Activity} value={accuracy} note={accuracyNote} />
      <StatCard label="Upcoming Games" icon={Clock3} value={upcoming} />
    </StatGrid>
  );
}
