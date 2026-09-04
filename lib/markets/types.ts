/**
 * Betting markets, independent of any provider.
 *
 * The application previously had one idea of a "selection" that quietly mixed
 * four different things together: what the model predicts, what kind of bet it
 * is, which line it is at, and whether anyone actually offers it. Reading a leg
 * meant untangling those by eye.
 *
 * They are separate here:
 *
 *   MarketType     the kind of bet          Run Line
 *   MarketPeriod   which part of the game   Full game
 *   line           the number attached      +1.5
 *   Availability   is it really offered     verified against DraftKings
 *   Price          what it pays             1.40
 *
 * A model probability is none of these. It is Parlay Projector's own estimate
 * of an outcome, and it is carried separately so the two can never be read as
 * the same claim.
 *
 * Pure types and constants. No provider names are hard-coded as a source: a
 * price records the book that quoted it, whichever that turns out to be.
 */

// ---------------------------------------------------------------------------
// Market identity
// ---------------------------------------------------------------------------

/**
 * Kinds of market.
 *
 * Named for what they are rather than for one sport's vocabulary, so a single
 * settlement path serves all of them. The reader still sees the familiar name
 * for their sport — a spread is a "Run Line" in baseball and a "Puck Line" in
 * hockey — but that is a display concern, handled in `explain.ts`.
 *
 * Player markets are deliberately absent. See `docs/betting-markets.md`: this
 * application has no player statistics, no lineups and no prop prices, so there
 * is nothing to model and nothing to verify against.
 */
export type MarketType =
  | 'moneyline'
  | 'spread'
  | 'total'
  | 'team_total'
  | 'double_chance'
  /** Motorsport: a competitor finishing inside a given position. */
  | 'finish_position'
  /** Motorsport: one competitor classified ahead of another. */
  | 'head_to_head';

export const MARKET_TYPES: readonly MarketType[] = [
  'moneyline',
  'spread',
  'total',
  'team_total',
  'double_chance',
  'finish_position',
  'head_to_head',
];

/**
 * Which portion of the match a market settles on.
 *
 * Only `full_game` is produced. Half and quarter markets are listed nowhere
 * because the model simulates whole games — it has no notion of a first half,
 * so a first-half line would be a number with nothing behind it.
 */
export type MarketPeriod = 'full_game';

/** Which side of a two-way market is being backed. */
export type Direction = 'over' | 'under';

/** A side of the fixture, or the draw where the sport has one. */
export type Side = 'home' | 'away' | 'draw';

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

/**
 * Everything needed to judge a selection once the game has finished.
 *
 * Frozen when a prediction is published and never recomputed, so a result is
 * always judged against the line that was actually published. Recomputing it
 * later from a moved line would silently change the target.
 *
 * Lives here rather than in the projection layer because it is a property of
 * the *market*, not of the model: two different models betting the same line
 * settle identically.
 */
export type SettlementRule =
  | { kind: 'winner'; side: Side }
  | { kind: 'double_chance'; sides: Side[] }
  | { kind: 'spread'; side: 'home' | 'away'; line: number }
  | { kind: 'total'; direction: Direction; line: number }
  | { kind: 'team_total'; side: 'home' | 'away'; direction: Direction; line: number }
  /**
   * A competitor classified no worse than `within`.
   *
   * One rule covers every finishing market a race has: 1 is the win, 3 the
   * podium, 5 a top five, 10 a points finish. `entrant` is the competitor's
   * name as the provider published it, frozen with the prediction like every
   * other settlement input.
   */
  | { kind: 'finish_position'; entrant: string; within: number }
  /** One competitor classified ahead of another in the same session. */
  | { kind: 'head_to_head'; entrant: string; over: string };

/** The market a settlement rule belongs to. */
export function marketTypeOf(rule: SettlementRule): MarketType {
  switch (rule.kind) {
    case 'winner':
      return 'moneyline';
    case 'double_chance':
      return 'double_chance';
    case 'spread':
      return 'spread';
    case 'total':
      return 'total';
    case 'team_total':
      return 'team_total';
    case 'finish_position':
      return 'finish_position';
    case 'head_to_head':
      return 'head_to_head';
  }
}

/**
 * How many places a finishing market covers, by its familiar name.
 *
 * Only these are produced. A "top seven" is arithmetically as easy but nobody
 * offers one, and generating markets purely to have more of them is the habit
 * this application avoids.
 */
