/**
 * GET /api/games/:gameId
 *
 * Full detail for one game, using the provider's own event id — the same id
 * the Home page already receives, so no second identifier scheme exists.
 *
 * Sports information only: no odds, spreads, totals, bookmakers or markets.
 *
 *   200  { "game": { ... } }
 *   404  { "error": "game_not_found", ... }        unknown or malformed id
 *   503  { "error": "game_data_unavailable", ... } provider failure
 */

import { getGameDetail } from '@/lib/games/service';
import type { GameDetailResponse, GameErrorResponse } from '@/lib/games/types';
import { json } from '@/lib/home/api';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  const outcome = await getGameDetail(gameId);

  if (outcome.kind === 'not_found') {
    const body: GameErrorResponse = {
      error: 'game_not_found',
      message: 'No game exists with that id.',
    };
    return json(body, 404);
  }

  if (outcome.kind === 'failed') {
    const body: GameErrorResponse = {
      error: 'game_data_unavailable',
      message: 'Game information is temporarily unavailable.',
    };
    return json(body, 503);
  }

  const body: GameDetailResponse = { game: outcome.game };
  return json(body);
}
