/**
 * Shared outbound HTTP helper for provider calls.
 *
 * Adds the things every provider request needs and none should reimplement:
 * a timeout, a response size cap, and explicit detection of rate limiting so
 * callers can back off rather than hammer a provider.
 */

import { logger, redactUrl } from './logger';

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
}

async function fetchText(url: string, options: FetchOptions): Promise<string> {
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

    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) {
      throw new ProviderError('provider response too large', response.status, true);
    }

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new ProviderError('provider response too large', response.status, true);
    }
    return text;
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

export async function getText(url: string, options: FetchOptions): Promise<string> {
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

export async function getJson<T>(url: string, options: FetchOptions): Promise<T> {
  const text = await getText(url, options);
  try {
    return JSON.parse(text) as T;
  } catch {
    logger.warn('provider_invalid_json', {
      url: redactUrl(url, options.redactSecret),
    });
    throw new ProviderError('provider returned invalid JSON');
  }
}
