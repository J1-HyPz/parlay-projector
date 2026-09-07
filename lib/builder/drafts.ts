import { CURRENCIES, MAX_LEGS } from './types.ts';
import type { BetSelection, BuilderLine } from './types.ts';
import { calculateLine } from './line.ts';

export const BUILDER_STORAGE_KEY = 'parlay-projector.builder.v1';
export const DRAFT_VERSION = 1;
export interface SavedDraft {
  id: string;
  savedAt: string;
  line: BuilderLine;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && v.length <= max;
const date = (v: unknown) => text(v, 50) && Number.isFinite(Date.parse(v));

export function parseSelection(raw: unknown): BetSelection | null {
  if (
    !record(raw) ||
    !record(raw.event) ||
    !record(raw.bookmaker) ||
    !record(raw.settlement)
  )
    return null;
  for (const key of [
    'id',
    'provider',
    'marketId',
    'outcomeId',
    'market',
    'marketName',
    'outcome',
    'period',
  ])
    if (!text(raw[key]) || !raw[key]) return null;
  for (const key of [
    'id',
    'providerEventId',
    'sport',
    'competition',
    'name',
    'home',
    'away',
  ])
    if (!text(raw.event[key])) return null;
  if (!/^(?:\d{1,20}|espn-[a-z0-9-]+-\d{1,20})$/.test(raw.event.id as string))
    return null;
  if (!text(raw.bookmaker.id) || !raw.bookmaker.id || !text(raw.bookmaker.name))
    return null;
  if (
    !text(raw.settlement.key) ||
    !text(raw.settlement.label) ||
    !['regulation', 'including_overtime', 'unknown'].includes(
      raw.settlement.scope as string,
    )
  )
    return null;
  if (
    !['prematch', 'live', 'closed', 'unknown'].includes(
      raw.event.status as string,
    )
  )
    return null;
  if (raw.event.startTime !== null && !date(raw.event.startTime)) return null;
  if (
    raw.line !== null &&
    (typeof raw.line !== 'number' || !Number.isFinite(raw.line))
  )
    return null;
  if (
    raw.decimal !== null &&
    (typeof raw.decimal !== 'number' ||
      !Number.isFinite(raw.decimal) ||
      raw.decimal <= 1)
  )
    return null;
  if (
    ![null, 'home', 'away', 'draw'].includes(raw.side as null) ||
    ![null, 'over', 'under'].includes(raw.direction as null)
  )
    return null;
  if (
    !['available', 'reference', 'suspended', 'unavailable'].includes(
      raw.availability as string,
    )
  )
    return null;
  if (
    !date(raw.fetchedAt) ||
    !date(raw.expiresAt) ||
    (raw.quotedAt !== null && !date(raw.quotedAt))
  )
    return null;
  // Reconstruct only contract fields; discard any extra client-supplied payload.
  return {
    id: raw.id as string,
    provider: raw.provider as string,
    event: {
      id: raw.event.id as string,
      providerEventId: raw.event.providerEventId as string,
      sport: raw.event.sport as string,
      competition: raw.event.competition as string,
      name: raw.event.name as string,
      home: raw.event.home as string,
      away: raw.event.away as string,
      startTime: raw.event.startTime as string | null,
      status: raw.event.status as BetSelection['event']['status'],
    },
    bookmaker: {
      id: raw.bookmaker.id as string,
      name: raw.bookmaker.name as string,
    },
    marketId: raw.marketId as string,
    outcomeId: raw.outcomeId as string,
    market: raw.market as string,
    marketName: raw.marketName as string,
    outcome: raw.outcome as string,
    side: raw.side as BetSelection['side'],
    direction: raw.direction as BetSelection['direction'],
    line: raw.line as number | null,
    period: raw.period as string,
    settlement: {
      key: raw.settlement.key as string,
      label: raw.settlement.label as string,
      scope: raw.settlement.scope as BetSelection['settlement']['scope'],
    },
    decimal: raw.decimal as number | null,
    quotedAt: raw.quotedAt as string | null,
    fetchedAt: raw.fetchedAt as string,
    expiresAt: raw.expiresAt as string,
    availability: raw.availability as BetSelection['availability'],
  };
}

export function restoreLine(raw: unknown): BuilderLine | null {
  if (
    !record(raw) ||
    !text(raw.name, 100) ||
    !text(raw.bookmakerId) ||
    !text(raw.stake, 20) ||
    !CURRENCIES.includes(raw.currency as (typeof CURRENCIES)[number]) ||
    !Array.isArray(raw.legs) ||
    raw.legs.length > MAX_LEGS
  )
    return null;
  const legs: BuilderLine['legs'] = [];
  const seen = new Set<string>();
  for (const value of raw.legs) {
    const selection = record(value) ? parseSelection(value.selection) : null;
    if (!selection || seen.has(selection.id)) return null;
    seen.add(selection.id);
    legs.push({
      selection,
      state: 'unverified',
      pending: null,
      checkedAt: null,
      reason: 'Restored draft — revalidating availability and prices.',
    });
  }
  return {
    name: raw.name,
    bookmakerId: raw.bookmakerId,
    stake: raw.stake,
    currency: raw.currency as string,
    legs,
  };
}

export function restoreActive(raw: string | null): BuilderLine | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    return record(value) && value.version === DRAFT_VERSION
      ? restoreLine(value.line)
      : null;
  } catch {
    return null;
  }
}

export function exportLine(line: BuilderLine, now = Date.now()): string {
  const price = calculateLine(line, null, now);
  return [
    line.name,
    `Bookmaker: ${line.legs.find((l) => l.selection.bookmaker.id === line.bookmakerId)?.selection.bookmaker.name ?? 'Not selected'}`,
    ...line.legs.map((leg, i) => {
      const s = leg.selection;
      return `${i + 1}. ${s.event.name} | ${s.event.competition} | ${s.event.startTime ?? 'Start TBC'} | ${s.event.status}\n   ${s.marketName}: ${s.outcome}${s.line === null ? '' : ` (line ${s.line})`} | ${s.period} | ${s.settlement.label}\n   ${s.bookmaker.name}: ${s.decimal ?? 'Unavailable'} decimal | Odds timestamp: ${s.quotedAt ?? 'Not supplied'} | Retrieved: ${s.fetchedAt} | ${leg.state}`;
    }),
    `Stake: ${line.currency} ${line.stake}`,
    `Estimated return including stake: ${price.totalReturn === null ? 'Unavailable' : `${line.currency} ${price.totalReturn.toFixed(2)}`}`,
    `Estimated net profit: ${price.profit === null ? 'Unavailable' : `${line.currency} ${price.profit.toFixed(2)}`}`,
    price.label,
    ...price.issues,
    'Preparation only. No wager has been placed.',
  ].join('\n');
}
