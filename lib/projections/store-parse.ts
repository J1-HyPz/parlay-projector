/**
 * Validation for the prediction store.
 *
 * Pure, so the rules can be tested without a filesystem. The store is a file
 * that survives redeploys, so records are treated as untrusted input rather
 * than assumed well-formed — a truncated or hand-edited file must degrade to
 * "no history", never crash the accuracy figures.
 */

import type {
  PredictionRecordV2,
  PredictionStatus,
  SelectionType,
  SettlementAudit,
  SettlementRule,
} from './types.ts';

export const PREDICTIONS_FILENAME = 'predictions-v2.json';

/** A season of published predictions across every league sits far below this. */
export const MAX_RECORDS = 20_000;

/*
 * The accepted values, written so the compiler enforces completeness.
 *
 * These were plain arrays typed `readonly SelectionType[]`, which does not
 * catch a missing member — a subset of a union is still assignable to it. So
 * when motorsport added `finish_position` and `head_to_head`, this list was not
 * updated and nothing complained. Every Formula 1 prediction was written to
 * disk and then silently discarded on the next read: never tracked, never
 * settled, and erased from the file the next time anything else settled.
 *
 * A `Record` keyed by the union cannot miss a member. Adding one to
 * `SelectionType` is now a compile error until it is accounted for here, which
 * is the only way this stays correct without someone remembering.
 */
const SELECTION_TYPE_SET: Record<SelectionType, true> = {
  winner: true,
  double_chance: true,
  spread: true,
  total: true,
  team_total: true,
  player_performance: true,
  finish_position: true,
  head_to_head: true,
};

const STATUS_SET: Record<PredictionStatus, true> = {
  pending: true,
  live: true,
  won: true,
  lost: true,
  push: true,
  void: true,
  unsettled: true,
};

const STATUSES: readonly string[] = Object.keys(STATUS_SET);
const SELECTION_TYPES: readonly string[] = Object.keys(SELECTION_TYPE_SET);

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * A settlement rule must be intact, or the record cannot be judged.
 *
 * Rebuilding a missing rule from the label would mean settling against a line
 * the model never published, so such a record is dropped instead.
 */
export function isSettlementRule(value: unknown): value is SettlementRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Record<string, unknown>;

  switch (rule.kind) {
    case 'winner':
      return rule.side === 'home' || rule.side === 'away' || rule.side === 'draw';
    case 'double_chance':
      return (
        Array.isArray(rule.sides) &&
        rule.sides.length > 0 &&
        rule.sides.every((side) => side === 'home' || side === 'away' || side === 'draw')
      );
    case 'spread':
      return (
        (rule.side === 'home' || rule.side === 'away') &&
        typeof rule.line === 'number' &&
        Number.isFinite(rule.line)
      );
    case 'total':
      return (
        (rule.direction === 'over' || rule.direction === 'under') &&
        typeof rule.line === 'number' &&
        Number.isFinite(rule.line)
      );
    case 'team_total':
      return (
        (rule.side === 'home' || rule.side === 'away') &&
        (rule.direction === 'over' || rule.direction === 'under') &&
        typeof rule.line === 'number' &&
        Number.isFinite(rule.line)
      );
    case 'finish_position':
      return (
        typeof rule.entrant === 'string' &&
        rule.entrant.length > 0 &&
        typeof rule.within === 'number' &&
        Number.isInteger(rule.within) &&
        rule.within > 0
      );
    case 'head_to_head':
      return (
        typeof rule.entrant === 'string' &&
        rule.entrant.length > 0 &&
        typeof rule.over === 'string' &&
        rule.over.length > 0 &&
        rule.entrant !== rule.over
      );
    default:
      return false;
  }
}

