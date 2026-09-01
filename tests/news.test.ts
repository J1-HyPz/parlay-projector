import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { NewsArticle } from '../lib/home/types.ts';
import {
  cleanText,
  dedupeArticles,
  feedSource,
  normalisePublishedAt,
  parseFeed,
  resolveLimit,
  safeUrl,
  sortArticles,
} from '../lib/home/news/normalise.ts';

/** Shaped from a real BBC Sport RSS response. */
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title><![CDATA[BBC Sport]]></title>
    <link>https://www.bbc.co.uk/sport</link>
    <item>
      <title><![CDATA[Aston Villa complete &#163;47m signing]]></title>
      <description><![CDATA[Aston Villa sign the Senegal winger.]]></description>
      <link>https://www.bbc.co.uk/sport/football/articles/abc?at_medium=RSS</link>
      <guid isPermaLink="false">https://www.bbc.co.uk/sport/football/articles/abc#0</guid>
      <pubDate>Tue, 01 Sep 2026 10:50:22 GMT</pubDate>
      <media:thumbnail width="240" height="135" url="https://ichef.bbci.co.uk/thumb.jpg"/>
    </item>
    <item>
      <title>Second headline</title>
      <description>Second summary.</description>
      <link>https://www.bbc.co.uk/sport/football/articles/def</link>
      <guid>https://www.bbc.co.uk/sport/football/articles/def#0</guid>
      <pubDate>Mon, 31 Aug 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

describe('feed parsing', () => {
  it('normalises a provider feed into articles', () => {
    const articles = parseFeed(FEED, 'https://feeds.bbci.co.uk/sport/rss.xml');
    assert.equal(articles.length, 2);

    const first = articles[0];
    assert.equal(first.headline, 'Aston Villa complete £47m signing');
    assert.equal(first.summary, 'Aston Villa sign the Senegal winger.');
    assert.equal(first.source, 'BBC Sport');
    assert.equal(first.published_at, '2026-09-01T10:50:22.000Z');
    assert.equal(first.image, 'https://ichef.bbci.co.uk/thumb.jpg');
    assert.ok(first.url.startsWith('https://www.bbc.co.uk/sport/football/articles/abc'));
    assert.equal(first.id, 'https://www.bbc.co.uk/sport/football/articles/abc#0');
  });

  it('returns article metadata only, never a body', () => {
    const article = parseFeed(FEED, 'https://example.test/rss')[0];
    assert.deepEqual(Object.keys(article).sort(), [
      'category',
      'headline',
      'id',
      'image',
      'published_at',
      'source',
      'summary',
      'url',
    ]);
  });

  it('handles an empty or malformed feed without throwing', () => {
    assert.deepEqual(parseFeed('', 'https://example.test/rss'), []);
    assert.deepEqual(parseFeed('<rss><channel></channel></rss>', 'https://example.test/rss'), []);
    assert.deepEqual(parseFeed('not xml at all', 'https://example.test/rss'), []);
  });

  it('skips items with no usable link or headline', () => {
    const feed = `<rss><channel><title>T</title>
      <item><title>No link</title></item>
      <item><link>https://example.test/a</link></item>
      <item><title>Good</title><link>https://example.test/b</link></item>
    </channel></rss>`;
    const articles = parseFeed(feed, 'https://example.test/rss');
    assert.equal(articles.length, 1);
    assert.equal(articles[0].headline, 'Good');
  });

  it('falls back to the feed host when the channel has no title', () => {
    assert.equal(
      feedSource('<rss><channel></channel></rss>', 'https://feeds.bbci.co.uk/sport/rss.xml'),
      'feeds.bbci.co.uk',
    );
  });
});

describe('sanitisation', () => {
  it('strips markup from provider text', () => {
    assert.equal(cleanText('<b>Bold</b> headline'), 'Bold headline');
    assert.equal(cleanText('<![CDATA[Wrapped]]>'), 'Wrapped');
    assert.equal(cleanText('<script>alert(1)</script>safe'), 'alert(1) safe');
  });

  it('decodes entities', () => {
    assert.equal(cleanText('Spurs &amp; Arsenal'), 'Spurs & Arsenal');
    assert.equal(cleanText('&#163;47m'), '£47m');
  });

  it('returns null for empty content', () => {
    assert.equal(cleanText(''), null);
    assert.equal(cleanText('   '), null);
    assert.equal(cleanText(null), null);
    assert.equal(cleanText(undefined), null);
  });

  it('rejects non-http URL schemes', () => {
    assert.equal(safeUrl('https://example.test/a'), 'https://example.test/a');
    assert.equal(safeUrl('http://example.test/a'), 'http://example.test/a');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('data:text/html,<script>'), null);
    assert.equal(safeUrl('not a url'), null);
  });

  it('parses feed dates to ISO-8601, or null', () => {
    assert.equal(
      normalisePublishedAt('Tue, 01 Sep 2026 10:50:22 GMT'),
      '2026-09-01T10:50:22.000Z',
    );
    assert.equal(normalisePublishedAt('nonsense'), null);
    assert.equal(normalisePublishedAt(null), null);
  });
});

describe('limit validation', () => {
  it('defaults when absent or unparseable', () => {
    assert.equal(resolveLimit(null, 6, 20), 6);
    assert.equal(resolveLimit('', 6, 20), 6);
    assert.equal(resolveLimit('abc', 6, 20), 6);
  });

  it('clamps to the maximum', () => {
    assert.equal(resolveLimit('20', 6, 20), 20);
    assert.equal(resolveLimit('99999', 6, 20), 20);
  });

  it('rejects zero and negative values', () => {
    assert.equal(resolveLimit('0', 6, 20), 6);
    assert.equal(resolveLimit('-5', 6, 20), 6);
  });

  it('accepts values in range', () => {
    assert.equal(resolveLimit('3', 6, 20), 3);
  });
});

function article(overrides: Partial<NewsArticle> = {}): NewsArticle {
  return {
    id: 'a-1',
    headline: 'Headline',
    summary: null,
    category: null,
    source: 'Test',
    published_at: null,
    image: null,
    url: 'https://example.test/a',
    ...overrides,
  };
}

describe('ordering and deduplication', () => {
  it('sorts newest first with undated last', () => {
    const articles = sortArticles([
      article({ published_at: null }),
      article({ published_at: '2026-08-01T00:00:00.000Z' }),
      article({ published_at: '2026-09-01T00:00:00.000Z' }),
    ]);
    assert.equal(articles[0].published_at, '2026-09-01T00:00:00.000Z');
    assert.equal(articles[1].published_at, '2026-08-01T00:00:00.000Z');
    assert.equal(articles[2].published_at, null);
  });

  it('removes duplicates across feeds by url', () => {
    const unique = dedupeArticles([
      article({ url: 'https://a.test/1' }),
      article({ url: 'https://a.test/1' }),
      article({ url: 'https://a.test/2' }),
    ]);
    assert.equal(unique.length, 2);
  });
});
