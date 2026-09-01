/**
 * Server-side configuration.
 *
 * Everything is environment-driven so the same image runs unchanged in local
 * development, in Docker and on TrueNAS. Nothing here is exposed to the client:
 * these values are only ever read inside route handlers and services.
 */

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function envInt(name: string, fallback: number): number {
  const raw = env(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Timezone used to decide which calendar day "today" is.
 * The project had no timezone system, so this defaults to Europe/London.
 */
export const APP_TIMEZONE = env('APP_TIMEZONE', 'Europe/London');

export const sportsConfig = {
  baseUrl: env('SPORTS_API_URL', 'https://www.thesportsdb.com/api/v1/json'),
  /**
   * TheSportsDB's documented free/test key. Set SPORTS_API_KEY to a real key
   * for higher rate limits. Never sent to the browser.
   */
  apiKey: env('SPORTS_API_KEY', '3'),
  cacheTtlMs: envInt('SPORTS_CACHE_TTL_SECONDS', 120) * 1000,
  timeoutMs: envInt('SPORTS_TIMEOUT_MS', 8000),
};

export const newsConfig = {
  /** Comma-separated RSS feed URLs. Metadata and summaries only. */
  feedUrls: env('NEWS_FEED_URLS', 'https://feeds.bbci.co.uk/sport/rss.xml')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),
  cacheTtlMs: envInt('NEWS_CACHE_TTL_SECONDS', 600) * 1000,
  timeoutMs: envInt('NEWS_TIMEOUT_MS', 8000),
  defaultLimit: 6,
  maxLimit: 20,
};

export const liveConfig = {
  /**
   * Server-side cache for the live scoreboard.
   *
   * Short enough that scores stay current, long enough that simultaneous
   * clients share one provider refresh rather than each triggering their own.
   */
  cacheTtlMs: envInt('LIVE_CACHE_TTL_SECONDS', 20) * 1000,
  /**
   * How often the browser re-polls `/api/live`.
   *
   * Sent to the client in the response, so no build-time public variable is
   * needed. Floored at 10s so misconfiguration cannot hammer the provider.
   */
  refreshIntervalMs: Math.max(10_000, envInt('LIVE_REFRESH_INTERVAL_MS', 30_000)),
};

/**
 * Directory for persistent application data.
 *
 * Must point at a mounted volume in production: a container filesystem is
 * ephemeral and would lose prediction history on every redeploy. The path is
 * configurable precisely so no TrueNAS dataset location is baked into the image.
 */
export const DATA_DIR = env('DATA_DIR', './data');

/** Whether to include internal error detail in responses. Never on in production. */
export const isProduction = env('NODE_ENV') === 'production';

/**
 * Today's date in APP_TIMEZONE as YYYY-MM-DD.
 *
 * `en-CA` formats as YYYY-MM-DD, which avoids hand-rolling date maths and
 * correctly respects the configured zone (including BST transitions).
 */
export function todayInAppTimezone(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
