/**
 * TheSportsDB live adapter — the only file that knows this vendor exists for
 * the Live page.
 *
 * Endpoint: `GET /livescore.php?s=<Sport>` returns `{ livescore: [...] }`,
 * one row per event including not-started and finished ones. Filtering to
 * in-progress games happens in the normaliser.
 *
 * One request per sport, so a full refresh is six requests rather than the
 * per-date fan-out the Schedule needs.
 *
 * The API key sits in the URL path, so it is passed as `redactSecret` and the
 * logger strips it before anything is written.
 */

import { sportsConfig } from '../config';
import { getJson } from '../http';
import type { ConcreteSportId } from '../home/types';
import { normaliseLiveResponse, sortLiveGames } from './normalise';
import type { RawLiveResponse } from './normalise';
import type { LiveProvider } from './provider';
import type { LiveGame } from './types';

export function createTheSportsDbLiveProvider(): LiveProvider {
  return {
    name: 'thesportsdb',

    async liveForSport(sport: ConcreteSportId, providerSport: string): Promise<LiveGame[]> {
      const url =
        `${sportsConfig.baseUrl.replace(/\/+$/, '')}/${sportsConfig.apiKey}/livescore.php` +
        `?s=${encodeURIComponent(providerSport)}`;

      const payload = await getJson<RawLiveResponse>(url, {
        timeoutMs: sportsConfig.timeoutMs,
        redactSecret: sportsConfig.apiKey,
      });

      return sortLiveGames(normaliseLiveResponse(payload, sport));
    },
  };
}
