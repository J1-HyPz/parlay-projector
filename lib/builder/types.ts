/** Builder contracts are independent of the sports-information and projection APIs. */
export interface BuilderEvent {
  id: string;
  providerEventId: string;
  sport: string;
  competition: string;
  name: string;
  home: string;
  away: string;
  startTime: string | null;
  status: 'prematch' | 'live' | 'closed' | 'unknown';
}

export interface BetSelection {
  id: string;
  provider: string;
  event: BuilderEvent;
  bookmaker: { id: string; name: string };
  marketId: string;
  outcomeId: string;
  market: string;
  marketName: string;
  outcome: string;
  side: 'home' | 'away' | 'draw' | null;
  direction: 'over' | 'under' | null;
  line: number | null;
  /** Never coalesce markets across period or settlement identities. */
  period: string;
  settlement: {
    key: string;
    label: string;
    scope: 'regulation' | 'including_overtime' | 'unknown';
  };
  decimal: number | null;
  /** Provider odds timestamp, never replaced by retrieval time. */
  quotedAt: string | null;
  fetchedAt: string;
  expiresAt: string;
  availability: 'available' | 'reference' | 'suspended' | 'unavailable';
}

export interface MarketResponse {
  event: BuilderEvent | null;
  provider: string;
  selections: BetSelection[];
  fetchedAt: string;
  stale: boolean;
  message: string | null;
}

export interface BuilderLeg {
  selection: BetSelection;
  state: 'unverified' | 'current' | 'changed' | 'unavailable';
  /** Updated quote remains pending until the user accepts it. */
  pending: BetSelection | null;
  checkedAt: string | null;
  reason: string | null;
}

export interface BuilderLine {
  name: string;
  bookmakerId: string;
  stake: string;
  currency: string;
  legs: BuilderLeg[];
}

/** Only a real combination service may construct this server-side response. */
export interface CombinationQuote {
  id: string;
  bookmakerId: string;
  selectionIds: string[];
  decimal: number;
  quotedAt: string;
  expiresAt: string;
}

export interface OddsProvider {
  id: string;
  markets(gameId: string): Promise<MarketResponse>;
  quoteCombination?(
    bookmakerId: string,
    selections: BetSelection[],
  ): Promise<CombinationQuote | null>;
}

export interface LegEvidence {
  gameId: string;
  facts: string[];
  gaps: string[];
  fetchedAt: string;
}

export const MAX_LEGS = 12;
export const CURRENCIES = ['GBP', 'USD', 'EUR', 'CAD', 'AUD'] as const;
export function emptyLine(): BuilderLine {
  return {
    name: 'Untitled line',
    bookmakerId: '',
    stake: '10',
    currency: 'GBP',
    legs: [],
  };
}
