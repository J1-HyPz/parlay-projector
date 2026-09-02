/**
 * Per-league news and transactions.
 *
 * Both follow the existing service shape: fetch through the ESPN client,
 * normalise, cache, and return null on failure so a caller can degrade rather
 * than throw. Neither is reachable from the browser except through the league
 * API routes.
 */

import { cached } from '../cache';
import { espnConfig } from '../config';
import { logger } from '../logger';
import { fetchEspn } from '../providers/espn/client';
import { addDays } from '../schedule/range';
import { todayInAppTimezone } from '../config';
import { normaliseEspnNews } from './news-normalise';
import type { RawEspnNewsResponse } from './news-normalise';
import { normaliseTransactions } from './transactions-normalise';
import type { RawTransactionsResponse, Transaction } from './transactions-normalise';
import { getTeams } from './service';
import type { League } from './registry';
import type { NewsArticle } from '../home/types';

/** Headlines move faster than standings but not by the second. */
const NEWS_TTL_MS = 15 * 60_000;
/** Transactions are published in daily batches. */
const TRANSACTIONS_TTL_MS = 60 * 60_000;

/** How far back the transactions feed is asked to look. */
const TRANSACTIONS_DAYS_BACK = 45;

/** Null on failure, so the hub can show "unable to load" rather than break. */
export async function getLeagueNews(
  league: League,
  limit: number,
): Promise<NewsArticle[] | null> {
  if (!espnConfig.enabled) return null;

  try {
    // Cache the whole feed and slice, so varying `limit` costs no extra
    // requests -- the same rule the homepage news service follows.
    const { value } = await cached(`league:news:${league.id}`, NEWS_TTL_MS, async () => {
      const payload = await fetchEspn<RawEspnNewsResponse>(`${league.espnPath}/news`);
      return normaliseEspnNews(payload, league.label);
    });
    return value.slice(0, limit);
  } catch (error) {
    logger.warn('league_news_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * The core API's league path.
 *
 * The core host nests leagues under the sport (`basketball/leagues/nba`) while
 * the site host does not (`basketball/nba`), so the catalogue path is rewritten
 * rather than a second path being stored on every league.
 */
export function coreLeaguePath(espnPath: string): string {
  const [sport, ...rest] = espnPath.split('/');
  return `${sport}/leagues/${rest.join('/')}`;
}

function compact(date: string): string {
  return date.replace(/-/g, '');
}

export interface TransactionsResult {
  transactions: Transaction[];
  /** False when the provider publishes none for this competition at all. */
  supported: boolean;
  failed: boolean;
}

/**
 * Recent transactions for a league.
 *
 * `hasTransactions` on the catalogue records which competitions the provider
 * actually covers — verified, not assumed. Every soccer competition and both
 * NCAA divisions return an empty list, so those are reported as unsupported
 * rather than as an empty week, which reads as a bug.
 */
export async function getLeagueTransactions(
  league: League,
  limit: number,
): Promise<TransactionsResult> {
  if (!league.hasTransactions) {
    return { transactions: [], supported: false, failed: false };
  }
  if (!espnConfig.enabled) {
    return { transactions: [], supported: true, failed: true };
  }

  const today = todayInAppTimezone();
  const range = `${compact(addDays(today, -TRANSACTIONS_DAYS_BACK))}-${compact(today)}`;

  try {
    const { value } = await cached(
      `league:transactions:${league.id}:${range}`,
      TRANSACTIONS_TTL_MS,
      async () => {
        // Teams come from the existing cached team list: the feed identifies a
        // club by a `$ref` URL, and following one per row would cost dozens of
        // requests for names already on hand.
        const [payload, teams] = await Promise.all([
          fetchEspn<RawTransactionsResponse>(
            `${coreLeaguePath(league.espnPath)}/transactions`,
            // Without an explicit range the feed returns nothing at all.
            `limit=100&dates=${range}`,
            'core',
          ),
          getTeams(league),
        ]);
        return normaliseTransactions(payload, league.id, teams ?? []);
      },
    );

    return { transactions: value.slice(0, limit), supported: true, failed: false };
  } catch (error) {
    logger.warn('league_transactions_failed', {
      league: league.id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { transactions: [], supported: true, failed: true };
  }
}
