/**
 * RSS news adapter.
 *
 * Feeds are configured via NEWS_FEED_URLS, so switching publisher — or moving
 * to a keyed JSON news API — is a configuration or single-file change.
 *
 * Only headlines, provider summaries, timestamps, thumbnails and source links
 * are taken. Article bodies are never fetched or stored.
 */

import { newsConfig } from '../../config';
import { getText, ProviderError } from '../../http';
import { logger } from '../../logger';
import type { NewsArticle } from '../types';
import { dedupeArticles, parseFeed, sortArticles } from './normalise';
import type { NewsProvider } from './provider';

export function createRssNewsProvider(): NewsProvider {
  return {
    name: 'rss',

    async recent(): Promise<NewsArticle[]> {
      const feeds = newsConfig.feedUrls;
      if (feeds.length === 0) {
        throw new ProviderError('no news feeds configured');
      }

      const results = await Promise.allSettled(
        feeds.map(async (feedUrl) => {
          const xml = await getText(feedUrl, {
            timeoutMs: newsConfig.timeoutMs,
            accept: 'application/rss+xml, application/xml, text/xml',
          });
          return parseFeed(xml, feedUrl);
        }),
      );

      const articles: NewsArticle[] = [];
      let failures = 0;
      for (const result of results) {
        if (result.status === 'fulfilled') articles.push(...result.value);
        else failures += 1;
      }

      // Every configured feed failing is a provider failure; a partial result
      // is still worth showing.
      if (failures === feeds.length) {
        throw new ProviderError('all news feeds failed');
      }
      if (failures > 0) {
        logger.warn('news_feed_partial_failure', {
          failed: failures,
          total: feeds.length,
        });
      }

      return sortArticles(dedupeArticles(articles));
    },
  };
}
