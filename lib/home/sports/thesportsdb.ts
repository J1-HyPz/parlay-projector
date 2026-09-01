/**
 * TheSportsDB adapter — the only file that knows this vendor exists.
 *
 * Endpoint used: `GET /api/v1/json/<key>/eventsday.php?d=YYYY-MM-DD&s=<sport>`
 * which returns `{ events: [...] | null }`.
 *
 * The API key sits in the URL path, so it must never be logged; `getText`
 * receives it as `redactSecret` and the logger strips it.
 */

import { sportsConfig } from '../../config';
import { getJson } from '../../http';
import type { Game } from '../types';
import { normaliseEvents, sortGames } from './normalise';
import type { RawEventsResponse, SportDefinition } from './normalise';
import type { SportsProvider } from './provider';

export function createTheSportsDbProvider(): SportsProvider {
  return {
    name: 'thesportsdb',

    async gamesOnDate(date: string, definition: SportDefinition): Promise<Game[]> {
      const url =
        `${sportsConfig.baseUrl.replace(/\/+$/, '')}/${sportsConfig.apiKey}/eventsday.php` +
        `?d=${encodeURIComponent(date)}&s=${encodeURIComponent(definition.providerSport)}`;

      const payload = await getJson<RawEventsResponse>(url, {
        timeoutMs: sportsConfig.timeoutMs,
        redactSecret: sportsConfig.apiKey,
      });

      return sortGames(normaliseEvents(payload, definition));
    },
  };
}
