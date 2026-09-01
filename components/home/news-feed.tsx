'use client';

/**
 * Sports news.
 *
 * Headlines, short provider summaries and source links only — no article bodies
 * are fetched, stored or rendered. Each card links out to the publisher.
 */

import { SectionHeading, PlaceholderLine } from '@/components/dashboard-ui';
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
        className="block transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      >
        {article.image ? (
          // oxlint-disable-next-line nextjs/no-img-element -- remote publisher thumbnail from arbitrary news CDNs; see games-today.tsx
          <img
            src={article.image}
            alt=""
            loading="lazy"
            className="h-24 w-full border-b border-white/7 object-cover"
          />
        ) : (
          <div className={`h-24 border-b border-white/7 ${ARTWORK}`} />
        )}

        <div className="p-4">
          <div className="mb-3 flex justify-between gap-3 text-[10px] uppercase tracking-wider">
            <span className="truncate text-violet-300">{article.category ?? article.source}</span>
            <span className="shrink-0 text-white/28">{formatRelative(article.published_at)}</span>
          </div>
          <p className="line-clamp-2 text-sm font-medium leading-5 text-white/72">
            {article.headline}
          </p>
          {article.summary ? (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-white/38">{article.summary}</p>
          ) : null}
        </div>
      </a>
    </article>
  );
}

function SkeletonCard() {
  return (
    <article className="panel overflow-hidden">
      <div className={`h-24 border-b border-white/7 ${ARTWORK}`} />
      <div className="p-4">
        <div className="mb-3 flex justify-between text-[10px] uppercase tracking-wider">
          <span className="text-violet-300">Sport</span>
          <span className="text-white/28">-- ago</span>
        </div>
        <PlaceholderLine className="h-2.5 w-full" />
        <PlaceholderLine className="mt-2 w-2/3" />
      </div>
    </article>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="panel flex min-h-[120px] items-center justify-center p-4 text-center text-xs text-white/36 md:col-span-3">
      {children}
    </div>
  );
}

export function NewsFeed() {
  const { state, data } = useHomeData();
  const failed = useSectionFailed('news_data_unavailable');

  return (
    <section className="mt-7">
      <SectionHeading title="News" link="Explore all" />
      <div className="grid gap-3 md:grid-cols-3">
        {state === 'loading' ? (
          [0, 1, 2].map((index) => <SkeletonCard key={index} />)
        ) : failed ? (
          <Notice>News currently unavailable.</Notice>
        ) : data && data.news.length > 0 ? (
          data.news.slice(0, 6).map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))
        ) : (
          <Notice>No recent news.</Notice>
        )}
      </div>
    </section>
  );
}
