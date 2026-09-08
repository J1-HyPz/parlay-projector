/**
 * Slip API.
 *
 *   GET     -> the slip, split into active and settled
 *   POST    -> add a match     { gameId, label, league, sport, startTime }
 *   DELETE  -> remove a match  ?gameId=...   or  ?all=1 to clear
 *
 * There is no authentication, consistent with the rest of the application:
 * anyone who can reach the server can change the slip. That is acceptable for
 * a LAN deployment and is stated in docs/notifications.md — do not expose this
 * host to the internet without putting authentication in front of it.
 *
 * The client supplies the display snapshot because it already holds the game;
 * looking it up here would cost a provider request per add. Every field is
 * validated and clamped before it is written.
 *
 * `GET` is the only verb that resolves statuses. It is what decides which
 * section a match belongs in, stamps the day a result was first observed, and
 * drops what has run its course — all inside the store's lock, so a match added
 * while it works is not erased by it.
 */

import { json } from '@/lib/home/api';
import { logger } from '@/lib/logger';
import { APP_TIMEZONE, todayInAppTimezone } from '@/lib/config';
import { getGameDetail } from '@/lib/games/service';
import type { GameStatus } from '@/lib/home/types';
import { parseEntry, sortEntries } from '@/lib/slip/parse';
import { addToSlip, clearSlip, readSlip, refreshSlip, removeFromSlip } from '@/lib/slip/store';

export const dynamic = 'force-dynamic';

/**
 * How many game lookups run at once.
 *
 * Each is cached — an upcoming or live game for a minute, a settled one for
 * hours — so a slip re-read costs almost nothing after the first. The limit is
 * there so a full slip cannot open thirty sockets at once.
 */
const LOOKUP_CONCURRENCY = 6;

/**
 * Current status for every match on the slip.
 *
 * A lookup that fails contributes nothing rather than a guess: an unreachable
 * provider must not retire a fixture that is still to be played. The entry
 * simply stays where it was until the next read.
 */
async function resolveStatuses(gameIds: readonly string[]): Promise<Map<string, GameStatus>> {
  const statuses = new Map<string, GameStatus>();
  const queue = [...gameIds];

  const workers = Array.from({ length: Math.min(LOOKUP_CONCURRENCY, queue.length) }, async () => {
    for (;;) {
      const gameId = queue.shift();
      if (!gameId) return;

      try {
        const detail = await getGameDetail(gameId);
        if (detail.kind === 'ok') statuses.set(gameId, detail.game.status);
      } catch (error) {
        logger.warn('slip_status_failed', {
          game: gameId,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  });

  await Promise.all(workers);
  return statuses;
}

export async function GET(): Promise<Response> {
  const entries = await readSlip();

  if (entries.length === 0) {
    return json({ active: [], settled: [], timezone: APP_TIMEZONE });
  }

  const statuses = await resolveStatuses(entries.map((entry) => entry.gameId));
  const sectioned = await refreshSlip({ statuses, today: todayInAppTimezone() });

  return json({
    active: sectioned.active,
    settled: sectioned.settled,
    timezone: APP_TIMEZONE,
    ...(sectioned.removed.length > 0
      ? {
          /*
           * What this read dropped, so the page can say the slip changed
           * rather than letting a match disappear between visits.
           */
          removed: sectioned.removed.map((item) => ({
            label: item.entry.label,
            reason: item.reason,
          })),
        }
      : {}),
  });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  // parseEntry applies the same id validation the game routes use, so a slip
  // entry can never hold an id that would not resolve to a page.
  const entry = parseEntry({
    ...(body as Record<string, unknown>),
    addedAt: new Date().toISOString(),
  });
  if (!entry) return json({ error: 'invalid_game' }, 400);

  const result = await addToSlip(entry);
  return json({
    entries: result.entries,
    changed: result.changed,
    ...(result.reason ? { reason: result.reason } : {}),
  });
}

export async function DELETE(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;

  if (params.get('all') === '1') {
    const cleared = await clearSlip();
    return json({ entries: cleared.entries, changed: cleared.changed });
  }

  const gameId = params.get('gameId');
  if (!gameId) return json({ error: 'missing_game_id' }, 400);

  const result = await removeFromSlip(gameId);
  if (!result.changed) logger.info('slip_remove_noop', { game: gameId });
  return json({ entries: sortEntries(result.entries), changed: result.changed });
}
