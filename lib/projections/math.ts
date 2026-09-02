/**
 * Shared probability mathematics.
 *
 * Pure and dependency-free, so every distribution used by the sport models is
 * directly testable. Nothing here knows about sports.
 *
 * The functions are deliberately ordinary and checkable — normal and Poisson
 * distributions, a seedable generator, and the standard scoring rules — rather
 * than an opaque formula nobody can reason about later.
 */

/** Clamp to a closed interval. */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/**
 * Keep a probability strictly inside (0, 1).
 *
 * Sports outcomes are never certain, and a stored 0 or 1 would make log loss
 * infinite. The bound is the practical floor this application will report.
 */
export const MIN_PROBABILITY = 0.005;
export const MAX_PROBABILITY = 0.995;

export function boundProbability(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return clamp(p, MIN_PROBABILITY, MAX_PROBABILITY);
}

/** Scale a set of probabilities so they sum to one. */
export function normalise(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(value, 0), 0);
  if (total <= 0) return values.map(() => 1 / Math.max(values.length, 1));
  return values.map((value) => Math.max(value, 0) / total);
}

// ---------------------------------------------------------------------------
// Normal distribution
// ---------------------------------------------------------------------------

/**
 * Standard normal CDF.
 *
 * Abramowitz & Stegun 7.1.26 applied to erf; accurate to ~1e-7, which is far
 * beyond the precision any of these inputs justify.
 */
export function normalCdf(x: number, mean = 0, sd = 1): number {
  if (!Number.isFinite(x) || !Number.isFinite(mean) || !(sd > 0)) return 0.5;
  const z = (x - mean) / (sd * Math.SQRT2);

  const sign = z < 0 ? -1 : 1;
  const a = Math.abs(z);

  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-a * a);

  return 0.5 * (1 + sign * y);
}

/** P(X > threshold) for X ~ Normal(mean, sd). */
export function normalAbove(threshold: number, mean: number, sd: number): number {
  return 1 - normalCdf(threshold, mean, sd);
}

// ---------------------------------------------------------------------------
// Poisson distribution
// ---------------------------------------------------------------------------

/** ln(k!) via a lookup for the small counts these models actually use. */
const LOG_FACTORIAL: number[] = (() => {
  const table = [0];
  for (let k = 1; k <= 40; k += 1) table[k] = table[k - 1] + Math.log(k);
  return table;
})();

function logFactorial(k: number): number {
  if (k < LOG_FACTORIAL.length) return LOG_FACTORIAL[k];
  // Stirling, only reached for counts no sport in this application produces.
  return k * Math.log(k) - k + 0.5 * Math.log(2 * Math.PI * k);
}

/** P(X = k) for X ~ Poisson(lambda). Computed in logs to stay stable. */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isInteger(k) || !(lambda > 0)) return 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

/** P(X <= k). */
export function poissonCdf(k: number, lambda: number): number {
  if (k < 0) return 0;
  let total = 0;
  for (let i = 0; i <= Math.floor(k); i += 1) total += poissonPmf(i, lambda);
  return clamp(total, 0, 1);
}

/** P(X >= k). */
export function poissonAtLeast(k: number, lambda: number): number {
  if (k <= 0) return 1;
  return clamp(1 - poissonCdf(k - 1, lambda), 0, 1);
}

// ---------------------------------------------------------------------------
// Seedable randomness
// ---------------------------------------------------------------------------

/**
 * A small deterministic generator (mulberry32).
 *
 * Simulations are seeded so a test can assert an exact distribution, and so a
 * projection regenerated from unchanged inputs does not wobble. Production
 * seeds from the game id, which makes a projection reproducible from its own
 * record.
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable non-negative hash of a string, for deriving a seed from a game id. */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** One Poisson draw (Knuth). Fine for the small means these sports produce. */
export function samplePoisson(lambda: number, random: () => number): number {
  if (!(lambda > 0)) return 0;
  const limit = Math.exp(-lambda);
  let k = 0;
  let product = random();
  // Guard: a runaway lambda must not spin forever.
  while (product > limit && k < 200) {
    k += 1;
    product *= random();
  }
  return k;
}

/** One normal draw (Box-Muller). */
export function sampleNormal(mean: number, sd: number, random: () => number): number {
  const u1 = Math.max(random(), Number.EPSILON);
  const u2 = random();
  return mean + sd * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ---------------------------------------------------------------------------
// Elo
// ---------------------------------------------------------------------------

/** Win expectancy for a rating difference, including any home adjustment. */
export function eloExpectation(ratingDifference: number): number {
  return 1 / (1 + 10 ** (-ratingDifference / 400));
}

/**
 * Elo update for one played game.
 *
 * The margin multiplier is the widely used FiveThirtyEight form: a bigger win
 * moves the rating more, but with diminishing returns, and the denominator
 * damps the effect when the winner was already the stronger side — otherwise
 * favourites beating weak opposition inflate indefinitely.
 */
export function eloUpdate(
  rating: number,
  opponentRating: number,
  score: 1 | 0.5 | 0,
  margin: number,
  k: number,
): number {
  const expected = eloExpectation(rating - opponentRating);
  const signedDifference = score === 1 ? rating - opponentRating : opponentRating - rating;
  const multiplier =
    Math.log(Math.abs(margin) + 1) * (2.2 / (signedDifference * 0.001 + 2.2));
  return rating + k * multiplier * (score - expected);
}

// ---------------------------------------------------------------------------
// Scoring rules
// ---------------------------------------------------------------------------

/**
 * Brier score for a binary outcome: (probability - outcome)^2.
 *
 * Lower is better; 0.25 is what always saying 50% achieves. Accuracy alone is
 * misleading — a model that only ever backs heavy favourites can look strong —
 * so this is tracked alongside it.
 */
export function brierScore(probability: number, happened: boolean): number {
  const outcome = happened ? 1 : 0;
  return (boundProbability(probability) - outcome) ** 2;
}

/** Log loss for a binary outcome. Punishes confident mistakes much harder. */
export function logLoss(probability: number, happened: boolean): number {
  const p = boundProbability(probability);
  return happened ? -Math.log(p) : -Math.log(1 - p);
}

/** Probability expressed as decimal odds. Analytics only — never a real price. */
export function impliedOdds(probability: number): number | null {
  const p = boundProbability(probability);
  return p > 0 ? Number((1 / p).toFixed(2)) : null;
}

/**
 * Weights that decay with age, newest first.
 *
 * Recent games matter more, but older ones are never dropped entirely: a model
 * driven only by the last handful of results swings wildly on noise.
 */
export function decayWeights(count: number, halfLife: number): number[] {
  const weights: number[] = [];
  for (let i = 0; i < count; i += 1) weights.push(0.5 ** (i / Math.max(halfLife, 0.5)));
  return weights;
}

/** Weighted mean; returns null when there is nothing to average. */
export function weightedMean(values: readonly number[], weights: readonly number[]): number | null {
  let total = 0;
  let weight = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    const w = weights[i] ?? 0;
    if (!Number.isFinite(value) || w <= 0) continue;
    total += value * w;
    weight += w;
  }
  return weight > 0 ? total / weight : null;
}

/** Sample standard deviation; null below two observations. */
export function standardDeviation(values: readonly number[]): number | null {
  const usable = values.filter((value) => Number.isFinite(value));
  if (usable.length < 2) return null;
  const mean = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const variance =
    usable.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (usable.length - 1);
  return Math.sqrt(variance);
}
