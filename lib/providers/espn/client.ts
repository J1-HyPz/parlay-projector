/**
 * ESPN HTTP client.
 *
 * Uses `site.web.api.espn.com`: the more commonly cited `site.api.espn.com`
 * host returns 403 to server-side callers, while this one serves the same
 * payloads.
 *
 * No credentials are involved, so there is nothing to redact — but the shared
 * request helper is still used for its timeout, size cap and 429 detection.
 */

import { espnConfig } from '../../config';
import { getJson } from '../../http';

export function espnUrl(path: string, query = ''): string {
  const base = espnConfig.baseUrl.replace(/\/+$/, '');
  return `${base}/${path}${query ? `?${query}` : ''}`;
}

export async function fetchEspn<T>(path: string, query = ''): Promise<T> {
  return getJson<T>(espnUrl(path, query), { timeoutMs: espnConfig.timeoutMs });
}
