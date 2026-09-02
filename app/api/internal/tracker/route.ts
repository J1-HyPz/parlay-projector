/**
 * GET /api/internal/tracker
 *
 * Diagnostics for the prediction tracker: when it last ran, what it did, and
 * how many predictions are still open.
 *
 * `stale` is the one to watch — open predictions whose game started more than
 * twelve hours ago mean something is stuck, and the count says so rather than
 * leaving it to be noticed by a figure that stopped moving.
 *
 * Returns no credentials, no file paths and no provider detail.
 */

import { json } from '@/lib/home/api';
import { trackerHealth, SETTLEMENT_INTERVAL_MS } from '@/lib/projections/settle-job';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const health = await trackerHealth();

  return json({
    enabled: process.env.PREDICTION_TRACKING_ENABLED !== 'false',
    interval_seconds: Math.round(SETTLEMENT_INTERVAL_MS / 1000),
    ...health,
  });
}
