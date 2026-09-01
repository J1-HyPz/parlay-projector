/**
 * Homepage aggregate.
 *
 * Fetches the three sections concurrently and reports which of them degraded.
 * Sections are independent by construction: news being down must not stop games
 * or accuracy from rendering.
 */

import { APP_TIMEZONE, newsConfig } from '../config';
import { countActiveSports } from './sports/normalise';
import { getGamesToday } from './sports/service';
import { getNews } from './news/service';
import { getAccuracy } from './predictions/service';
import type { AccuracyRange, HomeErrorCode, HomeResponse, HomeSummary, SportId } from './types';

export interface HomeOptions {
  sport?: SportId;
  newsLimit?: number;
  range?: AccuracyRange;
}

export async function getHome(options: HomeOptions = {}): Promise<HomeResponse> {
  const sport = options.sport ?? 'all';
  const newsLimit = options.newsLimit ?? newsConfig.defaultLimit;
  const range = options.range ?? 'all-time';

  const [games, news, accuracy] = await Promise.all([
    getGamesToday(sport),
    getNews(newsLimit),
    getAccuracy(range),
  ]);

  const errors: HomeErrorCode[] = [];
  if (games.failed) errors.push('sports_data_unavailable');
  if (news.failed) errors.push('news_data_unavailable');
  if (accuracy.failed) errors.push('accuracy_unavailable');

  const summary: HomeSummary = {
    games_today: games.games.length,
    sports_active: countActiveSports(games.games),
    accuracy: accuracy.summary.accuracy,
    predictions_settled: accuracy.summary.settled,
  };

  return {
    date: games.date,
    timezone: APP_TIMEZONE,
    summary,
    games: games.games,
    news: news.articles,
    accuracy: accuracy.summary,
    errors,
  };
}
