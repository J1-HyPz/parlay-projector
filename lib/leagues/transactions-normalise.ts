/**
 * Normalising ESPN transactions into one model that covers every sport.
 *
 * One model, not one per competition: a trade, a transfer and a waiver claim
 * are the same shape of event with different words attached.
 *
 * What the provider actually supplies, verified against the core API, is
 * modest: a date, a free-text description, and a `$ref` to the team. There is
 * no structured player, no from/to pair, and no fee anywhere — including for
 * football, which publishes no transactions at all. So:
 *
 *   - `type` is classified from the description's opening verb, and falls back
 *     to `other` rather than guessing.
 *   - `team` is resolved by pulling the id out of the `$ref` URL and joining
 *     against the league's team list, which is already cached. Following each
 *     `$ref` would cost one request per row.
 *   - `player` and `fee` stay absent. They are in the model because other
 *     providers supply them, not because these values are inferred from prose.
 *
 * Pure and testable.
 */

import type { TeamProfile } from './types';

export type TransactionType =
  | 'trade'
  | 'transfer'
  | 'loan'
  | 'free-agent-signing'
  | 'waiver'
  | 'release'
  | 'contract-extension'
  | 'roster-move'
  | 'injured-list'
  | 'call-up'
  | 'other';

export interface TransactionTeam {
  id: string | null;
  name: string;
  logo: string | null;
}

export interface Transaction {
  id: string;
  league_id: string;
  type: TransactionType;
  /** ISO-8601 instant. */
  date: string;
  /** The team the provider filed this move under. */
  team: TransactionTeam | null;
  /** The provider's own wording. Never rewritten, only classified. */
  description: string;
}

export interface RawTransaction {
  date?: unknown;
  description?: unknown;
  team?: { $ref?: unknown };
}

export interface RawTransactionsResponse {
  count?: unknown;
  items?: RawTransaction[] | null;
}

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Classify a transaction from its description.
 *
 * Ordered deliberately: "Signed ... to a contract extension" is an extension,
 * not a signing, so the more specific phrases are tested first. Anything
 * unrecognised is `other` — the description is still shown in full, so an
 * unclassified row loses a label, not its meaning.
 */
export function classifyTransaction(description: string): TransactionType {
  const text = description.toLowerCase();

  if (text.includes('extension') || text.includes('re-signed')) return 'contract-extension';
  if (text.includes('injured list') || text.includes('injured reserve')) return 'injured-list';
  if (text.includes('recalled') || text.includes('called up')) return 'call-up';
  if (text.includes('loan')) return 'loan';
  if (text.includes('waiv')) return 'waiver';
  if (text.includes('traded') || text.includes('acquired') || text.includes('exchange')) {
    return 'trade';
  }
  if (text.includes('released')) return 'release';
  if (text.includes('free agent')) return 'free-agent-signing';
  if (text.includes('signed')) return 'free-agent-signing';
  if (text.includes('transfer')) return 'transfer';
  if (text.includes('activated') || text.includes('assigned') || text.includes('promoted')) {
    return 'roster-move';
  }
  return 'other';
}

/**
 * Team id out of a core-API `$ref`.
 *
 * The URL looks like `.../seasons/2026/teams/26?lang=en`, so the segment after
 * `teams` is the id.
 */
export function teamIdFromRef(ref: unknown): string | null {
  const url = str(ref);
  if (!url) return null;
  const match = /\/teams\/([0-9]+)(?:[/?]|$)/.exec(url);
  return match ? match[1] : null;
}

export function normaliseTransaction(
  raw: RawTransaction | null | undefined,
  leagueId: string,
  teams: ReadonlyMap<string, TeamProfile>,
  index: number,
): Transaction | null {
  if (!raw || typeof raw !== 'object') return null;

  const description = str(raw.description);
  const rawDate = str(raw.date);
  if (!description || !rawDate) return null;

  const instant = new Date(rawDate);
  if (Number.isNaN(instant.getTime())) return null;

  const teamId = teamIdFromRef(raw.team?.$ref);
  const profile = teamId ? teams.get(teamId) : undefined;

  return {
    // The feed carries no id of its own, so one is derived from the fields that
    // identify the row. Stable enough for a React key and for de-duplication.
    id: `${leagueId}-${instant.toISOString()}-${teamId ?? 'na'}-${index}`,
    league_id: leagueId,
    type: classifyTransaction(description),
    date: instant.toISOString(),
    team: profile
      ? { id: profile.id, name: profile.name, logo: profile.logo }
      : teamId
        ? { id: teamId, name: `Team ${teamId}`, logo: null }
        : null,
    description,
  };
}

export function normaliseTransactions(
  payload: RawTransactionsResponse | null | undefined,
  leagueId: string,
  teams: readonly TeamProfile[],
): Transaction[] {
  const items = payload?.items;
  if (!Array.isArray(items)) return [];

  const index = new Map(teams.map((team) => [team.id, team]));

  const transactions: Transaction[] = [];
  for (const [position, raw] of items.entries()) {
    const transaction = normaliseTransaction(raw, leagueId, index, position);
    if (transaction) transactions.push(transaction);
  }

  // Newest first.
  return transactions.sort((a, b) => b.date.localeCompare(a.date));
}

/** Human label for a type, for the badge on a row. */
export const TRANSACTION_TYPE_LABEL: Record<TransactionType, string> = {
  trade: 'Trade',
  transfer: 'Transfer',
  loan: 'Loan',
  'free-agent-signing': 'Signing',
  waiver: 'Waiver',
  release: 'Release',
  'contract-extension': 'Extension',
  'roster-move': 'Roster move',
  'injured-list': 'Injury list',
  'call-up': 'Call-up',
  other: 'Move',
};
