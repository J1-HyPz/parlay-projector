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

import type { ActualOutcome, PredictionStatus, SettlementRule } from './types.ts';

export interface FinalScore {
  home: number;
  away: number;
  /** Normalised status of the completed game. */
  status: 'finished' | 'cancelled' | 'postponed';
  /**
   * The classified finishing order, for an event contested by a field.
   *
   * Present only for motorsport. A retirement still appears here with the
   * position it was classified in — which is what makes a retired driver lose
   * a top-ten selection rather than voiding it.
   */
  order?: readonly { entrant: string; position: number }[];
  /**
   * Which side won, for a contest decided without a score.
   *
   * Present only for a fight or a tennis match, whose `home` and `away` are
   * zero and mean nothing. Null is a draw or a no-contest, which is a real
   * outcome rather than a missing one.
   */
  winner?: 'home' | 'away' | null;
  /** Whether a contest ran its course. Tennis publishes the two exceptions. */
  completion?: 'played' | 'retired' | 'walkover';
}

/** True for a result that is a winner rather than a scoreline. */
function decidedByWinner(final: FinalScore): boolean {
  return final.winner !== undefined;
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
      if (decidedByWinner(final)) {
        /*
         * A contest that was not fully contested is void, not lost.
         *
         * A tennis retirement is the case §4.8.b of the v2 spec decides: the
         * match happened, but nothing about who was better was settled, and
         * a walkover means no tennis was played at all. A drawn or no-contest
         * fight is the same shape — neither side won, so a bet on either was
         * never tested. None of these is evidence the projection was wrong.
         */
        if (final.completion === 'retired' || final.completion === 'walkover') return 'void';
        if (final.winner === null) return 'void';
        return final.winner === rule.side ? 'won' : 'lost';
      }

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

    case 'both_teams_to_score': {
      /*
       * No line, so no push: a side either scored or it did not. Zero is a real
       * score here rather than a missing one — settlement is only reached with
       * a published final result.
       */
      const both = final.home > 0 && final.away > 0;
      return both === rule.yes ? 'won' : 'lost';
    }

    case 'finish_position': {
      const position = classified(final, rule.entrant);
      /*
       * Not classified at all means the driver never took part — a withdrawal
       * or a non-start. That is untested rather than failed, so it voids.
       * A retirement is different: it is classified, and it loses.
       */
      if (position === null) return 'void';
      return position <= rule.within ? 'won' : 'lost';
    }

    case 'head_to_head': {
      const mine = classified(final, rule.entrant);
      const theirs = classified(final, rule.over);
      // Either side absent leaves nothing to compare.
      if (mine === null || theirs === null) return 'void';
      if (mine === theirs) return 'push';
      return mine < theirs ? 'won' : 'lost';
    }

    default:
      return 'void';
  }
}

/**
 * Where a competitor was classified, or null if they were not.
 *
 * Matched on the name the prediction froze, which is the name the provider
 * published. Nothing is fuzzy-matched: a near-miss would settle a prediction
 * against the wrong driver, which is worse than leaving it open.
 */
function classified(final: FinalScore, entrant: string): number | null {
  const row = final.order?.find((entry) => entry.entrant === entrant);
  return row ? row.position : null;
}

/** Plain description of what happened, stored alongside the outcome. */
export function describeResult(final: FinalScore): string {
  if (final.status !== 'finished') return final.status === 'cancelled' ? 'Cancelled' : 'Postponed';
  return `${final.home}-${final.away}`;
}

// ---------------------------------------------------------------------------
// Reading a game's state
// ---------------------------------------------------------------------------

/**
 * A game as the tracker observed it.
 *
 * Structurally what the store's `GameState` is; declared here so the rules
 * below stay in the pure module and can be tested without a filesystem.
 */
export interface GameObservation {
  status: 'scheduled' | 'live' | 'finished' | 'cancelled' | 'postponed';
  home: number | null;
  away: number | null;
  order?: readonly { entrant: string; position: number }[];
  /** For a fight or a match: who won, and whether it ran its course. */
  winner?: 'home' | 'away' | null;
  completion?: 'played' | 'retired' | 'walkover';
}

