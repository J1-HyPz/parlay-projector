/**
 * Range parsing for the homepage accuracy widget.
 *
 * The calculation itself lives in lib/projections/metrics.ts, behind the
 * accuracy service — one implementation, so the widget and the detailed
 * breakdowns cannot report different numbers. This module keeps only the query
 * parameter the route needs.
 */

import type { AccuracyRange } from '../types';

/** Parse an `?range=` query value; anything unrecognised falls back to all-time. */
export function resolveRange(raw: string | null | undefined): AccuracyRange {
  return raw?.trim() === '30d' ? '30d' : 'all-time';
}
