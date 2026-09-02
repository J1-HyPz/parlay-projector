/**
 * ESPN HTTP client.
 *
 * Two base paths are in play:
 *
 *   site  -> /apis/site/v2/sports/...   scoreboards, teams, rosters, summaries,
 *                                       per-league news
 *   v2    -> /apis/v2/sports/...        standings (the site path returns only a
 *                                       link stub with no table)
 *   core  -> sports.core.api.espn.com   transactions
 *
 * The first two live on `site.web.api.espn.com`. The more commonly cited
 * `site.api.espn.com` returns 403 to server-side callers.
 *
 * The core host takes a different path shape -- `<sport>/leagues/<league>`
 * rather than `<sport>/<league>` -- so callers pass a path already in that
 * form; see coreLeaguePath in the transactions adapter.
 *
 * No credentials are involved, so there is nothing to redact — the shared
 * request helper is still used for its timeout, size cap and 429 detection.
 */

import { espnConfig } from '../../config';
import { getJson } from '../../http';

export type EspnApi = 'site' | 'v2' | 'core';

/** Root for the core API, which is a different host rather than a sibling path. */
const CORE_ROOT = 'https://sports.core.api.espn.com/v2/sports';

export function espnUrl(path: string, query = '', api: EspnApi = 'site'): string {
  const base = espnConfig.baseUrl.replace(/\/+$/, '');
  // baseUrl points at the site path; the v2 path is a sibling, the core API is
  // a separate host.
  const root =
    api === 'core'
      ? CORE_ROOT
      : api === 'v2'
        ? base.replace('/apis/site/v2/sports', '/apis/v2/sports')
        : base;
  return `${root}/${path}${query ? `?${query}` : ''}`;
}

export async function fetchEspn<T>(path: string, query = '', api: EspnApi = 'site'): Promise<T> {
  return getJson<T>(espnUrl(path, query, api), { timeoutMs: espnConfig.timeoutMs });
}