/** The two names, so a result can be described rather than merely coded. */
export interface SideNames {
  home: string | null;
  away: string | null;
}

/** True for a rule judged on a finishing order rather than a scoreline. */
export function isRaceRule(rule: SettlementRule): boolean {
  return rule.kind === 'finish_position' || rule.kind === 'head_to_head';
}

/**
 * The evidence a rule needs, or null when it has not arrived.
 *
 * One definition, used by the first settlement and by a later correction
 * alike. They were separate, and the correction path understood only
 * scorelines — so a race could be settled but never corrected, and a stewards'
 * penalty applied after the flag never reached the prediction it changed.
 * Worse, had a provider ever reported a score alongside a race, the correction
 * would have re-settled every race prediction against an empty finishing order
 * and voided the lot.
 *
 * Null is "not yet", never "no". A caller that cannot get evidence must leave
 * the record alone rather than settle it as unproven.
 */
export function evidenceFor(rule: SettlementRule, state: GameObservation): FinalScore | null {
  if (state.status !== 'finished') return null;

  if (isRaceRule(rule)) {
    // A race has no score. The classified order is the entire result.
    if (!state.order || state.order.length === 0) return null;
    return { home: 0, away: 0, status: 'finished', order: state.order };
  }

  /*
   * A fight or a match has no score either. The winner is the entire result,
   * and the tracker only ever records one for a contest that has none — so its
   * presence, not its value, is what says this is that kind of fixture. Null
   * is a draw or a no-contest and is evidence, not its absence.
   */
  if (rule.kind === 'winner' && state.winner !== undefined) {
    return {
      home: 0,
      away: 0,
      status: 'finished',
      winner: state.winner,
      ...(state.completion ? { completion: state.completion } : {}),
    };
  }

  if (typeof state.home !== 'number' || typeof state.away !== 'number') return null;
  return { home: state.home, away: state.away, status: 'finished' };
}

/** A contest decided by a winner, in words. */
function describeWinner(evidence: FinalScore, names: SideNames): string {
  const winner =
    evidence.winner === 'home'
      ? (names.home ?? 'The first-listed side')
      : evidence.winner === 'away'
        ? (names.away ?? 'The second-listed side')
        : null;

  if (evidence.completion === 'walkover') return 'Walkover — not played';
  if (evidence.completion === 'retired') {
    return winner ? `${winner} won by retirement` : 'Ended by retirement';
  }
  if (!winner) return 'No winner — draw or no contest';
  return `${winner} won`;
}

/**
 * What actually happened, in the shape a prediction can be read against later.
 *
 * A fixture ends on a scoreline; a race ends in a classified position out of a
 * field; a fight or a match ends with a winner. Shared by the first settlement
 * and by a correction, so the two can never disagree about how the same result
 * is described.
 *
 * `names` lets a winner be named rather than coded. It is optional because a
 * scoreline and a finishing order need no names to be readable.
 */
export function outcomeOf(
  rule: SettlementRule,
  evidence: FinalScore,
  names: SideNames = { home: null, away: null },
): { text: string; actual: ActualOutcome } {
  if (decidedByWinner(evidence)) {
    return {
      text: describeWinner(evidence, names),
      actual: {
        home_score: 0,
        away_score: 0,
        margin: 0,
        total: 0,
        winner: evidence.winner ?? null,
      },
    };
  }

  if (!isRaceRule(rule)) {
    return {
      text: describeResult(evidence),
      actual: {
        home_score: evidence.home,
        away_score: evidence.away,
        margin: evidence.home - evidence.away,
        total: evidence.home + evidence.away,
      },
    };
  }

  const order = evidence.order ?? [];
  const entrant =
    rule.kind === 'finish_position' || rule.kind === 'head_to_head' ? rule.entrant : '';
  const classified = order.find((entry) => entry.entrant === entrant) ?? null;

  return {
    text: classified
      ? `Classified P${classified.position} of ${order.length}`
      : 'Did not take part',
    actual: {
      home_score: 0,
      away_score: 0,
      margin: 0,
      total: 0,
      position: classified?.position ?? null,
      field_size: order.length,
    },
  };
}
