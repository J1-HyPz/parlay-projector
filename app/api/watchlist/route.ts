/**
 * Watchlist API.
 *
 *   GET     -> the current list
 *   POST    -> add a game        { gameId, label, league, sport, startTime }
 *   DELETE  -> remove a game     ?gameId=...
 *
 * There is no authentication, consistent with the rest of the application:
 * anyone who can reach the server can change the list. That is acceptable for
 * a LAN deployment and is stated in docs/notifications.md — do not expose this
 * host to the internet without putting authentication in front of it.
 *
 * The client supplies the display snapshot because it already holds the game;
 * looking it up here would cost a provider request per star. Every field is
 * validated and clamped before it is written.
 */

import { json } from '@/lib/home/api';
import { logger } from '@/lib/logger';
import { parseEntry, sortEntries } from '@/lib/watchlist/parse';
import { addToWatchlist, readWatchlist, removeFromWatchlist } from '@/lib/watchlist/store';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  return json({ entries: sortEntries(await readWatchlist()) });
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  // parseEntry applies the same id validation the game routes use, so a
  // watchlist entry can never hold an id that would not resolve to a page.
  const entry = parseEntry({
    ...(body as Record<string, unknown>),
    addedAt: new Date().toISOString(),
  });
  if (!entry) return json({ error: 'invalid_game' }, 400);

  const { entries, changed } = await addToWatchlist(entry);
  return json({ entries, changed });
}

export async function DELETE(request: Request): Promise<Response> {
  const gameId = new URL(request.url).searchParams.get('gameId');
  if (!gameId) return json({ error: 'missing_game_id' }, 400);

  const { entries, changed } = await removeFromWatchlist(gameId);
  if (!changed) logger.info('watchlist_remove_noop', { game: gameId });
  return json({ entries, changed });
}
