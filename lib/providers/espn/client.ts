/**
 * ESPN HTTP client.
 *
 * Two base paths are in play:
 *
 *   site  -> /apis/site/v2/sports/...   scoreboards, teams, rosters, summaries
 *   v2    -> /apis/v2/sports/...        standings (the site path returns only a
 *                                       link stub with no table)
 *
 * Both live on `site.web.api.espn.com`. The more commonly cited
 * `site.api.espn.com` returns 403 to server-side callers.
 *
 * No credentials are involved, so there is nothing to redact — the shared
 * request helper is still used for its timeout, size cap and 429 detection.
 */

import { espnConfig } from '../../config';
import { getJson } from '../../http';

export type EspnApi = 'site' | 'v2';

export function espnUrl(path: string, query = '', api: EspnApi = 'site'): string {
  const base = espnConfig.baseUrl.replace(/\/+$/, '');
  // baseUrl points at the site path; the v2 path is a sibling.
  const root = api === 'v2' ? base.replace('/apis/site/v2/sports', '/apis/v2/sports') : base;
  return `${root}/${path}${query ? `?${query}` : ''}`;
}

export async function fetchEspn<T>(path: string, query = '', api: EspnApi = 'site'): Promise<T> {
  return getJson<T>(espnUrl(path, query, api), { timeoutMs: espnConfig.timeoutMs });
}