export const FINISH_MARKETS: readonly { within: number; label: string }[] = [
  { within: 1, label: 'Race Winner' },
  { within: 3, label: 'Podium Finish' },
  { within: 5, label: 'Top 5 Finish' },
  { within: 10, label: 'Points Finish' },
];

export function finishMarketLabel(within: number): string {
  return FINISH_MARKETS.find((entry) => entry.within === within)?.label ?? `Top ${within} Finish`;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * A quoted price, in the three notations people actually use.
 *
 * Decimal is the source of truth — it is the one the arithmetic works in.
 * The other two are derived for display and are never computed from.
 */
export interface Price {
  decimal: number;
  /** e.g. `-175`, `+145`. */
  american: number;
  /** e.g. `4/7`, `13/8`. Approximate by nature; decimal is authoritative. */
  fractional: string;
  /**
   * What the price implies, `1 / decimal`.
   *
   * Includes the bookmaker's margin, so the implied probabilities across a
   * market sum to more than 1. That is not an error — it is how a book makes
   * money, and hiding it would misrepresent the comparison.
   */
  implied: number;
}

/**
 * Where a market came from, and whether it can actually be backed.
 *
 * The distinction the whole redesign turns on. `verified` means a real book
 * was quoting this exact line when we last looked. `model_only` means Parlay
 * Projector derived the line from its own simulations and *nobody has
 * confirmed it is offered anywhere*.
 *
 * The second is legitimate analysis. It is never presented as a placeable bet.
 */
export type Availability = 'verified' | 'model_only';

/**
 * A market as offered by a book.
 *
 * `source` records who quoted it. Nothing in this application assumes a
 * particular bookmaker, and no book is contacted directly — prices arrive
 * through the existing sports data feed alongside the fixtures.
 */
export interface QuotedMarket {
  market: MarketType;
  period: MarketPeriod;
  /** Which side or direction this quote is for. */
  selection: string;
  side: Side | null;
  direction: Direction | null;
  /** The handicap or total. Null for a market that has no line. */
  line: number | null;
  price: Price;
  /** The book that quoted it, e.g. `DraftKings`. */
  source: string;
  /** When this quote was read from the feed. */
  fetchedAt: string;
  /** The settlement rule this quote corresponds to. */
  settlement: SettlementRule;
}

/** Every quoted market for one fixture. */
export interface GameMarkets {
  gameId: string;
  source: string;
  fetchedAt: string;
  markets: QuotedMarket[];
}

/**
 * How stale a quote may be before it stops being shown as verified.
 *
 * Prices move. Presenting a two-hour-old line as "available now" would be a
 * quiet falsehood, so past this age a market falls back to being reported as
 * unconfirmed rather than being silently reused.
 */
export const MAX_QUOTE_AGE_MS = 30 * 60_000;

export function quoteIsFresh(fetchedAt: string, now = Date.now()): boolean {
  const at = Date.parse(fetchedAt);
  if (!Number.isFinite(at)) return false;
  return now - at <= MAX_QUOTE_AGE_MS;
}

// ---------------------------------------------------------------------------
// The market attached to a selection
// ---------------------------------------------------------------------------

/**
 * Everything about the *bet* side of a selection.
 *
 * Sits beside the model's probability rather than mixed into it. A reader can
 * answer "what is this bet, and can I place it?" from this object alone,
 * without needing to know anything about the model.
 */
export interface MarketContext {
  type: MarketType;
  period: MarketPeriod;
  /** Sport-appropriate market name, e.g. `Run Line`. */
  label: string;
  /** The selection in a book's terms, e.g. `Houston Astros +1.5`. */
  selection: string;
  line: number | null;
  availability: Availability;
  /** Present only when `availability` is `verified`. */
  price: Price | null;
  /** The book that quoted it. Null when model-derived. */
  source: string | null;
  fetchedAt: string | null;
  /**
   * The market's own probability with the bookmaker's margin removed.
   *
   * A book quoting both sides of a market prices them to sum above 100%. The
   * difference is its margin, and comparing a model probability against the
   * raw implied figure charges the model for it. This is the fairer
   * comparison, and both are shown.
   *
   * Null when only one side of the market is known, since the margin cannot
   * be removed without both.
   */
  fairProbability: number | null;
  /** The book's margin on this market, as a fraction. Null when unknown. */
  margin: number | null;
}
