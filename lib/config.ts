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

import { PUBLIC_TEST_KEY, resolveTuning } from './tuning';

/**
 * Timezone used to decide which calendar day "today" is.
 * The project had no timezone system, so this defaults to Europe/London.
 */
export const APP_TIMEZONE = env('APP_TIMEZONE', 'Europe/London');

const sportsApiKey = env('SPORTS_API_KEY', PUBLIC_TEST_KEY);

/**
 * Request tuning, derived from the key.
 *
 * Setting a premium SPORTS_API_KEY automatically raises concurrency and lowers
 * cache lifetimes, because the throttling only exists to survive the public
 * test key's limits. Each value can still be overridden explicitly.
 */
const tuning = resolveTuning(sportsApiKey);

export const sportsConfig = {
  baseUrl: env('SPORTS_API_URL', 'https://www.thesportsdb.com/api/v1/json'),
  /**
   * Defaults to TheSportsDB's documented public test key. Set SPORTS_API_KEY to
   * a real key for higher rate limits. Never sent to the browser.
   */
  apiKey: sportsApiKey,
  /** True while running on the public test key. */
  usingTestKey: tuning.profile === 'test-key',
  /** `test-key` or `premium`. Surfaced in provider diagnostics. */
  tuningProfile: tuning.profile,
  cacheTtlMs: envInt('SPORTS_CACHE_TTL_SECONDS', tuning.todayCacheSeconds) * 1000,
  timeoutMs: envInt('SPORTS_TIMEOUT_MS', 8000),
  /** Concurrent provider requests when filling the schedule window. */
  scheduleConcurrency: envInt('SPORTS_SCHEDULE_CONCURRENCY', tuning.scheduleConcurrency),
  scheduleTtlMs: envInt('SPORTS_SCHEDULE_TTL_SECONDS', tuning.scheduleTtlSeconds) * 1000,
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

/**
 * ESPN public API.
 *
 * Requires no credentials, so it is enabled by default and can be turned off
 * with ESPN_ENABLED=false. Used only to enrich game details — the primary
 * provider still supplies fixtures, scores and the base game record.
 *
 * Note: this is ESPN's public web API. It is undocumented and carries no
 * published terms of use; see docs/data-providers.md.
 */
export const espnConfig = {
  enabled: (env('ESPN_ENABLED', 'true') || 'true').toLowerCase() !== 'false',
  // site.api.espn.com returns 403 to server-side callers; this host does not.
  baseUrl: env('ESPN_API_URL', 'https://site.web.api.espn.com/apis/site/v2/sports'),
  timeoutMs: envInt('ESPN_TIMEOUT_MS', 8000),
  /** Enrichment changes slowly relative to a fixture, so cache it hard. */
  cacheTtlMs: envInt('ESPN_CACHE_TTL_SECONDS', 900) * 1000,
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
 * Discord notifications.
 *
 * The webhook URL is a credential: anyone holding it can post to the channel.
 * It is read from the environment only, never committed, never logged, and
 * never sent to the browser -- `/api/internal/notifications` reports whether one
 * is configured, not what it is.
 *
 * Notifications are off unless a URL is set, so the image is inert by default.
 */
const discordWebhookUrl = env('DISCORD_WEBHOOK_URL');

/** Only Discord's own webhook hosts, so a misconfiguration cannot post elsewhere. */
const DISCORD_WEBHOOK_HOSTS = new Set([
  'discord.com',
  'discordapp.com',
  'canary.discord.com',
  'ptb.discord.com',
]);

export function isDiscordWebhookUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      DISCORD_WEBHOOK_HOSTS.has(parsed.hostname) &&
      parsed.pathname.startsWith('/api/webhooks/')
    );
  } catch {
    return false;
  }
}

export const notifyConfig = {
  webhookUrl: isDiscordWebhookUrl(discordWebhookUrl) ? discordWebhookUrl : '',
  /** True when a URL was supplied but is not a Discord webhook — surfaced, not silent. */
  misconfigured: discordWebhookUrl.length > 0 && !isDiscordWebhookUrl(discordWebhookUrl),
  /**
   * Which transitions to announce, comma-separated. All four by default.
   * An unrecognised entry is ignored; an empty list sends nothing while leaving
   * the poller's state tracking intact.
   */
  events: env('NOTIFY_EVENTS', 'kickoff,final,postponed,cancelled')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean),
  /**
   * How often the poller compares today's fixtures against the last seen state.
   *
   * Floored at 60s: the underlying fixture fetch is cached for minutes anyway,
   * so polling faster costs requests without improving latency.
   */
  pollIntervalMs: Math.max(60_000, envInt('NOTIFY_POLL_INTERVAL_MS', 300_000)),
  timeoutMs: envInt('NOTIFY_TIMEOUT_MS', 8000),
  /**
   * Public base URL, used only to link each notification to its game page.
   *
   * Left empty by default: a chat message cannot use a relative path, and
   * guessing a hostname would produce links that go nowhere. Set APP_BASE_URL
   * to something reachable from wherever Discord is read.
   */
  linkBaseUrl: env('APP_BASE_URL').replace(/\/+$/, ''),
  /**
   * Ceiling on games announced in one poll.
   *
   * A first run, or a long outage, can see dozens of transitions at once.
   * Batching keeps that to a couple of messages instead of flooding the channel
   * and tripping Discord's rate limit.
   */
  maxPerPoll: envInt('NOTIFY_MAX_PER_POLL', 20),
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
