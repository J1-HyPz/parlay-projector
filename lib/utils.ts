import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A probability as a percentage.
 *
 * Every probability in this application is stored as a **fraction** — 0.7647,
 * not 76.47 — from the model through the store to the API. This is the one
 * place that turns one into the other, and it lives here rather than in a
 * component so the homepage and the parlay pages cannot drift apart.
 *
 * They had. The accuracy widget printed the fraction with a `%` after it, so a
 * model settling at 76.5% was displayed as `0.8%` and the ring beside it drew
 * a sliver. Nothing was wrong with the figure; only with the last step.
 */
export function percent(value: number, places = 0): string {
  return `${(value * 100).toFixed(places)}%`;
}

/** A signed percentage, for figures where the direction is the point. */
export function signedPercent(value: number, places = 1): string {
  const formatted = `${(Math.abs(value) * 100).toFixed(places)}%`;
  return value >= 0 ? `+${formatted}` : `−${formatted}`;
}
