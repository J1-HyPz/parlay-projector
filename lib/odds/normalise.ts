/**
 * Turning a provider's odds payload into normalised markets.
 *
 * The sports feed the application already uses carries bookmaker prices
 * alongside the fixtures. Those prices are read here, deliberately and in one
 * place, into the provider-independent shape in `lib/markets/types.ts`.
 *
 * This does not undo the betting-data strip in the fixtures adapter. That
 * boundary still holds: a `Game` has no odds on it and never will. Prices live
 * in their own model and are joined to a fixture by id, so nothing downstream
 * can accidentally read a price it did not ask for.
 *
 * What is read, and nothing beyond it:
 *
 *   moneyline    home / away / draw
 *   pointSpread  home and away, with the line each is quoted at
 *   total        over and under, with the line
 *
 * The feed also carries deep links into a sportsbook's bet slip. Those are
 * dropped: this application is not a route to placing a bet, and passing the
 * links through would make it one.
 *
 * Pure. No network, no configuration.
 */

import { parseAmerican, parseLine, priceFromAmerican, removeMargin } from '../markets/price.ts';
import type { GameMarkets, QuotedMarket, SettlementRule, Side } from '../markets/types.ts';

// ---------------------------------------------------------------------------
// The untrusted payload
// ---------------------------------------------------------------------------

/** One side of a market, as the feed reports it. */
interface RawSide {
  open?: { line?: unknown; odds?: unknown } | null;
  close?: { line?: unknown; odds?: unknown } | null;
}

export interface RawOdds {
  provider?: { name?: unknown; displayName?: unknown } | null;
  moneyline?: { home?: RawSide; away?: RawSide; draw?: RawSide } | null;
  pointSpread?: { home?: RawSide; away?: RawSide } | null;
  total?: { over?: RawSide; under?: RawSide } | null;
  /** Present on some payloads as a bare number rather than a priced side. */
  overUnder?: unknown;
  spread?: unknown;
  /** A summary string such as `SEA -3.5`. Read for nothing; the structured
   *  fields above are authoritative and this only ever restates them. */
  details?: unknown;
}

export interface RawOddsEvent {
  id?: unknown;
  competitions?: { odds?: RawOdds[] | null }[] | null;
}

export interface RawOddsResponse {
  events?: RawOddsEvent[] | null;
}

// ---------------------------------------------------------------------------
// Reading a side
// ---------------------------------------------------------------------------

/**
 * The current price for a side.
 *
 * `close` is the live quote and `open` is where the market started, so `close`
 * is preferred and `open` is only a fallback. Neither is invented: a side with
 * no readable price yields nothing, and the market is simply reported as one
 * we do not have.
 */
function readSide(side: RawSide | undefined | null): { american: number; line: number | null } | null {
  if (!side) return null;

  for (const quote of [side.close, side.open]) {
    if (!quote) continue;
    const american = parseAmerican(quote.odds);
    if (american === null) continue;
    return { american, line: parseLine(quote.line) };
  }
  return null;
}

