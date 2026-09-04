/**
 * Settled lines, assembled for display.
 *
 * Joins the generated-line store to the prediction store — both of which
 * already exist — and produces a readable result per line. Nothing new is
 * recorded and nothing is recomputed: the statuses were decided by the
 * settlement job against the rules frozen at publication, and this only reads
 * them back.
 *
 * The summaries are deterministic. They are derived from the settlement rule
 * and the real scoreline, both stored, so the same line always produces the
 * same sentence and the sentence can never contradict the verdict beside it.
 * There is no generated prose here.
 *
 * Pure.
 */

import type { SettlementRule } from '../markets/types.ts';
import type {
  ActualOutcome,
  ParlayKind,
  ParlayRecord,
  PredictionRecordV2,
  PredictionStatus,
  RiskLevel,
} from './types.ts';

/** Lines with a final verdict. A pending or live line is not a result. */
export type ResultStatus = 'won' | 'lost' | 'void';

const FINAL: readonly ResultStatus[] = ['won', 'lost', 'void'];

export interface ResultLeg {
  id: string;
  game_id: string;
  sport: string;
  /** The selection as it was published, e.g. `Houston Astros +1.5`. */
  selection: string;
  status: PredictionStatus;
  /** Null on predictions published before names were stored. */
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
}

export interface ParlayResult {
  id: string;
  risk: RiskLevel;
  kind: ParlayKind;
  status: ResultStatus;
  /** Legs that came in. Push and void legs count as neither. */
  correct_legs: number;
  total_legs: number;
  settled_at: string | null;
  legs: ResultLeg[];
  went_right: string | null;
  went_wrong: string | null;
}

// ---------------------------------------------------------------------------
// Naming a leg
// ---------------------------------------------------------------------------

/** The side a rule backs, where it backs one. */
function backedSide(rule: SettlementRule): 'home' | 'away' | null {
  switch (rule.kind) {
    case 'winner':
      return rule.side === 'draw' ? null : rule.side;
    case 'double_chance': {
      const side = (['home', 'away'] as const).find((entry) => rule.sides.includes(entry));
      return side ?? null;
    }
    case 'spread':
    case 'team_total':
      return rule.side;
    case 'total':
      return null;
  }
}

/**
 * A short way to refer to a leg in a summary sentence.
 *
 * The backed team where there is one, because "Arsenal" reads better than
 * "Arsenal Win" in a list. A total has no team, so it is named for what it is.
 */
function subject(record: PredictionRecordV2): string {
  const side = backedSide(record.settlement);
  if (side === 'home' && record.home_team) return record.home_team;
  if (side === 'away' && record.away_team) return record.away_team;
  if (record.settlement.kind === 'total') return 'the total';
  return record.selection;
}

function teamName(record: PredictionRecordV2, side: 'home' | 'away'): string {
  const name = side === 'home' ? record.home_team : record.away_team;
  return name ?? (side === 'home' ? 'the home side' : 'the away side');
}

/** A line or a margin, written the way it was published. */
function plain(value: number): string {
  return String(value);
}

