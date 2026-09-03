/**
 * Evidence, and which way it points.
 *
 * The old model attached one flat list of reasons to a fixture and copied it
 * onto every selection from that fixture, with each reason's polarity fixed
 * relative to whichever side the model favoured. That produced exactly the
 * wrong answer whenever a selection backed the other side: "the Astros have
 * won four of their last six" was filed under Risk Factors on an Astros
 * selection, because it had been written as a caution about the underdog.
 *
 * A piece of evidence has no polarity on its own. "Arsenal are scoring
 * freely" supports Arsenal to win, argues against their opponent, supports the
 * over, and is neither for nor against a bet on corners. Polarity is a
 * relationship between the evidence and the selection, so it is computed at
 * the point the two meet rather than baked in when the evidence is written.
 *
 * Each factor therefore records *what it says and about whom*, and each
 * selection records *what it needs to happen*. `roleOf` resolves the pair.
 *
 * Pure.
 */

import type { SettlementRule } from '../markets/types.ts';

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * What a piece of evidence is about.
 *
 *   team         a statement about one side, and whether it flatters them
 *   scoring      a statement about how much scoring the game should contain
 *   uncertainty  a caveat about the estimate itself, which is a caution
 *                whatever is being backed
 */
export type FactorSubject =
  | {
      kind: 'team';
      team: string;
      /** Whether the statement is good news for that team. */
      favourable: boolean;
      /** Whether it also points to a higher or lower-scoring game. */
      scoring?: 'high' | 'low';
    }
  | { kind: 'scoring'; lean: 'high' | 'low' }
  | { kind: 'uncertainty' };

export interface ProjectionFactor {
  text: string;
  subject: FactorSubject;
  /**
   * Polarity relative to the *projection's own* favoured outcome.
   *
   * Retained because the game page shows a projection rather than a selection,
   * and there is no selection there to orient against. Selections ignore it
   * and use `roleOf` instead.
   */
  direction: 'positive' | 'negative';
}

// ---------------------------------------------------------------------------
// What a selection needs
// ---------------------------------------------------------------------------

/**
 * The outcome a selection is backing, reduced to what evidence can speak to.
 *
 * A selection needs a particular side to do well, or needs the game to be
 * high or low scoring, or both — a team total needs its team to score, which
 * is both at once.
 */
export interface Backing {
  /** The side this selection needs to do well. */
  team: string | null;
  /** The side whose success works against it. */
  opponent: string | null;
  /** Whether it needs more scoring or less. */
  lean: 'high' | 'low' | null;
}

/** Names of the two sides, so a rule can be resolved to real teams. */
export interface Sides {
  home: string;
  away: string;
}

function nameOf(side: 'home' | 'away' | 'draw', sides: Sides): string | null {
  if (side === 'home') return sides.home;
  if (side === 'away') return sides.away;
  return null;
}

/** What a settlement rule is backing. */
export function backingFor(rule: SettlementRule, sides: Sides): Backing {
  switch (rule.kind) {
    case 'winner': {
      if (rule.side === 'draw') return { team: null, opponent: null, lean: 'low' };
      return {
        team: nameOf(rule.side, sides),
        opponent: nameOf(rule.side === 'home' ? 'away' : 'home', sides),
        lean: null,
      };
    }

    case 'double_chance': {
      // The side that is not backed is the only thing that can beat it.
      const excluded = (['home', 'away'] as const).find((side) => !rule.sides.includes(side));
      const backed = (['home', 'away'] as const).find((side) => rule.sides.includes(side));
      return {
        team: backed ? nameOf(backed, sides) : null,
        opponent: excluded ? nameOf(excluded, sides) : null,
        lean: null,
      };
    }

    case 'spread':
      return {
        team: nameOf(rule.side, sides),
        opponent: nameOf(rule.side === 'home' ? 'away' : 'home', sides),
        lean: null,
      };

    case 'total':
      return { team: null, opponent: null, lean: rule.direction === 'over' ? 'high' : 'low' };

    case 'team_total':
      return {
        team: nameOf(rule.side, sides),
        opponent: nameOf(rule.side === 'home' ? 'away' : 'home', sides),
        lean: rule.direction === 'over' ? 'high' : 'low',
      };
  }
}

// ---------------------------------------------------------------------------
// Resolving the pair
// ---------------------------------------------------------------------------

/**
 * How a factor relates to a selection.
 *
 *   support  it argues for the selection
 *   risk     it argues against
 *   context  it is relevant to the fixture but does not push either way
 *
 * The third category matters. Forcing every fact into for-or-against is what
 * produced the miscategorisation in the first place: a note that both sides
 * are evenly matched is real information about a total, and it is neither an
 * argument for nor against it.
 */
export type FactorRole = 'support' | 'risk' | 'context';

export function roleOf(factor: ProjectionFactor, backing: Backing): FactorRole {
  const subject = factor.subject;

  // A caveat about the estimate is a caution whatever is being backed.
  if (subject.kind === 'uncertainty') return 'risk';

  if (subject.kind === 'scoring') {
    if (backing.lean === null) return 'context';
    return subject.lean === backing.lean ? 'support' : 'risk';
  }

  if (backing.team !== null && subject.team === backing.team) {
    return subject.favourable ? 'support' : 'risk';
  }
  if (backing.opponent !== null && subject.team === backing.opponent) {
    return subject.favourable ? 'risk' : 'support';
  }

  // Not about a side this selection cares about — but it may still speak to
  // how much scoring there is, which a total does care about.
  if (backing.lean !== null && subject.scoring) {
    return subject.scoring === backing.lean ? 'support' : 'risk';
  }

  return 'context';
}

export interface OrientedFactors {
  support: ProjectionFactor[];
  risks: ProjectionFactor[];
  context: ProjectionFactor[];
}

/**
 * Sort a fixture's evidence into the three buckets for one selection.
 *
 * The same evidence produces different buckets for different selections from
 * the same game, which is the entire point.
 */
export function orientFactors(
  factors: readonly ProjectionFactor[],
  backing: Backing,
): OrientedFactors {
  const oriented: OrientedFactors = { support: [], risks: [], context: [] };

  for (const factor of factors) {
    const role = roleOf(factor, backing);
    if (role === 'support') oriented.support.push(factor);
    else if (role === 'risk') oriented.risks.push(factor);
    else oriented.context.push(factor);
  }

  return oriented;
}
