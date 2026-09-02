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

  const outcome = await getGameDetail(gameId);
  if (outcome.kind === 'not_found') {
    return json({ error: 'game_not_found', message: 'No such game.' }, 404);
  }
  if (outcome.kind === 'failed') {
    return json({ model_version: MODEL_VERSION, projection: null, reason: 'unavailable' });
  }

  const detail = outcome.game;

  // Only a fixture still to come is projected. A finished game has a result,
  // and projecting one after the fact would be meaningless.
  if (detail.status !== 'scheduled') {
    return json({ model_version: MODEL_VERSION, projection: null, reason: 'not_upcoming' });
  }

  // The detail shape is a superset of Game; the projector reads only the
  // fields the two share.
  const game = detail as unknown as Game;
  const projected = await projectionForGame(game);

  return json({
    model_version: MODEL_VERSION,
    projection: projected?.projection ?? null,
    ...(projected ? {} : { reason: 'insufficient_data' as const }),
  });
}
