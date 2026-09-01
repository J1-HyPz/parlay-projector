/**
 * GET /api/home
 *
 * Aggregated homepage payload: summary, games, news and accuracy in one call.
 * The Home page uses this so a first paint costs one request instead of four.
 *
 * Query: ?sport=...  ?limit=...  ?range=...
 *
 * Sections degrade independently; `errors` names whichever ones are unavailable
 * while the rest still return data.
 */

import { newsConfig } from '@/lib/config';
import { resolveLimit } from '@/lib/home/news/normalise';
import { resolveRange } from '@/lib/home/predictions/accuracy';
import { getHome } from '@/lib/home/service';
import { badRequest, json, parseSport } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  const sport = parseSport(params.get('sport'));
  if (sport === null) {
    return badRequest('sport must be one of: all, nfl, nba, mlb, nhl, football');
  }

  const body = await getHome({
    sport,
    newsLimit: resolveLimit(params.get('limit'), newsConfig.defaultLimit, newsConfig.maxLimit),
    range: resolveRange(params.get('range')),
  });

  return json(body);
}
