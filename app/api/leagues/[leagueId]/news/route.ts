/**
 * GET /api/leagues/:leagueId/news?limit=
 *
 * Headlines for one competition, so an NBA hub shows NBA stories rather than
 * whatever is top of a general sports feed.
 *
 * Emits the same `NewsArticle` shape the homepage uses, so the frontend does
 * not know which provider supplied a story. Metadata only: headline, the
 * provider's own short summary, source, timestamp, image and a link to the
 * original. Article bodies are never fetched or stored.
 */

import { json } from '@/lib/home/api';
import { parseLeagueId } from '@/lib/leagues/registry';
import { getLeagueNews } from '@/lib/leagues/extras';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 24;

export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
): Promise<Response> {
  const { leagueId } = await context.params;
  const league = parseLeagueId(leagueId);
  if (!league) {
    return json({ error: 'league_not_found', message: 'No such league.' }, 404);
  }

  const requested = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const articles = await getLeagueNews(league, limit);

  return json({
    league: { id: league.id, label: league.label },
    articles: articles ?? [],
    ...(articles ? {} : { error: 'league_data_unavailable' as const }),
  });
}
