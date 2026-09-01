/**
 * ESPN adapter.
 *
 * Supplies exactly the capabilities the primary provider is weak or silent on:
 * team records, recent form, head-to-head, broadcast and venue. Fixtures,
 * scores and the base game record stay with the primary provider.
 *
 * All of it is enrichment: every method resolves to null rather than throwing
 * for "no data", so a missing match never breaks a page.
 */

import { cached } from '../../cache';
import { espnConfig } from '../../config';
import { logger } from '../../logger';
import type { ConcreteSportId } from '../../home/types';
import { fetchEspn } from './client';
import { normaliseScoreboard, normaliseSeasonSeries } from './normalise';
import type { EspnGame, EspnMeeting, RawEspnScoreboard } from './normalise';
import { espnPathFor } from './paths';
import type { ProviderDescriptor } from '../capabilities';

export const ESPN_PROVIDER_ID = 'espn';

export function espnDescriptor(): ProviderDescriptor {
  return {
    id: ESPN_PROVIDER_ID,
    label: 'ESPN (public web API)',
    enabled: espnConfig.enabled,
    disabledReason: espnConfig.enabled ? undefined : 'ESPN_ENABLED=false',
    requiresCredentials: false,
    capabilities: [
      'team_records',
      'recent_form',
      'head_to_head',
      'broadcasts',
      'standings',
      'player_leaders',
    ],
    notes:
      'Undocumented public API with no published terms of use. Enrichment only; ' +
      'the application degrades cleanly without it.',
  };
}

/**
 * One day's scoreboard for a competition.
 *
 * Cached per (path, date) so enriching several games from the same competition
 * costs one request rather than one per game — this is what keeps enrichment
 * off the N+1 path.
 */
export async function scoreboardFor(
  sport: ConcreteSportId,
  league: string | null,
  date: string,
  timeZone: string,
): Promise<EspnGame[] | null> {
  const path = espnPathFor(sport, league);
  if (!path) return null;

  // ESPN wants YYYYMMDD.
  const compact = date.replace(/-/g, '');

  const { value, hit } = await cached(
    `espn:scoreboard:${path}:${compact}`,
    espnConfig.cacheTtlMs,
    async () => {
      const payload = await fetchEspn<RawEspnScoreboard>(`${path}/scoreboard`, `dates=${compact}`);
      return normaliseScoreboard(payload, timeZone);
    },
  );

  if (!hit) {
    logger.info('espn_scoreboard_refreshed', { path, date, games: value.length });
  }
  return value;
}

/**
 * Previous meetings for one ESPN event.
 *
 * Historical and effectively immutable, so it is cached for far longer than
 * anything live.
 */
export async function headToHeadFor(
  sport: ConcreteSportId,
  league: string | null,
  espnEventId: string,
): Promise<EspnMeeting[] | null> {
  const path = espnPathFor(sport, league);
  if (!path) return null;

  const { value } = await cached(
    `espn:h2h:${path}:${espnEventId}`,
    // Six hours: previous results do not change.
    6 * 60 * 60_000,
    async () => {
      const payload = await fetchEspn<{ seasonseries?: { events?: unknown[] }[] }>(
        `${path}/summary`,
        `event=${encodeURIComponent(espnEventId)}`,
      );
      return normaliseSeasonSeries(payload as never);
    },
  );

  return value.length > 0 ? value : null;
}
