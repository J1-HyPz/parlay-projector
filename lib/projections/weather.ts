/**
 * Conditions, as a bounded adjustment to an expected total.
 *
 * Pure. A temperature and a config in, a number of runs out.
 *
 * **Only what was measured.** §4.5 proposed wind for baseball, and wind was
 * checked first: across 3,645 open-air fixtures its correlation with the total
 * was -0.022 at t = -1.33, indistinguishable from nothing. That is not a
 * surprise on reflection — raw wind speed says nothing without a direction
 * relative to the outfield, and a gust blowing in cancels a gust blowing out.
 * Precipitation was the same, at t = -1.41, and for a simpler reason: baseball
 * does not play through meaningful rain, it waits.
 *
 * Temperature is the one that holds. Correlation +0.084 at t = 5.08, and it
 * survives every confound worth the name: +0.061 within a month, +0.078 within
 * a venue, +0.063 within both at once. So it is not the calendar wearing a
 * thermometer, and it is not a park effect. Warm air is thinner and the ball
 * carries, which is the mechanism the numbers agree with.
 *
 * The adjustment is capped, and the cap is the point. A modifier that can move
 * a total by an unbounded amount on a forecast is a way to be confidently
 * wrong about a fixture the model previously and correctly said nothing about.
 */

import type { SportModelConfig } from './config.ts';

/** What is known about the conditions at a fixture. */
export interface FixtureConditions {
  /** Air temperature at first pitch, in Celsius. */
  temperature_c: number;
  /**
   * Whether the fixture is played under a roof.
   *
   * True suppresses the adjustment entirely — a dome has weather, it just is
   * not the weather outside. Unknown is treated as indoor for safety: guessing
   * a fixture is open-air and adjusting it is the error worth avoiding.
   */
  indoor: boolean;
}

/**
 * The change to the expected total, in the sport's own units.
 *
 * Zero whenever anything is missing, unmeasured or indoor — which is the
 * behaviour that makes this safe to add. A competition whose config carries no
 * `weather` block is projected exactly as it was before this existed.
 */
export function totalAdjustment(
  config: SportModelConfig,
  conditions: FixtureConditions | null | undefined,
): number {
  const rule = config.weather;
  if (!rule || !conditions || conditions.indoor) return 0;

  const temperature = conditions.temperature_c;
  if (!Number.isFinite(temperature)) return 0;

  const raw = (temperature - rule.referenceC) * rule.perDegreeC;
  return Math.max(-rule.cap, Math.min(rule.cap, raw));
}

/**
 * How the adjustment reads to a reader.
 *
 * Null when nothing was applied, so a caller cannot accidentally state a
 * factor for a fixture that was not adjusted.
 */
export function describeAdjustment(
  adjustment: number,
  conditions: FixtureConditions | null | undefined,
  unit: string,
): string | null {
  if (adjustment === 0 || !conditions) return null;

  const warmer = adjustment > 0;
  return (
    `${Math.round(conditions.temperature_c)}°C at first pitch, ` +
    `${warmer ? 'warmer' : 'cooler'} than this competition's average — ` +
    `the projected total is adjusted ${warmer ? 'up' : 'down'} by ` +
    `${Math.abs(adjustment).toFixed(2)} ${unit}.`
  );
}
