'use client';

/**
 * Sports news.
 *
 * Headlines, short provider summaries and source links only — no article bodies
 * are fetched, stored or rendered. Each card links out to the publisher.
 */

import { SectionHeading, PlaceholderLine } from '@/components/dashboard-ui';
import { Unavailable } from '@/components/ui/states';
import type { NewsArticle } from '@/lib/home/types';
import { formatRelative, useHomeData, useSectionFailed } from './home-data';

const ARTWORK =
  'bg-[radial-gradient(circle_at_25%_20%,rgba(139,92,246,.16),transparent_42%),linear-gradient(135deg,rgba(255,255,255,.035),rgba(255,255,255,.012))]';

function ArticleCard({ article }: { article: NewsArticle }) {
  return (
    <article className="panel overflow-hidden">
      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block transition hover:opacity-90 focus-ring"
      >
        {article.image ? (
          // oxlint-disable-next-line nextjs/no-img-element -- remote publisher thumbnail from arbitrary news CDNs; see games-today.tsx
          <img
            src={article.image}
            alt=""
            loading="lazy"
            className="h-24 w-full border-b border-line bg-surface-1 object-cover"
          />
        ) : (
          <div className={`h-24 border-b border-line ${ARTWORK}`} />
        )}

        <div className="p-4">
          <div className="mb-3 flex justify-between gap-3 text-2xs uppercase tracking-wider">
            <span className="truncate text-violet-300">{article.category ?? article.source}</span>
            <span className="shrink-0 text-ink-faint">{formatRelative(article.published_at)}</span>
          </div>
          <p className="line-clamp-2 text-sm font-medium leading-5 text-ink">
            {article.headline}
          </p>
          {article.summary ? (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-ink-subtle">{article.summary}</p>
          ) : null}
        </div>
      </a>
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="panel overflow-hidden">
      <div className={`h-24 border-b border-line ${ARTWORK}`} />
      <div className="p-4">
        <div className="mb-3 flex justify-between text-2xs uppercase tracking-wider">
          <span className="text-violet-300">Sport</span>
          <span className="text-ink-faint">-- ago</span>
        </div>
        <PlaceholderLine className="h-2.5 w-full" />
        <PlaceholderLine className="mt-2 w-2/3" />
      </div>
    </article>
  );
}

export function NewsFeed() {
  const { state, data } = useHomeData();
  const failed = useSectionFailed('news_data_unavailable');

  return (
    <section className="mt-7">
      <SectionHeading title="News" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state === 'loading' ? (
          [0, 1, 2].map((index) => <SkeletonCard key={index} />)
        ) : failed ? (
          <Unavailable className="sm:col-span-2 lg:col-span-3">News currently unavailable.</Unavailable>
        ) : data && data.news.length > 0 ? (
          data.news.slice(0, 6).map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))
        ) : (
          <Unavailable className="sm:col-span-2 lg:col-span-3">No recent news.</Unavailable>
        )}
      </div>
    </section>
  );
}
