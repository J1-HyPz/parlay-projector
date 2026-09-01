/**
 * Game detail service.
 *
 * Caches by game status, because the three cases have very different
 * volatility: a finished result never changes, a scheduled fixture changes
 * rarely, and a live game changes constantly.
 */

import { cached } from '../cache';
import { logger } from '../logger';
import { bootstrapProviders } from '../providers';
import { enrichGameDetail } from '../providers/enrichment';
import { isValidGameId } from './normalise';
import { isEspnGameId } from '../providers/espn/fixtures';
import { espnGameDetail } from './espn-detail';
import { createTheSportsDbGameProvider } from './thesportsdb';
import type { GameDetail } from './types';
import type { GameDetailProvider } from './provider';

// The one place the concrete provider is chosen.
const provider: GameDetailProvider = createTheSportsDbGameProvider();

/** Short probe TTL, then re-cached for longer once the status is known. */
const TTL_BY_STATUS: Record<string, number> = {
  live: 60_000, // 1 minute
  scheduled: 10 * 60_000, // 10 minutes
  finished: 6 * 60 * 60_000, // 6 hours - the result is settled
  postponed: 30 * 60_000,
  cancelled: 30 * 60_000,
  unknown: 10 * 60_000,
};

export type GameDetailOutcome =
  | { kind: 'ok'; game: GameDetail }
  | { kind: 'not_found' }
  | { kind: 'failed' };

export async function getGameDetail(gameId: string): Promise<GameDetailOutcome> {
  // Reject junk before it reaches the provider.
  if (!isValidGameId(gameId)) return { kind: 'not_found' };

  const id = gameId.trim();

  try {
    // TTL is derived from the loaded game: a settled result can be held for
    // hours, a live game for a minute. A miss (null) is cached briefly so a
    // bad id cannot be used to hammer the provider.
    const { value, hit } = await cached<GameDetail | null>(
      `game:${provider.name}:${id}`,
      (game) => (game ? ttlForStatus(game.status) : 60_000),
      async () => {
        // Dispatch on the id namespace: ESPN-sourced fixtures resolve against
        // ESPN, everything else against the primary provider.
        const base = isEspnGameId(id)
          ? await espnGameDetail(id)
          : await provider.gameById(id);
        if (!base) return null;

        // Enrichment is lazy by design: it runs here, for one game page, and
        // never across a schedule. A failure leaves the base game intact.
        bootstrapProviders();
        try {
          const { game, sources } = await enrichGameDetail(base);
          return { ...game, _sources: sources };
        } catch (error) {
          logger.warn('game_detail_enrichment_failed', {
            id,
            reason: error instanceof Error ? error.message : 'unknown',
          });
          return base;
        }
      },
    );

    if (!value) {
      if (!hit) logger.info('game_detail_not_found', { provider: provider.name, id });
      return { kind: 'not_found' };
    }

    if (!hit) {
      logger.info('game_detail_refreshed', {
        provider: provider.name,
        id,
        status: value.status,
        sport: value.sport,
      });
    }

    return { kind: 'ok', game: value };
  } catch (error) {
    logger.error('game_detail_failed', {
      provider: provider.name,
      id,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { kind: 'failed' };
  }
}

/** Exposed for the route so cache headers can match the game's volatility. */
export function ttlForStatus(status: string): number {
  return TTL_BY_STATUS[status] ?? TTL_BY_STATUS.scheduled ?? 600_000;
}
