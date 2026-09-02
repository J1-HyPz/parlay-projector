/**
 * Validation for the generated-line store.
 *
 * Pure, and deliberately strict about the fields the metrics depend on: a
 * parlay whose combined probability is missing cannot be used to check whether
 * the optimiser's estimates hold up, so it is dropped rather than defaulted.
 */

import type { ParlayRecord, ParlayStatus, RiskLevel } from './types.ts';

export const PARLAYS_FILENAME = 'parlays-v1.json';

/** Far above any plausible household history. */
export const MAX_PARLAYS = 5_000;

const STATUSES: readonly ParlayStatus[] = ['pending', 'live', 'won', 'lost', 'void'];
const RISKS: readonly RiskLevel[] = ['low', 'medium', 'high'];

function isProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

export function isParlayRecord(value: unknown): value is ParlayRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;

  return (
    typeof record.id === 'string' &&
    record.id.length > 0 &&
    (RISKS as readonly string[]).includes(record.risk as string) &&
    Array.isArray(record.leg_ids) &&
    record.leg_ids.length > 0 &&
    record.leg_ids.every((id) => typeof id === 'string') &&
    isProbability(record.combined_probability) &&
    typeof record.model_version === 'string' &&
    typeof record.created_at === 'string' &&
    (STATUSES as readonly string[]).includes(record.status as string)
  );
}

export function parseParlays(raw: unknown): ParlayRecord[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { parlays?: unknown }).parlays)
      ? (raw as { parlays: unknown[] }).parlays
      : [];

  const seen = new Set<string>();
  const records: ParlayRecord[] = [];

  for (const item of list) {
    if (records.length >= MAX_PARLAYS) break;
    if (!isParlayRecord(item)) continue;
    // A duplicate would be counted twice in the success rate.
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    records.push(item);
  }

  return records;
}
