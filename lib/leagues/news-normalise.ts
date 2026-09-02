/**
 * Normalising ESPN's per-league news feed into the shared article model.
 *
 * Pure, so it is testable without network access. Emits the same `NewsArticle`
 * the RSS provider does, so the news list component does not know — and must
 * not know — which provider a story came from.
 *
 * Only metadata is carried: headline, the provider's own short summary, source,
 * timestamp, image and a link to the original. Article bodies are never
 * fetched or stored.
 */

import type { NewsArticle } from '../home/types';

export interface RawEspnArticle {
  id?: unknown;
  headline?: unknown;
  description?: unknown;
  published?: unknown;
  type?: unknown;
  links?: { web?: { href?: unknown } };
  images?: { url?: unknown }[];
}

export interface RawEspnNewsResponse {
  articles?: RawEspnArticle[] | null;
}

function str(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isoOrNull(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  const instant = new Date(raw);
  return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
}

/**
 * A story must have a headline and a working link to be worth rendering.
 *
 * `category` carries the competition label so a mixed list stays attributable;
 * the caller supplies it because the feed itself does not name the league.
 */
export function normaliseEspnArticle(
  raw: RawEspnArticle | null | undefined,
  leagueLabel: string,
): NewsArticle | null {
  if (!raw || typeof raw !== 'object') return null;

  const headline = str(raw.headline);
  const url = str(raw.links?.web?.href);
  if (!headline || !url) return null;

  // Only http(s) links are rendered: the feed also carries app deep links,
  // which do nothing in a browser.
  if (!/^https?:\/\//i.test(url)) return null;

  const summary = str(raw.description);

  return {
    id: str(raw.id) ?? url,
    headline,
    // The provider's own one-line summary, never a body. Some entries repeat
    // the headline here, which is noise rather than a summary.
    summary: summary && summary !== headline ? summary : null,
    category: leagueLabel,
    source: 'ESPN',
    published_at: isoOrNull(raw.published),
    image: str(raw.images?.[0]?.url),
    url,
  };
}

export function normaliseEspnNews(
  payload: RawEspnNewsResponse | null | undefined,
  leagueLabel: string,
): NewsArticle[] {
  const articles = payload?.articles;
  if (!Array.isArray(articles)) return [];

  const seen = new Set<string>();
  const result: NewsArticle[] = [];

  for (const raw of articles) {
    const article = normaliseEspnArticle(raw, leagueLabel);
    if (!article || seen.has(article.url)) continue;
    seen.add(article.url);
    result.push(article);
  }

  // Newest first; entries with no timestamp sort last rather than to the top.
  return result.sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
}
