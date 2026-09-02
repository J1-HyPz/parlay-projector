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
  SettlementRule,
} from './types.ts';

export const PREDICTIONS_FILENAME = 'predictions-v2.json';

/** A season of published predictions across every league sits far below this. */
export const MAX_RECORDS = 20_000;

const STATUSES: readonly PredictionStatus[] = ['pending', 'won', 'lost', 'void'];

const SELECTION_TYPES: readonly SelectionType[] = [
  'winner',
  'double_chance',
  'spread',
  'total',
  'team_total',
  'player_performance',
];

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
    (SELECTION_TYPES as readonly string[]).includes(record.selection_type as string) &&
    typeof record.selection === 'string' &&
    isSettlementRule(record.settlement) &&
    isProbability(record.model_probability) &&
    isProbability(record.model_confidence) &&
    isProbability(record.data_quality) &&
    typeof record.model_version === 'string' &&
    (STATUSES as readonly string[]).includes(record.status as string) &&
    typeof record.created_at === 'string'
  );
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
    records.push(item);
  }

  return records;
}

/**
 * Predictions still waiting on a result.
 *
 * Only those whose game has already kicked off are worth trying to settle;
 * asking the provider about tonight's fixture achieves nothing.
 */
export function awaitingSettlement(
  records: readonly PredictionRecordV2[],
  now: number,
): PredictionRecordV2[] {
  return records.filter((record) => {
    if (record.status !== 'pending') return false;
    if (!record.game_start) return true;
    const start = Date.parse(record.game_start);
    return !Number.isFinite(start) || start < now;
  });
}
