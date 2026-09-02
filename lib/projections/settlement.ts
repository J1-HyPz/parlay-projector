/**
 * Settling published predictions, and measuring the model.
 *
 * Pure. Settlement compares a stored settlement rule against a final score —
 * nothing is recomputed, and no information that arrived after the prediction
 * was published is consulted. The rule and the probability are frozen at
 * publication, which is the whole reason the accuracy figures mean anything.
 *
 * Metrics over settled predictions live in metrics.ts; this module only decides
 * what happened to one prediction.
 */

import type { PredictionStatus, SettlementRule } from './types.ts';

export interface FinalScore {
  home: number;
  away: number;
  /** Normalised status of the completed game. */
  status: 'finished' | 'cancelled' | 'postponed';
}

/**
 * Did the selection come in?
 *
 * A cancelled or postponed game voids rather than loses: the projection was
 * never tested, and counting it as a miss would understate the model as surely
 * as counting it as a hit would flatter it.
 */
export function settle(rule: SettlementRule, final: FinalScore): PredictionStatus {
  if (final.status !== 'finished') return 'void';

  const margin = final.home - final.away;
  const total = final.home + final.away;

  switch (rule.kind) {
    case 'winner': {
      const actual = margin > 0 ? 'home' : margin < 0 ? 'away' : 'draw';
      return actual === rule.side ? 'won' : 'lost';
    }

    case 'double_chance': {
      const actual = margin > 0 ? 'home' : margin < 0 ? 'away' : 'draw';
      return rule.sides.includes(actual) ? 'won' : 'lost';
    }

    case 'spread': {
      /*
       * Landing exactly on the line is a push, not a void.
       *
       * The two are different things and are counted differently: a push means
       * the prediction was tested and neither side won, a void means it could
       * not be tested at all. Every generated line uses half points so this
       * should not arise, but a rule loaded from an older store might not.
       */
      const adjusted = rule.side === 'home' ? margin + rule.line : -margin + rule.line;
      if (adjusted === 0) return 'push';
      return adjusted > 0 ? 'won' : 'lost';
    }

    case 'total': {
      if (total === rule.line) return 'push';
      const over = total > rule.line;
      return (rule.direction === 'over') === over ? 'won' : 'lost';
    }

    case 'team_total': {
      const scored = rule.side === 'home' ? final.home : final.away;
      if (scored === rule.line) return 'push';
      const over = scored > rule.line;
      return (rule.direction === 'over') === over ? 'won' : 'lost';
    }

    default:
      return 'void';
  }
}

/** Plain description of what happened, stored alongside the outcome. */
export function describeResult(final: FinalScore): string {
  if (final.status !== 'finished') return final.status === 'cancelled' ? 'Cancelled' : 'Postponed';
  return `${final.home}-${final.away}`;
}
