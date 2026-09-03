/**
 * Odds arithmetic.
 *
 * Three notations describe the same thing, and people are fluent in different
 * ones: decimal (2.50), fractional (3/2) and American (+150). Decimal is the
 * working representation here because it is the only one the maths is clean in
 * — a parlay's price is the product of its legs' decimals, and nothing else.
 *
 * The one subtlety worth stating plainly. A price implies a probability,
 * `1 / decimal`, but those implied figures sum to more than 100% across a
 * market. The excess is the bookmaker's margin. Comparing a model probability
 * against the raw implied number therefore charges the model for the margin
 * before it starts. Both figures are produced here, and the interface shows
 * both, so the comparison can be read honestly either way.
 *
 * Pure. No provider, no configuration, no I/O.
 */

import type { Price } from './types.ts';

/** Guard against a nonsensical quote reaching the arithmetic. */
const MIN_DECIMAL = 1.01;
const MAX_DECIMAL = 1000;

function isUsableDecimal(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_DECIMAL && value <= MAX_DECIMAL;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

/**
 * American to decimal.
 *
 * A positive price is the profit on a 100 stake; a negative one is the stake
 * needed to win 100. Both become "total returned per 1 staked".
 */
export function americanToDecimal(american: number): number | null {
  if (!Number.isFinite(american) || american === 0) return null;
  const decimal = american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
  return isUsableDecimal(decimal) ? round(decimal, 4) : null;
}

export function decimalToAmerican(decimal: number): number | null {
  if (!isUsableDecimal(decimal)) return null;
  const profit = decimal - 1;
  // Exactly even money is conventionally quoted +100 rather than -100.
  return profit >= 1 ? Math.round(profit * 100) : -Math.round(100 / profit);
}

/**
 * Decimal to a readable fraction.
 *
 * Continued-fraction approximation of the profit, capped at a denominator a
 * person would recognise. Betting fractions are conventional rather than exact
 * — 4/7 and 8/14 are the same number but only one is ever printed — so the
 * result is reduced and bounded rather than made arbitrarily precise. Decimal
 * remains the authoritative figure; this is for display.
 */
export function decimalToFractional(decimal: number, maxDenominator = 50): string | null {
  if (!isUsableDecimal(decimal)) return null;
  const target = decimal - 1;

  let bestNumerator = 1;
  let bestDenominator = 1;
  let bestError = Number.POSITIVE_INFINITY;

  for (let denominator = 1; denominator <= maxDenominator; denominator += 1) {
    const numerator = Math.round(target * denominator);
    if (numerator < 1) continue;
    const error = Math.abs(target - numerator / denominator);
    // Strictly better only, so the smallest denominator that achieves a given
    // accuracy wins — 1/2 rather than 25/50.
    if (error < bestError - 1e-9) {
      bestError = error;
      bestNumerator = numerator;
      bestDenominator = denominator;
    }
  }

  const divisor = gcd(bestNumerator, bestDenominator);
  return `${bestNumerator / divisor}/${bestDenominator / divisor}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

// ---------------------------------------------------------------------------
// Building a price
// ---------------------------------------------------------------------------

export function priceFromDecimal(decimal: number): Price | null {
  if (!isUsableDecimal(decimal)) return null;
  const american = decimalToAmerican(decimal);
  const fractional = decimalToFractional(decimal);
  if (american === null || fractional === null) return null;

  return {
    decimal: round(decimal, 4),
    american,
    fractional,
    implied: round(1 / decimal, 4),
  };
}

export function priceFromAmerican(american: number): Price | null {
  const decimal = americanToDecimal(american);
  return decimal === null ? null : priceFromDecimal(decimal);
}

/**
 * An American price as a feed reports it.
 *
 * Handles the leading `+`, and `EVEN`/`EV`, which some feeds use for +100.
 * Returns null for anything else rather than guessing — a price that cannot be
 * read is a market we do not have, not a market at evens.
 */
export function parseAmerican(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const text = raw.trim().toUpperCase();
  if (text === 'EVEN' || text === 'EV') return 100;

  const value = Number.parseFloat(text.replace('+', ''));
  return Number.isFinite(value) && value !== 0 ? value : null;
}

/**
 * A line as a feed reports it, e.g. `+3.5`, `-3.5`, `o44.5`, `u2.5`.
 *
 * The over/under prefix is dropped: direction is carried separately, and a
 * total is a positive number in both directions.
 */
export function parseLine(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;

  const text = raw.trim().toLowerCase().replace(/^[ou]/, '');
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Margin and edge
// ---------------------------------------------------------------------------

export interface FairOdds {
  /** Implied probabilities with the margin removed, in the order given. */
  fair: number[];
  /** The book's margin, as a fraction: 0.05 is a 5% book. */
  margin: number;
}

/**
 * Strip the bookmaker's margin from a complete market.
 *
 * Proportional removal: each implied probability is scaled by the same factor
 * so they sum to one. It is the standard first approximation and, importantly,
 * it is the one that does not require assuming anything about which side the
 * book has loaded — a more elaborate method would be a modelling choice
 * presented as arithmetic.
 *
 * Needs *every* side of the market. A partial market cannot be de-vigged,
 * and this returns null rather than pretending otherwise.
 */
export function removeMargin(implied: readonly number[]): FairOdds | null {
  if (implied.length < 2) return null;
  const total = implied.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  return {
    fair: implied.map((value) => round(value / total, 4)),
    margin: round(total - 1, 4),
  };
}

/**
 * Disagreement between the model and the market price.
 *
 * Deliberately not called "value". A positive edge means the model rates the
 * outcome more likely than the price does — which is a disagreement, not a
 * discovery. Either party can be wrong, and the model is the one with no money
 * at stake.
 */
export function modelEdge(modelProbability: number, impliedProbability: number): number {
  return round(modelProbability - impliedProbability, 4);
}

// ---------------------------------------------------------------------------
// Combining
// ---------------------------------------------------------------------------

/**
 * The price of a combination.
 *
 * The product of the legs' decimals, which is simply what a book pays: each
 * leg's returns are staked on the next. Null if any leg is unpriced — a
 * partial combination has no price, and inventing one for the missing leg
 * would fabricate the headline figure.
 */
export function combinedDecimal(prices: readonly (Price | null)[]): number | null {
  if (prices.length === 0) return null;
  let product = 1;
  for (const price of prices) {
    if (!price) return null;
    product *= price.decimal;
  }
  return isUsableDecimal(product) ? round(product, 4) : null;
}

/**
 * What a stake returns at a price, stake included.
 *
 * Plain arithmetic on a real quoted price, and only ever shown when every leg
 * is genuinely priced. There is no notion of a bet being placed anywhere in
 * this application — this is what the quoted odds mean, nothing more.
 */
export function returnsOn(stake: number, decimal: number): number {
  return round(stake * decimal, 2);
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