export function isPredictionRecordV2(value: unknown): value is PredictionRecordV2 {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    typeof record.game_id === 'string' &&
    typeof record.sport === 'string' &&
    SELECTION_TYPES.includes(record.selection_type as string) &&
    typeof record.selection === 'string' &&
    isSettlementRule(record.settlement) &&
    isProbability(record.model_probability) &&
    isProbability(record.model_confidence) &&
    isProbability(record.data_quality) &&
    typeof record.model_version === 'string' &&
    STATUSES.includes(record.status as string) &&
    typeof record.created_at === 'string'
  );
}

/** A stored scoreline: all four fields present and finite, or nothing. */
function outcome(value: unknown): { home_score: number; away_score: number; margin: number; total: number } | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;

  const numbers = ['home_score', 'away_score', 'margin', 'total'].map((key) => raw[key]);
  if (!numbers.every((entry) => typeof entry === 'number' && Number.isFinite(entry))) {
    return null;
  }

  const [home_score, away_score, margin, total] = numbers as number[];
  return { home_score, away_score, margin, total };
}

function auditTrail(value: unknown): SettlementAudit[] {
  if (!Array.isArray(value)) return [];

  const entries: SettlementAudit[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    if (
      STATUSES.includes(entry.previous_result as string) &&
      STATUSES.includes(entry.new_result as string) &&
      typeof entry.changed_at === 'string'
    ) {
      entries.push({
        previous_result: entry.previous_result as PredictionStatus,
        new_result: entry.new_result as PredictionStatus,
        reason: typeof entry.reason === 'string' ? entry.reason : 'unknown',
        changed_at: entry.changed_at,
      });
    }
  }
  return entries;
}

/**
 * Fill in fields a record written by an earlier version does not have.
 *
 * Defaults are deliberately conservative. `final_pre_game` starts false and is
 * decided by the tracker from the record's own timestamps, never assumed — a
 * record that cannot prove it was published before kick-off must not be counted
 * in the headline figure.
 */
function withDefaults(record: Record<string, unknown>): PredictionRecordV2 {
  return {
    ...(record as unknown as PredictionRecordV2),
    final_pre_game: record.final_pre_game === true,
    parlay_id: typeof record.parlay_id === 'string' ? record.parlay_id : null,
    // Absent on anything published before results were shown on the homepage.
    // Null rather than a placeholder: the interface omits a scoreline it
    // cannot label, which is better than labelling it wrongly.
    home_team: typeof record.home_team === 'string' ? record.home_team : null,
    away_team: typeof record.away_team === 'string' ? record.away_team : null,
    projected: outcome(record.projected),
    actual: outcome(record.actual),
    attempts:
      typeof record.attempts === 'number' && Number.isFinite(record.attempts)
        ? Math.max(0, Math.floor(record.attempts))
        : 0,
    next_attempt_at:
      typeof record.next_attempt_at === 'string' ? record.next_attempt_at : null,
    audit: auditTrail(record.audit),
  };
}

/** Accepts a bare array or `{ "predictions": [...] }`, matching the older store. */
export function parsePredictions(raw: unknown): PredictionRecordV2[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { predictions?: unknown }).predictions)
      ? (raw as { predictions: unknown[] }).predictions
      : [];

  const seen = new Set<string>();
  const records: PredictionRecordV2[] = [];

  for (const item of list) {
    if (records.length >= MAX_RECORDS) break;
    if (!isPredictionRecordV2(item)) continue;
    // A duplicate id would be counted twice in every metric.
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    records.push(withDefaults(item as unknown as Record<string, unknown>));
  }

  return records;
}

/**
 * Predictions still waiting on a result.
 *
 * Kept for the diagnostics count. The settlement queue itself lives in
 * tracking.ts, which also applies the retry backoff and the correction window.
 */
export function awaitingSettlement(
  records: readonly PredictionRecordV2[],
  now: number,
): PredictionRecordV2[] {
  return records.filter((record) => {
    if (record.status !== 'pending' && record.status !== 'live' && record.status !== 'unsettled') {
      return false;
    }
    if (!record.game_start) return true;
    const start = Date.parse(record.game_start);
    return !Number.isFinite(start) || start < now;
  });
}
