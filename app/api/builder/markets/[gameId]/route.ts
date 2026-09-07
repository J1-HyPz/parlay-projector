import { json } from '@/lib/home/api';
import { isValidGameId } from '@/lib/games/normalise';
import { getBuilderMarkets } from '@/lib/builder/service';
export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ gameId: string }> },
): Promise<Response> {
  const { gameId } = await context.params;
  if (!isValidGameId(gameId)) return json({ error: 'invalid_game_id' }, 400);
  return json(await getBuilderMarkets(gameId));
}
