/**
 * Shared outbound HTTP helper for provider calls.
 *
 * Adds the things every provider request needs and none should reimplement:
 * a timeout, a response size cap, and explicit detection of rate limiting so
 * callers can back off rather than hammer a provider.
 */

import { logger, redactUrl } from './logger.ts';

/** 8 MiB. Guards against a provider streaming something unbounded at us. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

export class ProviderError extends Error {
  readonly status: number | null;
  readonly rateLimited: boolean;
  /**
   * The response was refused for its size rather than its content.
   *
   * Distinct from a failure: the provider answered, there was simply too much
   * of it. A caller asking for a date range can retry with a smaller one.
   */
  readonly tooLarge: boolean;

  constructor(message: string, status: number | null = null, tooLarge = false) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.rateLimited = status === 429;
    this.tooLarge = tooLarge;
  }
}

interface FetchOptions {
  timeoutMs: number;
  /** Used only to redact the key from log output. */
  redactSecret?: string;
  accept?: string;
  /**
   * Raise the size ceiling for one call that is known to exceed it.
   *
   * The default guards against a provider streaming something *unbounded* at
   * us. A specific endpoint whose size has actually been measured is a
   * different case: ESPN's league-wide injury feed is 8.9 MB decompressed for
   * the NFL, which is large but neither unbounded nor a surprise. Passing a
   * measured ceiling keeps the guard doing its job everywhere else rather than
   * raising the global limit to accommodate one caller.
   */
  maxBytes?: number;
}

/** A response body, with the headers a caller asked to keep. */
export interface FetchedText {
  text: string;
  headers: Headers;
}

async function fetchText(url: string, options: FetchOptions): Promise<FetchedText> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: options.accept ?? 'application/json',
        'user-agent': 'parlay-projector',
      },
    });

    if (response.status === 429) {
      throw new ProviderError('provider rate limit reached', 429);
    }
    if (!response.ok) {
      throw new ProviderError(`provider responded ${response.status}`, response.status);
    }

    const ceiling = options.maxBytes ?? MAX_RESPONSE_BYTES;

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > ceiling) {
      throw new ProviderError('provider response too large', response.status, true);
    }

    const text = await response.text();
    if (text.length > ceiling) {
      throw new ProviderError('provider response too large', response.status, true);
    }
    return { text, headers: response.headers };
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(`provider request timed out after ${options.timeoutMs}ms`);
    }
    throw new ProviderError(
      error instanceof Error ? error.message : 'provider request failed',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLogged(url: string, options: FetchOptions): Promise<FetchedText> {
  try {
    return await fetchText(url, options);
  } catch (error) {
    const err = error as ProviderError;
    logger.warn(err.rateLimited ? 'provider_rate_limited' : 'provider_request_failed', {
      url: redactUrl(url, options.redactSecret),
      status: err.status,
      reason: err.message,
    });
    throw err;
  }
}

export async function getText(url: string, options: FetchOptions): Promise<string> {
  return (await fetchLogged(url, options)).text;
}

function parseJson<T>(text: string, url: string, options: FetchOptions): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    logger.warn('provider_invalid_json', {
      url: redactUrl(url, options.redactSecret),
    });
    throw new ProviderError('provider returned invalid JSON');
  }
}

export async function getJson<T>(url: string, options: FetchOptions): Promise<T> {
  const { text } = await fetchLogged(url, options);
  return parseJson<T>(text, url, options);
}

/**
 * The same, keeping the response headers.
 *
 * For the one provider that reports something in them worth acting on: The
 * Odds API returns the account's remaining quota on every priced call, and a
 * budget nobody can see is one that runs out without warning. Every other
 * caller wants `getJson` — headers are a detail, and this exists so they stay
 * one everywhere else.
 */
export async function getJsonWithHeaders<T>(
  url: string,
  options: FetchOptions,
): Promise<{ value: T; headers: Headers }> {
  const { text, headers } = await fetchLogged(url, options);
  return { value: parseJson<T>(text, url, options), headers };
}
