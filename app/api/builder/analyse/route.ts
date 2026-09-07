import { json } from '@/lib/home/api';
import { isValidGameId } from '@/lib/games/normalise';
import { getBuilderEvidence } from '@/lib/builder/service';
import { MAX_LEGS } from '@/lib/builder/types';
export const dynamic = 'force-dynamic';
export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }
  const ids =
    body && typeof body === 'object' && 'gameIds' in body ? body.gameIds : null;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > MAX_LEGS ||
    ids.some((id) => typeof id !== 'string' || !isValidGameId(id))
  )
    return json({ error: 'invalid_game_ids' }, 400);
  const unique = [...new Set(ids as string[])];
  const evidence = [];
  // Bound provider concurrency, including when all twelve legs are analysed.
  for (let i = 0; i < unique.length; i += 3)
    evidence.push(
      ...(await Promise.all(unique.slice(i, i + 3).map(getBuilderEvidence))),
    );
  return json({ evidence });
}
