/**
 * Whether a ground has a roof.
 *
 * The fixtures feed carries this on every venue, but the summary the game
 * detail page is built from does not — so a detail-page projection would have
 * had to treat every ground as covered and forgo a conditions adjustment
 * entirely. The core venue record does carry it, keyed by the venue id the
 * summary *does* supply.
 *
 * Cached for a month, and safe to be: this is a property of the ground rather
 * than of the night. Every park with a retractable roof reports covered on
 * every date checked, so the provider is classifying grounds that can close
 * rather than nights they actually did.
 */

import { cached } from '../../cache.ts';
import { espnConfig } from '../../config.ts';
import { logger } from '../../logger.ts';
import { fetchEspn } from './client.ts';
import type { League } from '../../leagues/registry';

/** Grounds do not grow roofs. */
const TTL_MS = 30 * 24 * 60 * 60_000;

interface RawVenue {
  indoor?: unknown;
}

/**
 * The core API takes `<sport>/leagues/<league>` where the site path takes
 * `<sport>/<league>`, so the league path is rewritten rather than reused.
 */
function corePath(espnPath: string, venueId: string): string {
  const [sport, league] = espnPath.split('/');
  return `${sport}/leagues/${league}/venues/${encodeURIComponent(venueId)}`;
}

/**
 * True when the ground is covered, false when it is open, null when unknown.
 *
 * Null and true are treated alike downstream — no conditions adjustment — so a
 * failed lookup costs a feature rather than producing a wrong number.
 */
export async function venueIsRoofed(
  league: League,
  venueId: string | null,
): Promise<boolean | null> {
  const espnPath = league.espnPath;
  if (!espnConfig.enabled || !espnPath || !venueId) return null;

  try {
    const { value } = await cached(`espn:venue:${league.id}:${venueId}`, TTL_MS, async () => {
      const payload = await fetchEspn<RawVenue>(corePath(espnPath, venueId), '', 'core');
      return typeof payload?.indoor === 'boolean' ? payload.indoor : null;
    });
    return value;
  } catch (error) {
    logger.warn('espn_venue_failed', {
      league: league.id,
      venue: venueId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}