function points(value: number, sport: string): string {
  const unit = sport === 'mlb' ? 'run' : sport === 'nhl' || sport === 'football' ? 'goal' : 'point';
  return `${plain(value)} ${unit}${value === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Why a leg missed
// ---------------------------------------------------------------------------

/**
 * One clause explaining a losing leg, from the rule and the real scoreline.
 *
 * Returns null when the scoreline was not recorded — better to say less than
 * to describe a result we do not have.
 */
export function missReason(record: PredictionRecordV2): string | null {
  const actual: ActualOutcome | null = record.actual;
  if (!actual) return null;

  const rule = record.settlement;
  const margin = actual.margin;

  switch (rule.kind) {
    case 'winner': {
      if (rule.side === 'draw') {
        return 'The match was projected to end level and it did not.';
      }
      const team = teamName(record, rule.side);
      const lostBy = rule.side === 'home' ? -margin : margin;
      if (lostBy === 0) {
        return `${team} were projected to win and the match was drawn.`;
      }
      return `${team} were projected to win but lost by ${points(Math.abs(lostBy), record.sport)}.`;
    }

    case 'double_chance': {
      const side = backedSide(rule);
      const team = side ? teamName(record, side) : 'the selection';
      return `${team} lost, which was the one result this selection could not survive.`;
    }

    case 'spread': {
      const team = teamName(record, rule.side);
      const own = rule.side === 'home' ? margin : -margin;

      if (rule.line > 0) {
        // Receiving a handicap: they lost by more than it covered.
        return `${team} lost by ${points(Math.abs(own), record.sport)}, outside the ${plain(rule.line)} they were given.`;
      }
      if (own > 0) {
        return `${team} won by ${points(own, record.sport)} but had to win by more than ${plain(Math.abs(rule.line))}.`;
      }
      return `${team} did not win, so the ${plain(rule.line)} handicap could not come in.`;
    }

    case 'total': {
      const above = rule.direction === 'under';
      return `The teams combined for ${points(actual.total, record.sport)}, ${
        above ? 'above' : 'below'
      } the ${plain(rule.line)} line.`;
    }

    case 'team_total': {
      const team = teamName(record, rule.side);
      const scored = rule.side === 'home' ? actual.home_score : actual.away_score;
      return `${team} scored ${points(scored, record.sport)}, ${
        rule.direction === 'over' ? 'below' : 'above'
      } the ${plain(rule.line)} line.`;
    }
  }
}

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

/** `A`, `A and B`, `A, B and C`. */
function list(names: readonly string[]): string {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What went right.
 *
 * Names the winning legs while there are few enough for naming to be shorter
 * than counting, and falls back to a count beyond that. Null when nothing came
 * in — an empty section is better than a sentence saying so.
 */
export function summariseRight(
  legs: readonly PredictionRecordV2[],
  total: number,
): string | null {
  const won = legs.filter((leg) => leg.status === 'won');
  if (won.length === 0) return null;

  if (won.length === total) {
    return total === 1
      ? 'The projected outcome matched the result.'
      : `All ${total} selections were correct.`;
  }

  if (won.length <= 2) {
    return `The ${list(won.map(subject))} ${won.length === 1 ? 'selection' : 'selections'} came in.`;
  }

  return `${won.length} of ${total} selections were correct.`;
}

/**
 * What went wrong.
 *
 * One specific reason where a single leg missed, because that is the useful
 * case and the one a reader wants explained. Beyond that a count leads and the
 * first reason follows, which keeps it to two sentences however many legs
 * failed.
 */
export function summariseWrong(
  legs: readonly PredictionRecordV2[],
  total: number,
): string | null {
  const lost = legs.filter((leg) => leg.status === 'lost');
  if (lost.length === 0) return null;

  const reasons = lost.map(missReason).filter((reason): reason is string => reason !== null);

  if (lost.length === 1) {
    return reasons[0] ?? `The ${subject(lost[0])} selection did not come in.`;
  }

  const lead = `${lost.length} of ${total} selections missed.`;
  return reasons.length > 0 ? `${lead} ${reasons[0]}` : lead;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function toLeg(record: PredictionRecordV2): ResultLeg {
  return {
    id: record.id,
    game_id: record.game_id,
    sport: record.sport,
    selection: record.selection,
    status: record.status,
    home_team: record.home_team ?? null,
    away_team: record.away_team ?? null,
    // A scoreline is only offered when it was actually recorded. Never zero as
    // a stand-in for "not known".
    home_score: record.actual?.home_score ?? null,
    away_score: record.actual?.away_score ?? null,
  };
}

/**
 * Recently settled lines, newest first.
 *
 * A line whose legs cannot be found is dropped rather than shown with gaps —
 * that only happens if the prediction store has been trimmed out from under the
 * line store, and a half-rendered result is worse than one fewer result.
 */
export function recentResults(
  parlays: readonly ParlayRecord[],
  predictions: readonly PredictionRecordV2[],
  limit = 10,
): ParlayResult[] {
  const byId = new Map(predictions.map((record) => [record.id, record]));

  const settled = parlays
    .filter((parlay): parlay is ParlayRecord & { status: ResultStatus } =>
      (FINAL as readonly string[]).includes(parlay.status),
    )
    .sort((a, b) => (b.settled_at ?? '').localeCompare(a.settled_at ?? ''));

  const results: ParlayResult[] = [];

  for (const parlay of settled) {
    if (results.length >= Math.max(1, Math.min(limit, 50))) break;

    const legs = parlay.leg_ids
      .map((id) => byId.get(id))
      .filter((record): record is PredictionRecordV2 => record !== undefined);

    if (legs.length !== parlay.leg_ids.length) continue;

    results.push({
      id: parlay.id,
      risk: parlay.risk,
      kind: parlay.kind ?? 'multi_game',
      status: parlay.status,
      correct_legs: legs.filter((leg) => leg.status === 'won').length,
      total_legs: legs.length,
      settled_at: parlay.settled_at,
      legs: legs.map(toLeg),
      // A void line was never tested, so there is nothing to say went right or
      // wrong. The interface states that plainly instead.
      went_right: parlay.status === 'void' ? null : summariseRight(legs, legs.length),
      went_wrong: parlay.status === 'void' ? null : summariseWrong(legs, legs.length),
    });
  }

  return results;
}
