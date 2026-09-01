/**
 * News service — recent sports headlines for the Home page.
 *
 * Cached longer than games: headlines move slowly and the feeds are shared
 * infrastructure that should not be polled per page view.
 */

import { cached } from '../../cache';
import { newsConfig } from '../../config';
import { logger } from '../../logger';
import type { NewsArticle } from '../types';
import { createRssNewsProvider } from './rss';
import type { NewsProvider } from './provider';

// The one place the concrete provider is chosen.
const provider: NewsProvider = createRssNewsProvider();

export interface NewsResult {
  articles: NewsArticle[];
  failed: boolean;
}

export async function getNews(limit: number): Promise<NewsResult> {
  try {
    // Cache the full feed, then slice — varying `limit` must not multiply
    // provider requests.
    const { value, hit } = await cached(
      `news:${provider.name}`,
      newsConfig.cacheTtlMs,
      () => provider.recent(),
    );

    if (!hit) {
      logger.info('homepage_news_refreshed', {
        provider: provider.name,
        count: value.length,
      });
    }

    return { articles: value.slice(0, limit), failed: false };
  } catch (error) {
    logger.error('homepage_news_failed', {
      provider: provider.name,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { articles: [], failed: true };
  }
}
