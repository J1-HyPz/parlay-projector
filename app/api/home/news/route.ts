/**
 * GET /api/home/news
 *
 * Recent sports headlines: metadata, provider summaries and source links only.
 *
 * Query: ?limit=1..20   (default: 6)
 */

import { newsConfig } from '@/lib/config';
import { resolveLimit } from '@/lib/home/news/normalise';
import { getNews } from '@/lib/home/news/service';
import type { NewsResponse } from '@/lib/home/types';
import { json } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const limit = resolveLimit(
    new URL(request.url).searchParams.get('limit'),
    newsConfig.defaultLimit,
    newsConfig.maxLimit,
  );

  const { articles, failed } = await getNews(limit);

  const body: NewsResponse = {
    articles,
    ...(failed ? { error: 'news_data_unavailable' as const } : {}),
  };

  return json(body);
}
