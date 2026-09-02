/**
 * GET /api/leagues/:leagueId/transactions?limit=
 *
 * Trades, signings, waivers and roster moves, in one model shared across
 * sports.
 *
 * `supported: false` means the provider publishes no transactions for this
 * competition at all — true of every soccer competition and both NCAA
 * divisions, verified rather than assumed. That is reported distinctly from an
 * empty list, so a hub can say "not published for this competition" instead of
 * showing a permanently empty section that looks broken.
 */

import { json } from '@/lib/home/api';
import { parseLeagueId } from '@/lib/leagues/registry';
import { getLeagueTransactions } from '@/lib/leagues/extras';

export const dynamic = 'force-dynamic';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export async function GET(
  request: Request,
  context: { params: Promise<{ leagueId: string }> },
): Promise<Response> {
  const { leagueId } = await context.params;
  const league = parseLeagueId(leagueId);
  if (!league) {
    return json({ error: 'league_not_found', message: 'No such league.' }, 404);
  }

  const requested = Number.parseInt(new URL(request.url).searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const result = await getLeagueTransactions(league, limit);

  return json({
    league: { id: league.id, label: league.label },
    supported: result.supported,
    transactions: result.transactions,
    ...(result.failed ? { error: 'league_data_unavailable' as const } : {}),
  });
}