function providerName(odds: RawOdds): string | null {
  const raw = odds.provider?.displayName ?? odds.provider?.name;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

interface Draft {
  market: QuotedMarket['market'];
  selection: string;
  side: Side | null;
  direction: QuotedMarket['direction'];
  line: number | null;
  american: number;
  settlement: SettlementRule;
}

/**
 * Every market we can read from one odds block.
 *
 * The three market groups are de-vigged independently, because they are
 * independent markets: the margin on a moneyline says nothing about the margin
 * on the total. A group missing a side is left without a fair probability
 * rather than being de-vigged against an assumed one.
 */
export function normaliseOdds(
  odds: RawOdds,
  gameId: string,
  fetchedAt: string,
): GameMarkets | null {
  const source = providerName(odds);
  if (!source) return null;

  const groups: Draft[][] = [];

  // --- moneyline ----------------------------------------------------------
  const moneyline: Draft[] = [];
  for (const side of ['home', 'away', 'draw'] as const) {
    const quote = readSide(odds.moneyline?.[side]);
    if (!quote) continue;
    moneyline.push({
      market: 'moneyline',
      selection: side,
      side,
      direction: null,
      line: null,
      american: quote.american,
      settlement: { kind: 'winner', side },
    });
  }
  if (moneyline.length > 0) groups.push(moneyline);

  // --- spread -------------------------------------------------------------
  const spread: Draft[] = [];
  for (const side of ['home', 'away'] as const) {
    const quote = readSide(odds.pointSpread?.[side]);
    // A handicap without its line is unusable: the price alone does not say
    // what the bet is.
    if (!quote || quote.line === null) continue;
    spread.push({
      market: 'spread',
      selection: side,
      side,
      direction: null,
      line: quote.line,
      american: quote.american,
      settlement: { kind: 'spread', side, line: quote.line },
    });
  }
  if (spread.length > 0) groups.push(spread);

  // --- total --------------------------------------------------------------
  const total: Draft[] = [];
  for (const direction of ['over', 'under'] as const) {
    const quote = readSide(odds.total?.[direction]);
    const line = quote?.line ?? parseLine(odds.overUnder);
    if (!quote || line === null) continue;
    total.push({
      market: 'total',
      selection: direction,
      side: null,
      direction,
      line,
      american: quote.american,
      settlement: { kind: 'total', direction, line },
    });
  }
  if (total.length > 0) groups.push(total);

  const markets: QuotedMarket[] = [];

  for (const group of groups) {
    const priced = group
      .map((draft) => ({ draft, price: priceFromAmerican(draft.american) }))
      .filter((entry): entry is { draft: Draft; price: NonNullable<typeof entry.price> } =>
        entry.price !== null,
      );
    if (priced.length === 0) continue;

    for (const { draft, price } of priced) {
      markets.push({
        market: draft.market,
        period: 'full_game',
        selection: draft.selection,
        side: draft.side,
        direction: draft.direction,
        line: draft.line,
        price,
        source,
        fetchedAt,
        settlement: draft.settlement,
      });
    }
  }

  if (markets.length === 0) return null;
  return { gameId, source, fetchedAt, markets };
}

/**
 * The margin and fair probabilities for one market group within a fixture.
 *
 * Computed on demand rather than stored, because it depends on which sides
 * were actually readable — and a caller asking about one selection needs the
 * whole group to answer.
 */
export function fairProbabilityFor(
  game: GameMarkets,
  target: QuotedMarket,
): { fair: number; margin: number } | null {
  const group = game.markets.filter(
    (entry) =>
      entry.market === target.market &&
      entry.period === target.period &&
      // A spread group is only comparable at the same line, and a total group
      // likewise. Different lines are different markets.
      Math.abs((entry.line ?? 0) - (target.line ?? 0)) < 1e-9,
  );

  // A spread is quoted as ±L, so the two sides carry opposite lines and the
  // filter above splits them. Pair them back up by absolute line.
  const paired =
    target.market === 'spread'
      ? game.markets.filter(
          (entry) =>
            entry.market === 'spread' &&
            Math.abs(Math.abs(entry.line ?? 0) - Math.abs(target.line ?? 0)) < 1e-9,
        )
      : group;

  if (paired.length < 2) return null;

  const index = paired.findIndex(
    (entry) => entry.selection === target.selection && entry.line === target.line,
  );
  if (index < 0) return null;

  const removed = removeMargin(paired.map((entry) => entry.price.implied));
  if (!removed) return null;

  return { fair: removed.fair[index], margin: removed.margin };
}

/**
 * Markets for every fixture in a scoreboard payload, keyed by game id.
 *
 * `makeGameId` is passed in so this stays free of the league catalogue and can
 * be tested without it.
 */
export function normaliseOddsResponse(
  payload: RawOddsResponse,
  makeGameId: (eventId: string) => string,
  fetchedAt: string,
): Map<string, GameMarkets> {
  const byGame = new Map<string, GameMarkets>();

  for (const event of payload.events ?? []) {
    const eventId =
      typeof event.id === 'string'
        ? event.id
        : typeof event.id === 'number'
          ? String(event.id)
          : null;
    if (!eventId) continue;

    const blocks = event.competitions?.[0]?.odds;
    if (!Array.isArray(blocks) || blocks.length === 0) continue;

    /*
     * The feed may carry several books. The first is taken rather than the
     * best price being hunted across them: presenting the most generous quote
     * from each book as though it were one offer would describe a bet that
     * does not exist anywhere.
     */
    for (const block of blocks) {
      const markets = normaliseOdds(block, makeGameId(eventId), fetchedAt);
      if (markets) {
        byGame.set(markets.gameId, markets);
        break;
      }
    }
  }

  return byGame;
}
