/**
 * TheSportsDB adapter for game detail — the only file that knows this vendor
 * exists for this feature.
 *
 * Endpoints used:
 *   lookupevent.php?id=<eventId>        the game itself
 *   lookupteam.php?id=<teamId>          badge, abbreviation, stadium
 *   lookuptable.php?l=<league>&s=<season>  record, position, form
 *   eventslast.php?id=<teamId>          recent results
 *
 * Head-to-head is not fetched: `eventsh2h.php` returns 404 on the configured
 * tier, and this task adds no paid integration.
 *
 * The API key sits in the URL path, so every call passes it as `redactSecret`
 * and the logger strips it before anything is written.
 */

import { sportsConfig } from '../config';
import { getJson } from '../http';
import type { RawEvent } from '../home/sports/normalise';
import { normaliseGameDetail } from './normalise';
import type { RawStanding, RawTeam } from './normalise';
import type { GameDetail } from './types';
import type { GameDetailProvider } from './provider';

interface EventLookup {
  events?: RawEvent[] | null;
}
interface TeamLookup {
  teams?: RawTeam[] | null;
}
interface TableLookup {
  table?: RawStanding[] | null;
}
interface LastEventsLookup {
  results?: RawEvent[] | null;
  events?: RawEvent[] | null;
}

function endpoint(path: string, query: string): string {
  return (
    `${sportsConfig.baseUrl.replace(/\/+$/, '')}/${sportsConfig.apiKey}/${path}?${query}`
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  return getJson<T>(url, {
    timeoutMs: sportsConfig.timeoutMs,
    redactSecret: sportsConfig.apiKey,
  });
}

/**
 * Supplementary lookups must never fail the page.
 *
 * A missing league table costs the comparison section, not the whole game, so
 * these resolve to null instead of throwing.
 */
async function optional<T>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch {
    return null;
  }
}

export function createTheSportsDbGameProvider(): GameDetailProvider {
  return {
    name: 'thesportsdb',

    async gameById(gameId: string): Promise<GameDetail | null> {
      // The event lookup is the only required call; if it fails the caller
      // reports the game as unavailable.
      const lookup = await fetchJson<EventLookup>(
        endpoint('lookupevent.php', `id=${encodeURIComponent(gameId)}`),
      );

      const event = Array.isArray(lookup?.events) ? lookup.events[0] : null;
      if (!event) return null;

      const homeId = typeof event.idHomeTeam === 'string' ? event.idHomeTeam : null;
      const awayId = typeof event.idAwayTeam === 'string' ? event.idAwayTeam : null;
      const leagueId = (event as { idLeague?: unknown }).idLeague;
      const season = (event as { strSeason?: unknown }).strSeason;

      // One round trip each, in parallel, for a single coherent response.
      const [homeTeam, awayTeam, table, homeRecent, awayRecent] = await Promise.all([
        homeId
          ? optional(() =>
              fetchJson<TeamLookup>(endpoint('lookupteam.php', `id=${encodeURIComponent(homeId)}`)),
            )
          : Promise.resolve(null),
        awayId
          ? optional(() =>
              fetchJson<TeamLookup>(endpoint('lookupteam.php', `id=${encodeURIComponent(awayId)}`)),
            )
          : Promise.resolve(null),
        typeof leagueId === 'string' && typeof season === 'string'
          ? optional(() =>
              fetchJson<TableLookup>(
                endpoint(
                  'lookuptable.php',
                  `l=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`,
                ),
              ),
            )
          : Promise.resolve(null),
        homeId
          ? optional(() =>
              fetchJson<LastEventsLookup>(
                endpoint('eventslast.php', `id=${encodeURIComponent(homeId)}`),
              ),
            )
          : Promise.resolve(null),
        awayId
          ? optional(() =>
              fetchJson<LastEventsLookup>(
                endpoint('eventslast.php', `id=${encodeURIComponent(awayId)}`),
              ),
            )
          : Promise.resolve(null),
      ]);

      return normaliseGameDetail({
        event,
        homeTeam: homeTeam?.teams?.[0] ?? null,
        awayTeam: awayTeam?.teams?.[0] ?? null,
        table: table?.table ?? null,
        homeRecent: homeRecent?.results ?? homeRecent?.events ?? null,
        awayRecent: awayRecent?.results ?? awayRecent?.events ?? null,
      });
    },
  };
}
