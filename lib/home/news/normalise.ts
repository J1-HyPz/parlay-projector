/**
 * Pure RSS parsing and normalisation.
 *
 * Deliberately extracts metadata only — headline, provider summary, link,
 * timestamp, thumbnail. Full article bodies are never stored or returned; the
 * `url` is what sends a reader to the publisher.
 *
 * A minimal targeted parser is used rather than a dependency: the project
 * cannot add packages without a package manager present, and the feed subset
 * needed here is small and well defined. Everything is treated as untrusted
 * text and HTML is stripped before it reaches the UI.
 *
 * Only type-only imports are used here, so the module has no runtime imports.
 */

import type { NewsArticle } from '../types';

/** Pull the inner text of the first matching tag within a fragment. */
function tag(fragment: string, name: string): string | null {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(
    fragment,
  );
  return match ? match[1] ?? null : null;
}

/** Read an attribute from the first matching self-closing/opening tag. */
function attr(fragment: string, name: string, attribute: string): string | null {
  const match = new RegExp(`<${name}(\\s[^>]*)?/?>`, 'i').exec(fragment);
  if (!match) return null;
  const attrs = match[1] ?? '';
  const value = new RegExp(`${attribute}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
  return value ? (value[1] ?? null) : null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, code: string) => {
    const named = ENTITIES[code.toLowerCase()];
    if (named !== undefined) return named;
    if (code.startsWith('#x') || code.startsWith('#X')) {
      const point = Number.parseInt(code.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    if (code.startsWith('#')) {
      const point = Number.parseInt(code.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : whole;
    }
    return whole;
  });
}

/**
 * Unwrap CDATA, strip any embedded markup and decode entities.
 *
 * Feed content is third-party text rendered inside the app, so stripping tags
 * here removes any possibility of markup arriving in the UI.
 */
export function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const unwrapped = value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const stripped = unwrapped.replace(/<[^>]*>/g, ' ');
  const decoded = decodeEntities(stripped).replace(/\s+/g, ' ').trim();
  return decoded.length > 0 ? decoded : null;
}

/** RFC-822 feed dates to ISO-8601 UTC; null when unparseable. */
export function normalisePublishedAt(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Only http(s) URLs are accepted, so `javascript:` can never reach an href. */
export function safeUrl(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/** Summaries are provider blurbs; cap length so a feed cannot dump an article. */
const MAX_SUMMARY_CHARS = 400;

export function parseFeedItem(fragment: string, source: string): NewsArticle | null {
  const url = safeUrl(tag(fragment, 'link'));
  const headline = cleanText(tag(fragment, 'title'));
  if (!url || !headline) return null;

  const summary = cleanText(tag(fragment, 'description'));
  const image =
    safeUrl(attr(fragment, 'media:thumbnail', 'url')) ??
    safeUrl(attr(fragment, 'media:content', 'url')) ??
    safeUrl(attr(fragment, 'enclosure', 'url'));

  return {
    id: cleanText(tag(fragment, 'guid')) ?? url,
    headline,
    summary: summary ? summary.slice(0, MAX_SUMMARY_CHARS) : null,
    category: cleanText(tag(fragment, 'category')),
    source,
    published_at: normalisePublishedAt(tag(fragment, 'pubDate')),
    image,
    url,
  };
}

/** Feed `<title>` for attribution; falls back to the host. */
export function feedSource(xml: string, feedUrl: string): string {
  const channel = /<channel(?:\s[^>]*)?>([\s\S]*?)(?:<item|<\/channel>)/i.exec(xml);
  const title = channel ? cleanText(tag(channel[1] ?? '', 'title')) : null;
  if (title) return title;
  try {
    return new URL(feedUrl).hostname;
  } catch {
    return 'Unknown source';
  }
}

export function parseFeed(xml: string, feedUrl: string): NewsArticle[] {
  if (typeof xml !== 'string' || xml.length === 0) return [];
  const source = feedSource(xml, feedUrl);
  const articles: NewsArticle[] = [];

  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const article = parseFeedItem(match[1] ?? '', source);
    if (article) articles.push(article);
  }
  return articles;
}

/** Newest first; entries without a timestamp sort last. */
export function sortArticles(articles: NewsArticle[]): NewsArticle[] {
  return [...articles].sort((a, b) => {
    if (a.published_at && b.published_at) {
      return b.published_at.localeCompare(a.published_at);
    }
    if (a.published_at) return -1;
    if (b.published_at) return 1;
    return 0;
  });
}

export function dedupeArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  const unique: NewsArticle[] = [];
  for (const article of articles) {
    if (seen.has(article.url)) continue;
    seen.add(article.url);
    unique.push(article);
  }
  return unique;
}

/**
 * Clamp a caller-supplied limit.
 *
 * Invalid, negative, zero and absurd values all collapse to something sane, so
 * `?limit=99999` cannot be used to force a large response.
 */
export function resolveLimit(
  raw: string | null | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === null || raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}
