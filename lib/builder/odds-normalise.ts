import type { BetSelection, BuilderEvent } from './types.ts';

export interface RawOddsEvent {
  id?: unknown;
  sport_key?: unknown;
  commence_time?: unknown;
  home_team?: unknown;
  away_team?: unknown;
  bookmakers?: {
    key?: unknown;
    title?: unknown;
    last_update?: unknown;
    markets?: {
      key?: unknown;
      last_update?: unknown;
      outcomes?: { name?: unknown; price?: unknown; point?: unknown }[];
    }[];
  }[];
}
export const ODDS_SPORTS: Record<string, string> = {
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  cfl: 'americanfootball_cfl',
  nba: 'basketball_nba',
  wnba: 'basketball_wnba',
  ncaam: 'basketball_ncaab',
  ncaaw: 'basketball_wncaab',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  epl: 'soccer_epl',
  championship: 'soccer_efl_champ',
  'league-one': 'soccer_england_league1',
  ucl: 'soccer_uefa_champs_league',
  uel: 'soccer_uefa_europa_league',
  uecl: 'soccer_uefa_europa_conference_league',
  laliga: 'soccer_spain_la_liga',
  bundesliga: 'soccer_germany_bundesliga',
  seriea: 'soccer_italy_serie_a',
};
const nameKey = (s: unknown) =>
  typeof s === 'string'
    ? s
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
    : '';
const stamp = (v: unknown): string | null =>
  typeof v === 'string' && Number.isFinite(Date.parse(v))
    ? new Date(v).toISOString()
    : null;
const id = (...parts: (string | number | null)[]) =>
  parts.map((v) => encodeURIComponent(String(v ?? 'none'))).join(':');

/** Exact normalized teams, orientation and five-minute start window. Never fuzzy-match a bet. */
export function matchOddsEvent(
  event: BuilderEvent,
  candidates: RawOddsEvent[],
  sportKey: string,
): RawOddsEvent | null {
  if (!event.home || !event.away || !event.startTime) return null;
  const matches = candidates.filter(
    (c) =>
      c &&
      c.sport_key === sportKey &&
      typeof c.id === 'string' &&
      nameKey(c.home_team) === nameKey(event.home) &&
      nameKey(c.away_team) === nameKey(event.away) &&
      typeof c.commence_time === 'string' &&
      Math.abs(Date.parse(c.commence_time) - Date.parse(event.startTime!)) <=
        5 * 60_000,
  );
  return matches.length === 1 ? matches[0] : null;
}

export function normaliseBuilderOdds(
  raw: RawOddsEvent,
  event: BuilderEvent,
  fetchedAt: string,
  maxAgeMs: number,
): BetSelection[] {
  if (typeof raw.id !== 'string' || !Array.isArray(raw.bookmakers)) return [];
  const selections = new Map<string, BetSelection>();
  for (const book of raw.bookmakers) {
    if (
      !book ||
      typeof book.key !== 'string' ||
      !book.key ||
      typeof book.title !== 'string' ||
      !Array.isArray(book.markets)
    )
      continue;
    for (const market of book.markets) {
      if (
        !market ||
        !['h2h', 'spreads', 'totals'].includes(market.key as string) ||
        !Array.isArray(market.outcomes)
      )
        continue;
      const key = market.key as string;
      const hasDraw = market.outcomes.some((o) => o?.name === 'Draw');
      // Outcome structure separates two-way and three-way markets; it does NOT establish overtime rules.
      const settlementKey = id(
        'the-odds-api',
        book.key,
        key,
        hasDraw ? 'with-draw' : 'without-draw',
        'rules-unspecified',
      );
      for (const outcome of market.outcomes) {
        if (
          !outcome ||
          typeof outcome.name !== 'string' ||
          typeof outcome.price !== 'number' ||
          !Number.isFinite(outcome.price) ||
          outcome.price <= 1
        )
          continue;
        const side =
          outcome.name === raw.home_team
            ? 'home'
            : outcome.name === raw.away_team
              ? 'away'
              : outcome.name === 'Draw'
                ? 'draw'
                : null;
        const direction =
          outcome.name === 'Over'
            ? 'over'
            : outcome.name === 'Under'
              ? 'under'
              : null;
        if (
          (key === 'h2h' && !side) ||
          (key === 'spreads' && (!side || side === 'draw')) ||
          (key === 'totals' && !direction)
        )
          continue;
        const line =
          key === 'h2h'
            ? null
            : typeof outcome.point === 'number' &&
                Number.isFinite(outcome.point)
              ? outcome.point
              : null;
        if (key !== 'h2h' && line === null) continue;
        const groupLine =
          key === 'spreads' ? (side === 'away' ? -line! : line) : line;
        const marketId = id(
          'the-odds-api',
          raw.id,
          book.key,
          key,
          groupLine,
          settlementKey,
        );
        const outcomeId = id(outcome.name, line);
        const selectionId = id(marketId, outcomeId);
        const quotedAt = stamp(market.last_update) ?? stamp(book.last_update);
        const marketName =
          key === 'h2h'
            ? hasDraw
              ? 'Match result (3-way)'
              : 'Match winner (2-way)'
            : key === 'totals'
              ? 'Game total'
              : event.sport === 'mlb'
                ? 'Run line'
                : event.sport === 'nhl'
                  ? 'Puck line'
                  : 'Handicap / spread';
        selections.set(selectionId, {
          id: selectionId,
          provider: 'the-odds-api',
          event: { ...event, providerEventId: raw.id },
          bookmaker: { id: `the-odds-api:${book.key}`, name: book.title },
          marketId,
          outcomeId,
          market: key,
          marketName,
          outcome: outcome.name,
          side,
          direction,
          line,
          period: 'full_game',
          settlement: {
            key: settlementKey,
            scope: 'unknown',
            label:
              'Bookmaker featured market; regulation / overtime rules not supplied',
          },
          decimal: outcome.price,
          quotedAt,
          fetchedAt,
          expiresAt: new Date(
            (quotedAt ? Date.parse(quotedAt) : 0) + maxAgeMs,
          ).toISOString(),
          availability: quotedAt ? 'available' : 'reference',
        });
      }
    }
  }
  return [...selections.values()];
}
