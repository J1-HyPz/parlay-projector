/**
 * GET /api/home/accuracy
 *
 * Accuracy of stored predictions against actual results.
 *
 * Query: ?range=all-time|30d   (default: all-time)
 *
 * Returns accuracy: null when nothing has settled. No history is fabricated.
 */

import { resolveRange } from '@/lib/home/predictions/accuracy';
import { getAccuracy } from '@/lib/home/predictions/service';
import type { AccuracyResponse } from '@/lib/home/types';
import { json } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const range = resolveRange(new URL(request.url).searchParams.get('range'));
  const { summary, failed } = await getAccuracy(range);

  const body: AccuracyResponse = {
    ...summary,
    ...(failed ? { error: 'accuracy_unavailable' as const } : {}),
  };

  return json(body);
}
