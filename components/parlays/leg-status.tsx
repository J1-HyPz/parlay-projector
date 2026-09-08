'use client';

/**
 * Live status for a published prediction.
 *
 * Reads the tracker's view of a selection — pending, live, won, lost, push or
 * void — and renders it beside the leg.
 *
 * It shows *status*, never a recalculated probability. The number on the leg is
 * what the model said before kick-off, and it stays that way however the game
 * is going: a prediction that looks good at half-time was not a better
 * prediction when it was made.
 */

import { CircleCheck, CircleDot, CircleMinus, CircleX, Radio } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type LegStatus = 'pending' | 'live' | 'won' | 'lost' | 'push' | 'void' | 'unsettled';

const PRESENTATION: Record<LegStatus, { label: string; tone: string; icon: LucideIcon }> = {
  pending: { label: 'Pending', tone: 'tone-neutral', icon: CircleDot },
  live: {
    label: 'Live',
    tone: 'tone-live',
    icon: Radio,
  },
  won: {
    label: 'Won',
    tone: 'tone-good',
    icon: CircleCheck,
  },
  lost: {
    label: 'Lost',
    tone: 'tone-neutral',
    icon: CircleX,
  },
  push: {
    label: 'Push',
    tone: 'tone-warn',
    icon: CircleMinus,
  },
  void: {
    label: 'Void',
    tone: 'tone-warn',
    icon: CircleMinus,
  },
  unsettled: {
    label: 'Awaiting result',
    tone: 'tone-neutral',
    icon: CircleDot,
  },
};

/**
 * A status badge.
 *
 * Colour is never the only signal — every badge carries its text label, so the
 * distinction between won and lost does not depend on seeing green and grey.
 */
export function LegStatusBadge({ status }: { status: LegStatus }) {
  const { label, tone, icon: Icon } = PRESENTATION[status] ?? PRESENTATION.pending;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-2xs font-medium ${tone}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {label}
    </span>
  );
}

export interface LegOutcome {
  status: LegStatus;
  /** Final or current score, as the provider reported it. */
  result: string | null;
  actual: { home_score: number; away_score: number } | null;
  projected: { home_score: number; away_score: number } | null;
}

/**
 * What happened, under a settled leg.
 *
 * Shows the projected scoreline against the real one, so the model is visibly
 * being checked rather than only scored.
 */
export function LegOutcomeLine({ outcome }: { outcome: LegOutcome }) {
  if (outcome.status === 'pending') return null;

  const parts: string[] = [];
  if (outcome.actual) {
    parts.push(`Actual ${outcome.actual.home_score}–${outcome.actual.away_score}`);
  } else if (outcome.result) {
    parts.push(outcome.result);
  }

  if (outcome.projected && outcome.actual) {
    const error =
      Math.abs(outcome.projected.home_score - outcome.actual.home_score) +
      Math.abs(outcome.projected.away_score - outcome.actual.away_score);
    parts.push(`score error ${error.toFixed(1)}`);
  }

  if (parts.length === 0) return null;

  return (
    <p className="mt-2 text-2xs text-ink-faint">{parts.join(' · ')}</p>
  );
}
