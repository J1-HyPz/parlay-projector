/**
 * GET /api/projections/games/:gameId
 *
 * The projection for one fixture, for the game detail page.
 *
 * 404 for an unknown id. 200 with `projection: null` when the model has too
 * little to work with — a real distinction, and one the page reflects rather
 * than papering over.
 */

import { json } from '@/lib/home/api';
import { isValidGameId } from '@/lib/games/normalise';
import { getGameDetail } from '@/lib/games/service';
import { projectionForGame } from '@/lib/projections/service';
import { MODEL_VERSION } from '@/lib/projections/types';
import type { Game } from '@/lib/home/types';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  if (!isValidGameId(gameId)) {
    return json({ error: 'game_not_found', message: 'No such game.' }, 404);
  }

  const detail = await getGameDetail(gameId);
  if (!detail) {
    return json({ error: 'game_not_found', message: 'No such game.' }, 404);
  }

  // Only a fixture still to come is projected. A finished game has a result,
  // and projecting one after the fact would be meaningless.
  if (detail.status !== 'scheduled') {
    return json({ model_version: MODEL_VERSION, projection: null, reason: 'not_upcoming' });
  }

  // The detail shape carries everything the projector needs from a Game.
  const game = detail as unknown as Game;
  const outcome = await projectionForGame(game);

  return json({
    model_version: MODEL_VERSION,
    projection: outcome?.projection ?? null,
    ...(outcome ? {} : { reason: 'insufficient_data' as const }),
  });
}
